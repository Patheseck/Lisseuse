import { normalizeMojorTable, tableToJson, type MojorTable } from '../core/mnemonic';
import { promisify, tx } from './db';

export type Theme = 'auto' | 'light' | 'sepia' | 'gray' | 'dark' | 'black';
export type ReaderFont = 'serif' | 'sans' | 'atkinson' | 'dyslexic';
export type ReaderWidth = 'narrow' | 'normal' | 'wide';
export type ReaderLayout = 'paged' | 'scroll';
export type ParagraphSpacing = 'compact' | 'normal' | 'airy';

export interface ReaderSettings {
  fontSize: number;
  font: ReaderFont;
  leading: number;
  /** Largeur de la colonne de texte (donc les marges). */
  width: ReaderWidth;
  theme: Theme;
  /** Pages tournées comme un livre, ou défilement continu. */
  layout: ReaderLayout;
  justify: boolean;
  paragraph: ParagraphSpacing;
  /** Retrait de première ligne des paragraphes. */
  indent: boolean;
  /** Luminosité propre à l'app, de 0,3 à 1 (1 = pas d'assombrissement). */
  brightness: number;
  /** Android : tourner les pages avec les touches de volume. */
  volumeKeys: boolean;
  /** Android : l'écran reste allumé pendant la lecture. */
  keepAwake: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18, font: 'serif', leading: 1.7, width: 'normal', theme: 'auto',
  layout: 'paged', justify: true, paragraph: 'normal', indent: false, brightness: 1, volumeKeys: true, keepAwake: true,
};
export const FONT_SIZE_RANGE = { min: 14, max: 32 } as const;
export const LEADING_RANGE = { min: 1.3, max: 2.1 } as const;
export const BRIGHTNESS_RANGE = { min: 0.3, max: 1 } as const;

const THEMES: readonly Theme[] = ['auto', 'light', 'sepia', 'gray', 'dark', 'black'];
const FONTS: readonly ReaderFont[] = ['serif', 'sans', 'atkinson', 'dyslexic'];

const KEY = 'reader';

/** Lecture / écriture brute d'un réglage (migration, sauvegarde). */
export async function getSetting(key: string): Promise<unknown> {
  const row = (await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').get(key)))) as { value?: unknown } | undefined;
  return row?.value;
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await tx(['settings'], 'readwrite', (t) => {
    t.objectStore('settings').put({ key, value });
  });
}

export async function listSettings(): Promise<{ key: string; value: unknown }[]> {
  return (await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').getAll()))) as { key: string; value: unknown }[];
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Valide des réglages venant du stockage ou d'une sauvegarde : toute valeur invalide revient au défaut. */
export function normalizeReaderSettings(raw: unknown): ReaderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReaderSettings, unknown>>;
  const d = DEFAULT_READER_SETTINGS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    fontSize: Math.round(clamp(num(r.fontSize, d.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)),
    font: oneOf(r.font, FONTS, d.font),
    leading: Math.round(clamp(num(r.leading, d.leading), LEADING_RANGE.min, LEADING_RANGE.max) * 10) / 10,
    width: oneOf(r.width, ['narrow', 'normal', 'wide'] as const, d.width),
    theme: oneOf(r.theme, THEMES, d.theme),
    layout: oneOf(r.layout, ['paged', 'scroll'] as const, d.layout),
    justify: bool(r.justify, d.justify),
    paragraph: oneOf(r.paragraph, ['compact', 'normal', 'airy'] as const, d.paragraph),
    indent: bool(r.indent, d.indent),
    brightness: Math.round(clamp(num(r.brightness, d.brightness), BRIGHTNESS_RANGE.min, BRIGHTNESS_RANGE.max) * 100) / 100,
    volumeKeys: bool(r.volumeKeys, d.volumeKeys),
    keepAwake: bool(r.keepAwake, d.keepAwake),
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
/** Marge latérale minimale en mode pages, selon la largeur choisie. */
const PAGE_MARGIN: Record<ReaderWidth, string> = { narrow: '2.2rem', normal: '1.4rem', wide: '0.9rem' };
const FONT_STACKS: Record<ReaderFont, string> = {
  serif: "'Literata', Georgia, serif",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
  dyslexic: "'OpenDyslexic', system-ui, sans-serif",
};
const PARAGRAPH_SPACE: Record<ParagraphSpacing, string> = { compact: '0.35em', normal: '0.9em', airy: '1.5em' };

/** Applique les réglages à toute l'app via les variables CSS et l'attribut de thème. */
export function applyReaderSettings(s: ReaderSettings, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--reader-size', `${s.fontSize}px`);
  root.style.setProperty('--reader-leading', String(s.leading));
  root.style.setProperty('--reader-measure', MEASURE[s.width]);
  root.style.setProperty('--page-margin', PAGE_MARGIN[s.width]);
  root.style.setProperty('--font-read', FONT_STACKS[s.font]);
  root.style.setProperty('--reader-align', s.justify ? 'justify' : 'start');
  root.style.setProperty('--para-space', PARAGRAPH_SPACE[s.paragraph]);
  root.style.setProperty('--para-indent', s.indent ? '1.5em' : '0');
  root.style.setProperty('--dim', String(Math.round((1 - s.brightness) * 100) / 100));
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
}

// ---------- Révision ----------

export interface ReviewSettings {
  /** Nombre maximal de nouvelles fiches introduites par jour (charge de révision soutenable). */
  newPerDay: number;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { newPerDay: 20 };

export function normalizeReviewSettings(raw: unknown): ReviewSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReviewSettings, unknown>>;
  const n = typeof r.newPerDay === 'number' && Number.isFinite(r.newPerDay) ? Math.round(r.newPerDay) : DEFAULT_REVIEW_SETTINGS.newPerDay;
  return { newPerDay: clamp(n, 0, 200) };
}

export async function loadReviewSettings(): Promise<ReviewSettings> {
  const row = (await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').get('review')))) as { value?: unknown } | undefined;
  return normalizeReviewSettings(row?.value);
}

export async function saveReviewSettings(settings: ReviewSettings): Promise<void> {
  await tx(['settings'], 'readwrite', (t) => {
    t.objectStore('settings').put({ key: 'review', value: normalizeReviewSettings(settings) });
  });
}

// ---------- Table Mojor ----------

export async function loadMojorTable(): Promise<MojorTable> {
  return normalizeMojorTable(await getSetting('mojor'));
}

export async function saveMojorTable(table: MojorTable): Promise<void> {
  await putSetting('mojor', tableToJson(table));
}
