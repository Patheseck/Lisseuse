import { parseBookFile } from './import';
import { parseEpub } from './epub';
import { parseLegacy } from './legacy';
import { parseMarkdown } from './markdown';
import { PARSER_VERSION, type Chapter } from './types';
import { getBook, getChapterCache, putChapterCache, saveBook, type BookRecord } from '../storage/library';

export interface OpenedBook {
  book: BookRecord;
  chapters: Chapter[];
  resources: Record<string, Blob>;
}

/** Importe un fichier choisi par l'utilisateur et l'enregistre dans la bibliothèque. */
export async function importBook(file: File): Promise<{ book: BookRecord; existed: boolean }> {
  const { id, parsed } = await parseBookFile(file, file.name);
  return saveBook(id, parsed, file, file.name);
}

/** Charge un livre depuis le cache des chapitres, ou le réanalyse depuis le fichier original. */
export async function openBook(id: string): Promise<OpenedBook> {
  const book = await getBook(id);
  if (!book) throw new Error('Ce livre n’est plus dans la bibliothèque.');
  const cache = await getChapterCache(id);
  if (cache) return { book, chapters: cache.chapters, resources: cache.resources };

  const parsed = await parseStoredBook(book);
  await putChapterCache({ bookId: id, parserVersion: PARSER_VERSION, chapters: parsed.chapters, resources: parsed.resources });
  return { book, chapters: parsed.chapters, resources: parsed.resources };
}

/** Réanalyse un livre à partir du fichier conservé dans la bibliothèque. */
export async function parseStoredBook(book: Pick<BookRecord, 'format' | 'file' | 'fileName'>) {
  if (book.format === 'epub') return parseEpub(book.file, book.fileName);
  if (book.format === 'legacy') return parseLegacy(await book.file.text());
  return parseMarkdown(await book.file.text(), book.fileName);
}
