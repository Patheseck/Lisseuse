import type { BookFormat, Chapter, ParsedBook } from '../book/types';
import { PARSER_VERSION } from '../book/types';
import { promisify, tx } from './db';
import { bookSettingKeys } from './method';

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
  /**
   * Version du découpage des chapitres (book/layout.ts) à laquelle se réfèrent les fiches,
   * la progression et les signets. Absente : chapitres de l'analyseur (avant la 6.3).
   */
  layout?: number;
  /** Langue du texte (BCP 47), null si inconnue ; absente pour un livre importé avant la 6.3. */
  language?: string | null;
  /** PDF : nombre de pages. */
  pageCount?: number;
  /**
   * PDF : lu en pages originales (par défaut) ou en texte adapté (converti). Les fiches et la
   * méthode s'appuient sur le texte adapté ; les pages s'affichent telles qu'imprimées.
   */
  pdfView?: 'pages' | 'text';
  /** PDF scanné : son texte vient d'une reconnaissance de caractères (OCR), des erreurs sont possibles. */
  ocr?: boolean;
}

/** Ce livre se lit en pages originales (PDF non converti, ou mode « pages » choisi). */
export function readsPages(book: Pick<BookRecord, 'format'> & Partial<Pick<BookRecord, 'pdfView'>>): boolean {
  return book.format === 'pdf' && book.pdfView !== 'text';
}

export interface ChapterCache {
  bookId: string;
  parserVersion: number;
  /** Version du découpage des chapitres en cache (absente : 0). */
  layout?: number;
  /** PDF : version de la conversion du texte (book/pdf-text.ts ; absente : 1). */
  pdfText?: number;
  chapters: Chapter[];
  resources: Record<string, Blob>;
}

export interface ProgressRecord {
  bookId: string;
  chapter: number;
  /** Position dans le chapitre, entre 0 et 1. */
  offset: number;
  updatedAt: number;
  /** PDF en pages originales : page (depuis 0) et position dans la page (0 à 1). */
  page?: number;
  pageOffset?: number;
  /**
   * PDF qui change de mode de lecture (pages ↔ texte adapté) : endroit du livre où reprendre
   * (0 à 1), appliqué une fois par le lecteur suivant.
   */
  jump?: number;
}

/**
 * Enregistre un livre analysé, avec ses chapitres déjà découpés selon `layout`.
 * Si le livre existe déjà, conserve sa date d'ajout.
 */
export async function saveBook(id: string, parsed: ParsedBook, file: Blob, fileName: string, layout = 0): Promise<{ book: BookRecord; existed: boolean }> {
  return tx(['books', 'chapters'], 'readwrite', async (t) => {
    const books = t.objectStore('books');
    const existing = (await promisify(books.get(id))) as BookRecord | undefined;
    const now = Date.now();
    // PDF importé sans conversion : son texte (s'il a déjà été adapté) et son mode de lecture restent.
    const pagesOnly = parsed.format === 'pdf' && !parsed.chapters.length;
    const book: BookRecord = {
      schemaVersion: 1,
      id,
      title: parsed.title,
      author: parsed.author,
      format: parsed.format,
      file,
      fileName,
      cover: parsed.cover,
      chapterCount: pagesOnly ? (existing?.chapterCount ?? 0) : parsed.chapters.length,
      chapterLabels: pagesOnly ? (existing?.chapterLabels ?? []) : parsed.chapters.map((c) => c.label),
      addedAt: existing?.addedAt ?? now,
      lastOpenedAt: now,
      layout,
      language: pagesOnly ? (existing?.language ?? null) : (parsed.language ?? null),
      ...(parsed.pageCount ?? existing?.pageCount ? { pageCount: parsed.pageCount ?? existing?.pageCount } : {}),
      ...(existing?.pdfView ? { pdfView: existing.pdfView } : {}),
      ...(parsed.ocr ?? existing?.ocr ? { ocr: true } : {}),
    };
    books.put(book);
    if (!pagesOnly) t.objectStore('chapters').put({ bookId: id, parserVersion: PARSER_VERSION, layout, chapters: parsed.chapters, resources: parsed.resources } satisfies ChapterCache);
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

/** Met à jour quelques champs d'un livre (langue détectée…). */
export async function updateBook(id: string, patch: Partial<Pick<BookRecord, 'language' | 'title' | 'author' | 'chapterCount' | 'chapterLabels' | 'pageCount' | 'pdfView' | 'ocr'>>): Promise<void> {
  await tx(['books'], 'readwrite', async (t) => {
    const store = t.objectStore('books');
    const book = (await promisify(store.get(id))) as BookRecord | undefined;
    if (book) store.put({ ...book, ...patch });
  });
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
  await tx(['books', 'chapters', 'progress', 'cards', 'reviews', 'settings'], 'readwrite', async (t) => {
    t.objectStore('books').delete(id);
    bookSettingKeys(id).forEach((key) => t.objectStore('settings').delete(key));
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
  await tx(['progress'], 'readwrite', async (t) => {
    const store = t.objectStore('progress');
    const previous = (await promisify(store.get(bookId))) as ProgressRecord | undefined;
    // La position en pages (PDF) est gardée : les deux modes de lecture ont chacun la leur.
    const pages = previous?.page !== undefined ? { page: previous.page, pageOffset: previous.pageOffset ?? 0 } : {};
    store.put({ bookId, chapter, offset: Math.min(1, Math.max(0, offset)), updatedAt: Date.now(), ...pages } satisfies ProgressRecord);
  });
}

/** Endroit où reprendre après un changement de mode de lecture d'un PDF (0 à 1). */
export async function saveJump(bookId: string, fraction: number): Promise<void> {
  await tx(['progress'], 'readwrite', async (t) => {
    const store = t.objectStore('progress');
    const previous = (await promisify(store.get(bookId))) as ProgressRecord | undefined;
    store.put({ ...(previous ?? { bookId, chapter: 0, offset: 0 }), updatedAt: Date.now(), jump: Math.min(1, Math.max(0, fraction)) } satisfies ProgressRecord);
  });
}

/** Position d'un PDF lu en pages originales (la position dans le texte adapté est gardée). */
export async function savePageProgress(bookId: string, page: number, pageOffset: number): Promise<void> {
  await tx(['progress'], 'readwrite', async (t) => {
    const store = t.objectStore('progress');
    const previous = (await promisify(store.get(bookId))) as ProgressRecord | undefined;
    store.put({
      bookId, chapter: previous?.chapter ?? 0, offset: previous?.offset ?? 0, updatedAt: Date.now(),
      page: Math.max(0, Math.round(page)), pageOffset: Math.min(1, Math.max(0, pageOffset)),
    } satisfies ProgressRecord);
  });
}

/**
 * Pourcentage lu, de 0 à 100. Avec des chapitres choisis (`focus`), seuls ceux-là comptent :
 * un chapitre choisi est lu s'il est avant la position, partiellement s'il est en cours.
 */
export function percentRead(
  book: Pick<BookRecord, 'chapterCount'> & Partial<Pick<BookRecord, 'format' | 'pdfView' | 'pageCount'>>,
  progress: Pick<ProgressRecord, 'chapter' | 'offset'> & Partial<Pick<ProgressRecord, 'page' | 'pageOffset'>> | undefined,
  focus: number[] = [],
): number {
  // PDF en pages originales : la page compte, pas le chapitre.
  if (book.format && readsPages({ format: book.format, pdfView: book.pdfView })) {
    if (!progress || progress.page === undefined || !book.pageCount) return 0;
    return Math.round(Math.min(100, Math.max(0, ((progress.page + (progress.pageOffset ?? 0)) / book.pageCount) * 100)));
  }
  if (!progress || book.chapterCount <= 0) return 0;
  let value: number;
  if (focus.length) {
    const done = focus.reduce((sum, c) => sum + (c < progress.chapter ? 1 : c === progress.chapter ? progress.offset : 0), 0);
    value = (done / focus.length) * 100;
  } else {
    value = ((progress.chapter + progress.offset) / book.chapterCount) * 100;
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * Enregistre un livre issu d'une migration ou d'une restauration (dates d'origine conservées).
 * `parsed.chapters` doit correspondre à `book.layout` (absent : chapitres de l'analyseur).
 */
export async function putImportedBook(book: BookRecord, parsed: Pick<ParsedBook, 'chapters' | 'resources'> | null): Promise<void> {
  await tx(['books', 'chapters'], 'readwrite', (t) => {
    t.objectStore('books').put(book);
    if (parsed) t.objectStore('chapters').put({ bookId: book.id, parserVersion: PARSER_VERSION, layout: book.layout ?? 0, chapters: parsed.chapters, resources: parsed.resources } satisfies ChapterCache);
  });
}
