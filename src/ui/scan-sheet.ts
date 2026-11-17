import { errorMessage, logError } from '../core/errors';
import { requestScanAccess, scanFiles, scanStatus, type FoundFile } from '../native/storage-scan';
import { formatSize } from './auto-backup-section';
import { h } from './dom';
import { createSheet, type Sheet } from './sheet';

// Panneau « Importer » de l'app Android : rechercher dans la mémoire du téléphone (avec
// l'autorisation de l'utilisateur), ou choisir un fichier par le sélecteur d'Android, seul
// chemin vers Google Drive (une autre app ne peut pas parcourir le Drive).

/** Livres que Liseuse sait importer. */
export const BOOK_EXTENSIONS = ['epub', 'pdf', 'md', 'markdown', 'txt'];
/** Fichiers de table de rappel : JSON dont le nom évoque Memoria, SECK 5D ou une table. */
export const TABLE_NAME_PATTERN = 'memoria|seck|rappel|table|major|majeur|mojor';

/** Reconnaît un fichier déjà importé : même nom, même taille. */
export const fileKey = (name: string, size: number): string => `${name.toLowerCase()}|${size}`;

/**
 * Dossier lisible : les documents reçus par WhatsApp (rangés par Android dans
 * Android/media/com.whatsapp/…) deviennent « WhatsApp/Documents » ; les autres dossiers
 * d'applis perdent le préfixe Android/media/<appli>.
 */
export function friendlyFolder(folder: string): string {
  const whatsapp = /^Android\/media\/com\.whatsapp(\.w4b)?\/[^/]+\/Media\/[^/]*Documents(?:\/(.*))?$/.exec(folder);
  if (whatsapp) return [`WhatsApp${whatsapp[1] ? ' Business' : ''}`, 'Documents', ...(whatsapp[2] ? [whatsapp[2]] : [])].join('/');
  return folder.replace(/^Android\/media\/[^/]+\//, '');
}

/** « Download › Telegram · 2,4 Mo · 3 nov. 2026 ». */
export function describeFound(f: FoundFile): string {
  const folder = friendlyFolder(f.folder).split('/').filter(Boolean).join(' › ');
  const place = f.volume === 'sd' ? `Carte SD${folder ? ` › ${folder}` : ''}` : folder || 'Mémoire interne';
  const date = new Date(f.modified).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${place} · ${formatSize(f.size)} · ${date}`;
}

/** Les plus récents d'abord. */
export function sortFound(files: FoundFile[]): FoundFile[] {
  return [...files].sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name, 'fr'));
}

export interface ScanSheetOptions {
  title: string;
  testId: string;
  /** Ce qui est cherché : « tes livres (EPUB, PDF, Markdown, texte) ». */
  what: string;
  /** Nom d'un fichier trouvé, au pluriel près : « livre », « fichier ». */
  noun: string;
  extensions: string[];
  namePattern?: string;
  /** Plusieurs fichiers à la fois (livres), ou un seul (table). */
  multiple: boolean;
  /** Fichiers déjà importés (clés `fileKey`). */
  known?: Set<string>;
  /** Ouvre le sélecteur de fichiers d'Android (téléphone, Google Drive…). */
  onPick(): void;
  /** Importe les fichiers choisis ; le panneau est déjà fermé. */
  onImport(files: FoundFile[]): Promise<void>;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function openScanSheet(o: ScanSheetOptions): Sheet {
  const sheet = createSheet({ title: o.title, kind: 'bottom', testId: o.testId, onClose: () => sheet.el.remove() });
  const status = h('p', { className: 'hint', role: 'status', 'aria-live': 'polite', 'data-testid': 'scan-status' });
  const results = h('div', { className: 'scan-results', 'data-testid': 'scan-results' });
  let busy = false;

  const button = (label: string, testId: string, onclick: () => void | Promise<void>, primary = false) =>
    h('button', { type: 'button', className: primary ? 'btn btn-primary' : 'btn', 'data-testid': testId, onclick: () => void onclick() }, label);

  function pick(): void {
    sheet.close();
    o.onPick();
  }

  async function choose(files: FoundFile[]): Promise<void> {
    sheet.close();
    try {
      await o.onImport(files);
    } catch (err) {
      logError('import', err);
    }
  }

  function askAccess(): void {
    status.textContent = '';
    results.replaceChildren(h('div', { className: 'scan-permission', 'data-testid': 'scan-permission' },
      h('p', {}, 'Pour chercher dans tout le téléphone, Liseuse a besoin de l’autorisation « Accès à tous les fichiers » : Android ouvre la page où l’activer, puis reviens ici.'),
      h('p', { className: 'hint' }, 'Liseuse ne lit que les noms des fichiers et n’ouvre que ceux que tu importes ; rien ne quitte le téléphone. Tu peux retirer l’autorisation à tout moment dans les réglages d’Android.'),
      button('Autoriser l’accès aux fichiers', 'scan-allow', allow, true),
    ));
  }

  async function allow(): Promise<void> {
    const { granted } = await requestScanAccess().catch(() => ({ granted: false }));
    if (granted) await search();
    else status.textContent = 'Autorisation non accordée : tu peux toujours choisir un fichier.';
  }

  async function search(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const { granted } = await scanStatus().catch(() => ({ granted: false }));
      if (!granted) return askAccess();
      results.replaceChildren();
      status.textContent = 'Recherche dans le téléphone…';
      const { files, truncated } = await scanFiles({ extensions: o.extensions, ...(o.namePattern ? { namePattern: o.namePattern } : {}), maxResults: 1000 });
      show(sortFound(files), truncated);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'DENIED') return askAccess();
      logError('recherche de fichiers', err);
      status.textContent = `Recherche impossible : ${errorMessage(err)}`;
    } finally {
      busy = false;
    }
  }

  function show(files: FoundFile[], truncated: boolean): void {
    const known = (f: FoundFile) => !!o.known?.has(fileKey(f.name, f.size));
    const knownCount = files.filter(known).length;
    if (!files.length) {
      status.textContent = 'Rien trouvé dans le téléphone. Choisis un fichier, par exemple dans Google Drive.';
      results.replaceChildren();
      return;
    }
    status.textContent = `${plural(files.length, o.noun)} trouvé${files.length > 1 ? 's' : ''}${knownCount ? `, dont ${knownCount} déjà importé${knownCount > 1 ? 's' : ''}` : ''}.${truncated ? ' Recherche arrêtée avant la fin (trop de fichiers) : s’il manque le tien, choisis-le directement.' : ''}`;
    if (!o.multiple) {
      results.replaceChildren(...files.map((f) => h('button', { type: 'button', className: 'scan-choice', 'data-testid': 'scan-item', onclick: () => void choose([f]) },
        h('span', { className: 'scan-name' }, f.name), h('small', {}, describeFound(f)))));
      return;
    }
    const selected = new Set<FoundFile>();
    const importButton = button('Importer', 'scan-import', () => choose(files.filter((f) => selected.has(f))), true);
    const refresh = () => {
      importButton.toggleAttribute('disabled', !selected.size);
      importButton.textContent = selected.size ? `Importer ${plural(selected.size, o.noun)}` : 'Importer';
    };
    const inputs: { f: FoundFile; input: HTMLInputElement }[] = [];
    const items = files.map((f) => {
      const already = known(f);
      const input = h('input', { type: 'checkbox', disabled: already });
      input.addEventListener('change', () => {
        if (input.checked) selected.add(f);
        else selected.delete(f);
        refresh();
      });
      if (!already) inputs.push({ f, input });
      return h('label', { className: `check scan-item${already ? ' scan-known' : ''}`, 'data-testid': 'scan-item' }, input,
        h('span', {}, h('span', { className: 'scan-name' }, f.name), h('small', {}, already ? `${describeFound(f)} · déjà dans ta bibliothèque` : describeFound(f))));
    });
    const selectAll = button('Tout sélectionner', 'scan-select-all', () => {
      for (const { f, input } of inputs) {
        input.checked = true;
        selected.add(f);
      }
      refresh();
    });
    refresh();
    results.replaceChildren(h('div', { className: 'scan-list' }, ...items), h('div', { className: 'sheet-actions scan-actions' }, ...(inputs.length > 1 ? [selectAll] : []), importButton));
  }

  sheet.body.append(
    h('p', { className: 'hint' }, `Cherche ${o.what} dans la mémoire du téléphone, ou choisis un fichier, y compris dans Google Drive.`),
    h('div', { className: 'scan-buttons' },
      button('Rechercher dans le téléphone', 'scan-phone', search, true),
      button('Choisir un fichier (téléphone, Google Drive…)', 'scan-pick', pick),
    ),
    h('p', { className: 'hint', 'data-testid': 'scan-drive-hint' }, 'Google Drive ne peut pas être parcouru par une autre app : touche « Choisir un fichier », puis ☰ › Drive ; la loupe 🔍 de cette fenêtre y cherche par nom.'),
    status,
    results,
  );
  return sheet;
}
