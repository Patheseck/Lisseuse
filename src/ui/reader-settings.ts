import { logError } from '../core/errors';
import {
  applyReaderSettings, FONT_SIZE_RANGE, LEADING_RANGE, saveReaderSettings,
  type ReaderFont, type ReaderSettings, type ReaderWidth, type Theme,
} from '../storage/settings';
import { h } from './dom';
import { createSheet, type Sheet } from './sheet';

const SAVE_DELAY_MS = 300;

function segmented<T extends string>(label: string, name: string, options: [T, string][], value: T, onChange: (v: T) => void): HTMLElement {
  const group = h('div', { className: 'segmented', role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of options) {
    const input = h('input', { type: 'radio', name, value: v, id: `${name}-${v}`, className: 'visually-hidden', checked: v === value });
    input.addEventListener('change', () => input.checked && onChange(v));
    group.append(input, h('label', { for: `${name}-${v}` }, text));
  }
  return h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, label), group);
}

/** Feuille « Aa » : réglages de lecture appliqués en direct et enregistrés. */
export function readerSettingsSheet(initial: ReaderSettings): Sheet {
  let settings = { ...initial };
  let timer: number | undefined;
  const sheet = createSheet({ title: 'Affichage', kind: 'bottom', testId: 'settings-sheet' });

  const update = (patch: Partial<ReaderSettings>) => {
    settings = { ...settings, ...patch };
    applyReaderSettings(settings);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => saveReaderSettings(settings).catch((err: unknown) => logError('réglages', err)), SAVE_DELAY_MS);
    refreshSize();
  };

  // Rendu unique : seules la taille et ses boutons changent ensuite (le focus reste en place).
  const size = h('output', { className: 'setting-value', 'data-testid': 'font-size-value' });
  const smaller = h('button', { type: 'button', className: 'btn', 'aria-label': 'Réduire le texte', onclick: () => update({ fontSize: settings.fontSize - 1 }) }, 'A−');
  const larger = h('button', { type: 'button', className: 'btn', 'aria-label': 'Agrandir le texte', onclick: () => update({ fontSize: settings.fontSize + 1 }) }, 'A+');
  function refreshSize(): void {
    size.textContent = String(settings.fontSize);
    smaller.disabled = settings.fontSize <= FONT_SIZE_RANGE.min;
    larger.disabled = settings.fontSize >= FONT_SIZE_RANGE.max;
  }

  function render(): void {
    refreshSize();
    sheet.body.append(
      h('div', { className: 'setting' },
        h('span', { className: 'setting-label' }, 'Taille du texte'),
        h('div', { className: 'stepper' }, smaller, size, larger),
      ),
      segmented<ReaderFont>('Police', 'set-font', [['serif', 'Avec empattement'], ['sans', 'Sans empattement']], settings.font, (font) => update({ font })),
      (() => {
        const range = h('input', { type: 'range', min: LEADING_RANGE.min, max: LEADING_RANGE.max, step: 0.1, value: settings.leading, 'aria-label': 'Interligne', className: 'range' });
        range.addEventListener('change', () => update({ leading: Number(range.value) }));
        range.addEventListener('input', () => applyReaderSettings({ ...settings, leading: Number(range.value) }));
        return h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, 'Interligne'), range);
      })(),
      segmented<ReaderWidth>('Largeur de colonne', 'set-width', [['narrow', 'Étroite'], ['normal', 'Normale'], ['wide', 'Large']], settings.width, (width) => update({ width })),
      segmented<Theme>('Thème', 'set-theme', [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']], settings.theme, (theme) => update({ theme })),
    );
  }

  render();
  return sheet;
}
