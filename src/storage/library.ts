import type { BookFormat, Chapter, ParsedBook } from '../book/types';
import { PARSER_VERSION } from '../book/types';
import { promisify, tx } from './db';

export interface BookRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  /** Fichier original : source de vérité, permet de réanalyser le livre. */
  file: Blob;
  fileName: string;
  cover: Blob | null;
  chapterCount: number;
  /** Titres des chapitres (absents des livres importés avant l'étape 3). */
  chapterLabels?: string[];
  addedAt: number;
  lastOpenedAt: number;
}

export interface ChapterCache {
  bookId: string;
  parserVersion: number;
  chapters: Chapter[];
  resources: Record<string, Blob>;
}

export interface ProgressRecord {
  bookId: string;
  chapter: number;
  /** Position dans le chapitre, entre 0 et 1. */
  offset: number;
  updatedAt: number;
}

/** Enregistre un livre analysé. Si le livre existe déjà, conserve sa date d'ajout. */
export async function saveBook(id: string, parsed: ParsedBook, file: Blob, fileName: string): Promise<{ book: BookRecord; existed: boolean }> {
  return tx(['books', 'chapters'], 'readwrite', async (t) => {
    const books = t.objectStore('books');
    const existing = (await promisify(books.get(id))) as BookRecord | undefined;
    const now = Date.now();
    const book: BookRecord = {
      schemaVersion: 1,
      id,
      title: parsed.title,
      author: parsed.author,
      format: parsed.format,
      file,
      fileName,
      cover: parsed.cover,
      chapterCount: parsed.chapters.length,
      chapterLabels: parsed.chapters.map((c) => c.label),
      addedAt: existing?.addedAt ?? now,
      lastOpenedAt: now,
    };
    books.put(book);
    t.objectStore('chapters').put({ bookId: id, parserVersion: PARSER_VERSION, chapters: parsed.chapters, resources: parsed.resources } satisfies ChapterCache);
    return { book, existed: !!existing };
  });
}

export function getBook(id: string): Promise<BookRecord | undefined> {
  return tx(['books'], 'readonly', (t) => promisify(t.objectStore('books').get(id)) as Promise<BookRecord | undefined>);
}

export async function listBooks(): Promise<BookRecord[]> {
  const books = (await tx(['books'], 'readonly', (t) => promisify(t.objectStore('books').getAll()))) as BookRecord[];
  return books.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function touchBook(id: string): Promise<void> {
  await tx(['books'], 'readwrite', async (t) => {
    const store = t.objectStore('books');
    const book = (await promisify(store.get(id))) as BookRecord | undefined;
    if (book) store.put({ ...book, lastOpenedAt: Date.now() });
  });
}

export async function getChapterCache(id: string): Promise<ChapterCache | undefined> {
  const cache = (await tx(['chapters'], 'readonly', (t) => promisify(t.objectStore('chapters').get(id)))) as ChapterCache | undefined;
  return cache?.parserVersion === PARSER_VERSION ? cache : undefined;
}

export async function putChapterCache(cache: ChapterCache): Promise<void> {
  await tx(['chapters'], 'readwrite', (t) => {
    t.objectStore('chapters').put(cache);
  });
}

/** Supprime un livre et tout ce qui s'y rattache (chapitres, progression, fiches, révisions). */
export async function deleteBook(id: string): Promise<void> {
  await tx(['books', 'chapters', 'progress', 'cards', 'reviews'], 'readwrite', async (t) => {
    t.objectStore('books').delete(id);
    t.objectStore('chapters').delete(id);
    t.objectStore('progress').delete(id);
    const cardKeys = await promisify(t.objectStore('cards').index('bookId').getAllKeys(id));
    cardKeys.forEach((key) => t.objectStore('cards').delete(key));
    const reviewKeys = await promisify(t.objectStore('reviews').index('bookId').getAllKeys(id));
    reviewKeys.forEach((key) => t.objectStore('reviews').delete(key));
  });
}

export function getProgress(bookId: string): Promise<ProgressRecord | undefined> {
  return tx(['progress'], 'readonly', (t) => promisify(t.objectStore('progress').get(bookId)) as Promise<ProgressRecord | undefined>);
}

export async function listProgress(): Promise<Map<string, ProgressRecord>> {
  const all = (await tx(['progress'], 'readonly', (t) => promisify(t.objectStore('progress').getAll()))) as ProgressRecord[];
  return new Map(all.map((p) => [p.bookId, p]));
}

export async function saveProgress(bookId: string, chapter: number, offset: number): Promise<void> {
  await tx(['progress'], 'readwrite', (t) => {
    t.objectStore('progress').put({ bookId, chapter, offset: Math.min(1, Math.max(0, offset)), updatedAt: Date.now() } satisfies ProgressRecord);
  });
}

/** Pourcentage lu, de 0 à 100. */
export function percentRead(book: Pick<BookRecord, 'chapterCount'>, progress: Pick<ProgressRecord, 'chapter' | 'offset'> | undefined): number {
  if (!progress || book.chapterCount <= 0) return 0;
  const value = ((progress.chapter + progress.offset) / book.chapterCount) * 100;
  return Math.round(Math.min(100, Math.max(0, value)));
}
