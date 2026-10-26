import { promisify, tx } from './db';

export type Theme = 'auto' | 'light' | 'dark';
export type ReaderFont = 'serif' | 'sans';
export type ReaderWidth = 'narrow' | 'normal' | 'wide';

export interface ReaderSettings {
  fontSize: number;
  font: ReaderFont;
  leading: number;
  width: ReaderWidth;
  theme: Theme;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = { fontSize: 18, font: 'serif', leading: 1.7, width: 'normal', theme: 'auto' };
export const FONT_SIZE_RANGE = { min: 14, max: 28 } as const;
export const LEADING_RANGE = { min: 1.3, max: 2.1 } as const;

const KEY = 'reader';
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Valide des réglages venant du stockage ou d'une sauvegarde : toute valeur invalide revient au défaut. */
export function normalizeReaderSettings(raw: unknown): ReaderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReaderSettings, unknown>>;
  const d = DEFAULT_READER_SETTINGS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    fontSize: Math.round(clamp(num(r.fontSize, d.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)),
    font: r.font === 'sans' || r.font === 'serif' ? r.font : d.font,
    leading: Math.round(clamp(num(r.leading, d.leading), LEADING_RANGE.min, LEADING_RANGE.max) * 10) / 10,
    width: r.width === 'narrow' || r.width === 'wide' || r.width === 'normal' ? r.width : d.width,
    theme: r.theme === 'light' || r.theme === 'dark' || r.theme === 'auto' ? r.theme : d.theme,
  };
}

export async function loadReaderSettings(): Promise<ReaderSettings> {
  const row = (await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').get(KEY)))) as { value?: unknown } | undefined;
  return normalizeReaderSettings(row?.value);
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<void> {
  await tx(['settings'], 'readwrite', (t) => {
    t.objectStore('settings').put({ key: KEY, value: normalizeReaderSettings(settings) });
  });
}

const MEASURE: Record<ReaderWidth, string> = { narrow: '32rem', normal: '40rem', wide: '52rem' };

/** Applique les réglages à toute l'app via les variables CSS. */
export function applyReaderSettings(s: ReaderSettings, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--reader-size', `${s.fontSize}px`);
  root.style.setProperty('--reader-leading', String(s.leading));
  root.style.setProperty('--reader-measure', MEASURE[s.width]);
  root.style.setProperty('--font-read', s.font === 'sans' ? "'IBM Plex Sans', system-ui, sans-serif" : "'Literata', Georgia, serif");
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
}
