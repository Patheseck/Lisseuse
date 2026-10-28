import { ambiancePlayer } from '../audio/player';
import { AMBIANCE_GROUPS, AMBIANCES, findAmbiance, MUSIC_APPS } from '../core/ambiances';
import { errorMessage, logError } from '../core/errors';
import { addTracks, countTracks, deleteTrack, getBookAmbiance, isAudioFile, listTracks, loadAmbiancePrefs, saveAmbiancePrefs, setBookAmbiance } from '../storage/audio';
import { add, clear, h } from './dom';
import { toast, withBusy } from './feedback';
import { icon } from './icons';
import { createSheet, type Sheet } from './sheet';

const SAVE_DELAY_MS = 300;

/** Durée d'un fichier audio (lue dans ses métadonnées), ou null s'il ne s'ouvre pas vite. */
function readDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 4000);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => done(Number.isFinite(audio.duration) ? audio.duration : null), { once: true });
    audio.addEventListener('error', () => done(null), { once: true });
    audio.src = url;
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.floor(seconds / 60);
  return m >= 1 ? `${m} min ${String(Math.round(seconds % 60)).padStart(2, '0')}` : `${Math.round(seconds)} s`;
}

/**
 * Panneau « Ambiance musicale » du lecteur : ambiance de ce livre, morceaux importés,
 * recherche dans une appli de musique, volume. `onState` prévient le bouton ♪.
 */
export function ambianceSheet(bookId: string): Sheet & { refresh(): void; dispose(): void } {
  const player = ambiancePlayer();
  const sheet = createSheet({ title: 'Ambiance musicale', kind: 'bottom', testId: 'ambiance-sheet' });
  let selected: string | null = null;
  let saveTimer: number | undefined;

  const status = h('p', { className: 'ambiance-status', 'data-testid': 'ambiance-status', 'aria-live': 'polite' });
  const toggle = h('button', { type: 'button', className: 'btn', 'data-testid': 'ambiance-toggle', onclick: () => void togglePlayback() });
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, className: 'range', 'aria-label': 'Volume de la musique', 'data-testid': 'ambiance-volume' });
  const choices = h('div', { className: 'ambiance-choices', role: 'radiogroup', 'aria-label': 'Ambiance de ce livre' });
  const tracksBox = h('section', { className: 'data-section', 'data-testid': 'ambiance-tracks' });
  const fileInput = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac', multiple: true, className: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'track-input' });

  add(sheet.body,
    h('div', { className: 'ambiance-now' }, status, toggle),
    h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, 'Volume'), volume),
    h('h3', { className: 'settings-group' }, 'Ambiance de ce livre'),
    choices,
    fileInput,
    h('p', { className: 'hint' }, 'Pour mieux retenir : une musique instrumentale, lente et douce gêne le moins la compréhension. La musique s’arrête quand l’écran s’éteint ou que tu quittes le livre.'),
  );

  volume.addEventListener('input', () => player.setVolume(Number(volume.value)));
  volume.addEventListener('change', () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveAmbiancePrefs({ volume: Number(volume.value) }).catch((err: unknown) => logError('ambiance', err)), SAVE_DELAY_MS);
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (selected) void importFiles(selected, files);
  });

  async function togglePlayback(): Promise<void> {
    if (player.playing === 'playing') player.pause();
    else if (player.playing === 'paused') player.resume();
    else if (selected && !(await player.play(selected))) toast('Ajoute d’abord des morceaux à cette ambiance.');
    renderStatus();
  }

  async function choose(id: string | null): Promise<void> {
    selected = id;
    try {
      await setBookAmbiance(bookId, id);
    } catch (err) {
      logError('ambiance', err);
      toast(`Choix non enregistré : ${errorMessage(err)}`, 'error');
    }
    if (!id) player.stop();
    else if (!(await player.play(id))) player.stop();
    await render();
  }

  async function importFiles(ambiance: string, files: File[]): Promise<void> {
    const audio = files.filter(isAudioFile);
    if (files.length && !audio.length) {
      toast('Ces fichiers ne sont pas des fichiers audio (MP3, M4A, OGG…).', 'error');
      return;
    }
    if (!audio.length) return;
    try {
      await withBusy(`Ajout de ${audio.length} morceau${audio.length > 1 ? 'x' : ''}…`, async () => {
        const tracks = await Promise.all(audio.map(async (file) => ({ ambiance, name: file.name, blob: file as Blob, duration: await readDuration(file) })));
        await addTracks(tracks);
      });
      toast(audio.length > 1 ? `${audio.length} morceaux ajoutés.` : 'Morceau ajouté.');
      // L'ambiance du livre attendait des morceaux : elle démarre.
      if (player.current === ambiance) await player.refresh(ambiance);
      else if ((await getBookAmbiance(bookId)) === ambiance) await player.play(ambiance);
    } catch (err) {
      logError('ambiance', err);
      toast(`Ajout impossible : ${errorMessage(err)}`, 'error');
    }
    await render();
  }

  function renderStatus(): void {
    const current = findAmbiance(player.current);
    const state = player.playing;
    status.textContent = state === 'stopped' || !current ? (player.lastError ?? 'Pas de musique en ce moment.') : `${state === 'paused' ? 'En pause' : 'En cours'} : ${current.name}`;
    toggle.replaceChildren(icon(state === 'playing' ? 'pause' : 'play'), state === 'playing' ? 'Pause' : 'Écouter');
    toggle.disabled = state === 'stopped' && !selected;
  }

  async function render(): Promise<void> {
    const counts = await countTracks().catch(() => new Map<string, number>());
    renderStatus();
    clear(choices);
    const option = (id: string | null, name: string, detail: string) => {
      const value = id ?? 'silence';
      const input = h('input', { type: 'radio', name: 'ambiance-choice', id: `amb-${value}`, value, className: 'visually-hidden', checked: selected === id });
      input.addEventListener('change', () => input.checked && void choose(id));
      return [input, h('label', { for: `amb-${value}`, className: 'ambiance-option', 'data-testid': `ambiance-option-${value}` }, h('strong', {}, name), h('small', {}, detail))];
    };
    choices.append(...option(null, 'Silence', 'Pas de musique pour ce livre'));
    for (const group of AMBIANCE_GROUPS) {
      choices.append(h('p', { className: 'ambiance-group' }, group));
      for (const a of AMBIANCES.filter((x) => x.group === group)) {
        const n = counts.get(a.id) ?? 0;
        choices.append(...option(a.id, a.name, `${a.region} · ${n ? `${n} morceau${n > 1 ? 'x' : ''}` : 'aucun morceau'}`));
      }
    }

    clear(tracksBox);
    const ambiance = findAmbiance(selected);
    tracksBox.hidden = !ambiance;
    if (!ambiance) return;
    // Les morceaux s'affichent juste sous l'ambiance choisie.
    choices.querySelector(`label[for="amb-${ambiance.id}"]`)?.after(tracksBox);
    const tracks = await listTracks(ambiance.id).catch(() => []);
    add(tracksBox,
      h('h3', {}, `Morceaux : ${ambiance.name}`),
      tracks.length
        ? h('ul', { className: 'track-list' }, ...tracks.map((t) => h('li', { className: 'track-item', 'data-testid': 'track-item' },
            h('span', { className: 'track-name' }, t.name, t.duration ? h('small', {}, formatDuration(t.duration)) : null),
            h('button', {
              type: 'button', className: 'icon-btn', 'aria-label': `Retirer ${t.name}`, 'data-testid': 'track-delete',
              onclick: async () => {
                await deleteTrack(t.id).catch((err: unknown) => logError('ambiance', err));
                if (player.current === ambiance.id) await player.refresh(ambiance.id);
                await render();
              },
            }, icon('trash')),
          )))
        : h('p', { className: 'hint' }, 'Aucun morceau pour l’instant. Ajoute tes fichiers audio (MP3…) : ils restent sur cet appareil et ne font pas partie des sauvegardes.'),
      h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'add-tracks', onclick: () => fileInput.click() }, icon('plus'), 'Ajouter des morceaux'),
      ambiance.search
        ? h('p', { className: 'music-apps' },
            h('span', {}, `Ou écoute « ${ambiance.search} » dans ton appli de musique (elle s’ouvre hors de Liseuse) : `),
            ...MUSIC_APPS.flatMap((app, i) => [i ? ' · ' : '', h('a', { href: app.url(ambiance.search), target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'music-app-link' }, app.name)]),
          )
        : null,
    );
  }

  const unsubscribe = player.onChange(renderStatus);
  sheet.el.addEventListener('close', () => window.clearTimeout(saveTimer));
  const open = sheet.open.bind(sheet);
  return Object.assign(sheet, {
    open() {
      void (async () => {
        const [prefs, ambiance] = await Promise.all([loadAmbiancePrefs(), getBookAmbiance(bookId)]);
        volume.value = String(prefs.volume);
        selected = ambiance;
        await render();
      })().catch((err: unknown) => logError('ambiance', err));
      open();
    },
    refresh: renderStatus,
    dispose: unsubscribe,
  });
}
