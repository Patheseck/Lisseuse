import { logError } from '../core/errors';
import { isNative } from '../native/platform';
import {
  applyReaderSettings, BRIGHTNESS_RANGE, FONT_SIZE_RANGE, LEADING_RANGE, saveReaderSettings,
  type ParagraphSpacing, type ReaderFont, type ReaderLayout, type ReaderSettings, type ReaderWidth, type Theme,
} from '../storage/settings';
import { add, h } from './dom';
import { createSheet, type Sheet } from './sheet';

const SAVE_DELAY_MS = 300;

function segmented<T extends string>(label: string, name: string, options: [T, string, string?][], value: T, onChange: (v: T) => void, className = ''): HTMLElement {
  const group = h('div', { className: `segmented ${className}`, role: 'radiogroup', 'aria-label': label });
  for (const [v, text, style] of options) {
    const input = h('input', { type: 'radio', name, value: v, id: `${name}-${v}`, className: 'visually-hidden', checked: v === value });
    input.addEventListener('change', () => input.checked && onChange(v));
    group.append(input, h('label', { for: `${name}-${v}`, ...(style ? { style } : {}) }, text));
  }
  return h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, label), group);
}

function toggle(label: string, id: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', id, role: 'switch', className: 'switch', 'data-testid': id, checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { className: 'toggle-row', for: id }, h('span', {}, label, hint ? h('small', {}, hint) : null), input);
}

const THEMES: [Theme, string, string][] = [
  ['auto', 'Auto', 'background:linear-gradient(135deg,#f6f1e7 50%,#17161b 50%);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.95)'],
  ['light', 'Jour', 'background:#f6f1e7;color:#2a241c'],
  ['sepia', 'Sépia', 'background:#f4ecd8;color:#4a3b2a'],
  ['gray', 'Gris', 'background:#3b3d40;color:#e4e2dc'],
  ['dark', 'Nuit', 'background:#17161b;color:#e9e3d3'],
  ['black', 'Noir', 'background:#000;color:#c9c4b8'],
];
const FONTS: [ReaderFont, string, string][] = [
  ['serif', 'Literata', "font-family:'Literata',serif"],
  ['sans', 'Plex Sans', "font-family:'IBM Plex Sans',sans-serif"],
  ['atkinson', 'Atkinson', "font-family:'Atkinson Hyperlegible',sans-serif"],
  ['dyslexic', 'Dyslexie', "font-family:'OpenDyslexic',sans-serif;font-size:0.8em"],
];

/**
 * Feuille « Aa » : réglages appliqués en direct et enregistrés.
 * `onChange` prévient le lecteur (nouvelle pagination, luminosité, options Android).
 */
export function readerSettingsSheet(initial: ReaderSettings, actions: { onChange: (s: ReaderSettings) => void }): Sheet {
  let settings = { ...initial };
  let timer: number | undefined;
  const sheet = createSheet({ title: 'Affichage', kind: 'bottom', testId: 'settings-sheet' });

  const update = (patch: Partial<ReaderSettings>) => {
    settings = { ...settings, ...patch };
    applyReaderSettings(settings);
    actions.onChange(settings);
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

  const range = (label: string, min: number, max: number, step: number, value: number, onCommit: (v: number) => void, onLive: (v: number) => void) => {
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label, className: 'range', 'data-testid': `range-${label}` });
    input.addEventListener('change', () => onCommit(Number(input.value)));
    input.addEventListener('input', () => onLive(Number(input.value)));
    return h('div', { className: 'setting' }, h('span', { className: 'setting-label' }, label), input);
  };

  refreshSize();
  add(sheet.body,
    h('h3', { className: 'settings-group' }, 'Ambiance'),
    segmented<Theme>('Thème', 'set-theme', THEMES, settings.theme, (theme) => update({ theme }), 'swatches'),
    range('Luminosité', BRIGHTNESS_RANGE.min, BRIGHTNESS_RANGE.max, 0.05, settings.brightness,
      (brightness) => update({ brightness }),
      (brightness) => {
        applyReaderSettings({ ...settings, brightness });
      }),

    h('h3', { className: 'settings-group' }, 'Texte'),
    h('div', { className: 'setting' },
      h('span', { className: 'setting-label' }, 'Taille du texte'),
      h('div', { className: 'stepper' }, smaller, size, larger),
    ),
    segmented<ReaderFont>('Police', 'set-font', FONTS, settings.font, (font) => update({ font }), 'fonts'),
    range('Interligne', LEADING_RANGE.min, LEADING_RANGE.max, 0.1, settings.leading,
      (leading) => update({ leading }),
      (leading) => applyReaderSettings({ ...settings, leading })),
    toggle('Texte justifié', 'set-justify', settings.justify, (justify) => update({ justify }), 'Bords alignés, avec césure des mots'),
    segmented<ParagraphSpacing>('Espace entre paragraphes', 'set-paragraph', [['compact', 'Serré'], ['normal', 'Normal'], ['airy', 'Aéré']], settings.paragraph, (paragraph) => update({ paragraph })),
    toggle('Retrait de première ligne', 'set-indent', settings.indent, (indent) => update({ indent })),

    h('h3', { className: 'settings-group' }, 'Mise en page'),
    segmented<ReaderLayout>('Lecture', 'set-layout', [['paged', 'Pages'], ['scroll', 'Défilement']], settings.layout, (layout) => update({ layout })),
    segmented<ReaderWidth>('Marges', 'set-width', [['narrow', 'Larges'], ['normal', 'Normales'], ['wide', 'Fines']], settings.width, (width) => update({ width })),
    isNative() ? toggle('Touches de volume pour tourner les pages', 'set-volume', settings.volumeKeys, (volumeKeys) => update({ volumeKeys })) : null,
    isNative() ? toggle('Écran toujours allumé pendant la lecture', 'set-awake', settings.keepAwake, (keepAwake) => update({ keepAwake })) : null,
    h('p', { className: 'hint' }, 'Pendant la lecture : touche le centre pour afficher les menus, les bords pour tourner les pages. En mode Pages, glisse le doigt de haut en bas sur le bord gauche pour régler la luminosité.'),
  );
  return sheet;
}
