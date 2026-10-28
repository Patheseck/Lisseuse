import { getSetting, putSetting } from './settings';

// Méthode « Lire, Poser, Récupérer » par chapitre, chapitres choisis et signets.
// Tout est rangé dans les réglages (donc inclus dans la sauvegarde).

export type Answered = 'yes' | 'partly' | 'no';
/** Après la restitution : retrouvé facilement, revenu en relisant, mal compris. */
export type GapLevel = 'easy' | 'reread' | 'hard';

export interface GapItem {
  label: string;
  level: GapLevel;
  /** Passage surligné ou fiche d'origine, s'il y en a un. */
  cardId?: string;
}

export interface ChapterGuide {
  /** Question directrice, posée après l'aperçu du chapitre. */
  question: string;
  questionAt: number;
  answered?: Answered;
  main?: string;
  args?: string;
  explain?: string;
  restitutedAt?: number;
  gaps?: GapItem[];
  /** Fiche créée à partir de la question directrice et de l'idée principale. */
  cardId?: string;
}

export interface Bookmark {
  id: string;
  chapter: number;
  offset: number;
  label: string;
  at: number;
}

export const guideKey = (bookId: string) => `guide:${bookId}`;
export const focusKey = (bookId: string) => `focus:${bookId}`;
export const bookmarksKey = (bookId: string) => `bookmarks:${bookId}`;
/** Clés de réglages propres à un livre (supprimées avec lui). */
export const bookSettingKeys = (bookId: string) => [`recall:${bookId}`, `pretest:${bookId}`, guideKey(bookId), focusKey(bookId), bookmarksKey(bookId)];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export async function loadGuides(bookId: string): Promise<Record<string, ChapterGuide>> {
  const value = await getSetting(guideKey(bookId));
  if (!isObject(value)) return {};
  const out: Record<string, ChapterGuide> = {};
  for (const [k, g] of Object.entries(value)) if (isObject(g) && typeof g.question === 'string') out[k] = g as unknown as ChapterGuide;
  return out;
}

export async function saveGuide(bookId: string, chapter: number, guide: ChapterGuide): Promise<void> {
  await putSetting(guideKey(bookId), { ...(await loadGuides(bookId)), [chapter]: guide });
}

/** Chapitres choisis pour l'objectif de lecture ; liste vide = tout le livre. */
export function normalizeFocus(value: unknown, chapterCount: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < chapterCount))].sort((a, b) => a - b);
}

export async function loadFocus(bookId: string, chapterCount: number): Promise<number[]> {
  return normalizeFocus(await getSetting(focusKey(bookId)), chapterCount);
}

export async function saveFocus(bookId: string, chapters: number[]): Promise<void> {
  await putSetting(focusKey(bookId), [...new Set(chapters)].sort((a, b) => a - b));
}

export async function loadBookmarks(bookId: string): Promise<Bookmark[]> {
  const value = await getSetting(bookmarksKey(bookId));
  if (!Array.isArray(value)) return [];
  return (value as Bookmark[])
    .filter((b) => isObject(b) && typeof b.id === 'string' && Number.isInteger(b.chapter) && typeof b.offset === 'number')
    .sort((a, b) => a.chapter - b.chapter || a.offset - b.offset);
}

export async function saveBookmarks(bookId: string, bookmarks: Bookmark[]): Promise<void> {
  await putSetting(bookmarksKey(bookId), bookmarks);
}

// ---------- Préférences de la bibliothèque ----------

export type ShelfView = 'grid' | 'list';
export type ShelfSort = 'recent' | 'title' | 'author' | 'progress';
export interface ShelfPrefs { view: ShelfView; sort: ShelfSort }

export function normalizeShelf(value: unknown): ShelfPrefs {
  const v = isObject(value) ? value : {};
  return {
    view: v.view === 'list' ? 'list' : 'grid',
    sort: (['recent', 'title', 'author', 'progress'] as const).includes(v.sort as ShelfSort) ? (v.sort as ShelfSort) : 'recent',
  };
}

export async function loadShelf(): Promise<ShelfPrefs> {
  return normalizeShelf(await getSetting('shelf'));
}

export async function saveShelf(prefs: ShelfPrefs): Promise<void> {
  await putSetting('shelf', prefs);
}
