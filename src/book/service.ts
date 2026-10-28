import { detectLanguage } from '../core/language';
import { logError } from '../core/errors';
import { decodeText, parseBookFile } from './import';
import { LAYOUT_VERSION, layoutChapters } from './layout';
import { parseEpub, readEpubLanguage, textSample } from './epub';
import { parseLegacy } from './legacy';
import { parseMarkdown } from './markdown';
import { PARSER_VERSION, type Chapter, type ParsedBook } from './types';
import { promisify, tx } from '../storage/db';
import { getBook, getChapterCache, putChapterCache, saveBook, updateBook, type BookRecord } from '../storage/library';
import { layoutHintKey } from '../storage/method';
import { upgradeLayout } from '../storage/relayout';
import { getSetting } from '../storage/settings';

export interface OpenedBook {
  book: BookRecord;
  chapters: Chapter[];
  resources: Record<string, Blob>;
}

/**
 * Découpage à utiliser pour un livre qui entre dans la bibliothèque. Des fiches déjà présentes
 * pour ce livre (restaurées alors qu'il manquait) imposent la version dans laquelle elles ont été
 * créées ; le livre sera ensuite migré à l'ouverture, avec elles.
 */
async function layoutForNewBook(id: string): Promise<number> {
  const hint = await getSetting(layoutHintKey(id));
  if (typeof hint === 'number') return hint;
  const [cards, progress] = await tx(['cards', 'progress'], 'readonly', async (t) => [
    await promisify(t.objectStore('cards').index('bookId').count(id)),
    await promisify(t.objectStore('progress').count(id)),
  ]);
  return cards || progress ? 0 : LAYOUT_VERSION;
}

/** Importe un fichier choisi par l'utilisateur et l'enregistre dans la bibliothèque. */
export async function importBook(file: File): Promise<{ book: BookRecord; existed: boolean }> {
  const { id, parsed } = await parseBookFile(file, file.name);
  const existing = await getBook(id);
  const layout = existing ? (existing.layout ?? 0) : await layoutForNewBook(id);
  const chapters = layoutChapters(parsed.chapters, { format: parsed.format, fileName: file.name }, layout);
  return saveBook(id, { ...parsed, chapters }, file, file.name, layout);
}

/**
 * Charge un livre pour la lecture. Un livre enregistré avec un ancien découpage est migré
 * (chapitres et données) ; le cache des chapitres est reconstruit au besoin depuis le fichier.
 */
export async function openBook(id: string): Promise<OpenedBook> {
  let book = await getBook(id);
  if (!book) throw new Error('Ce livre n’est plus dans la bibliothèque.');
  const cache = await getChapterCache(id);
  let opened: OpenedBook;
  let parsed: ParsedBook | null = null;

  if ((book.layout ?? 0) < LAYOUT_VERSION) {
    const base = cache && (cache.layout ?? 0) === 0 ? cache : (parsed = await parseStoredBook(book));
    const upgraded = await upgradeLayout(book, base.chapters, base.resources);
    opened = { book: upgraded.book, chapters: upgraded.chapters, resources: base.resources };
  } else if (cache && (cache.layout ?? 0) === book.layout) {
    opened = { book, chapters: cache.chapters, resources: cache.resources };
  } else {
    parsed = await parseStoredBook(book);
    const chapters = layoutChapters(parsed.chapters, book, book.layout ?? 0);
    await putChapterCache({ bookId: id, parserVersion: PARSER_VERSION, layout: book.layout ?? 0, chapters, resources: parsed.resources });
    opened = { book, chapters, resources: parsed.resources };
  }

  // Livre importé avant la 6.3 : sa langue n'était pas connue.
  if (opened.book.language === undefined) {
    book = opened.book;
    const language = parsed?.language ?? (book.format === 'epub' ? await readEpubLanguage(book.file) : null) ?? detectLanguage(textSample(opened.chapters));
    opened = { ...opened, book: { ...book, language } };
    await updateBook(id, { language }).catch((err: unknown) => logError('langue', err));
  }
  return opened;
}

/** Réanalyse un livre à partir du fichier conservé dans la bibliothèque (chapitres de l'analyseur). */
export async function parseStoredBook(book: Pick<BookRecord, 'format' | 'file' | 'fileName'>): Promise<ParsedBook> {
  if (book.format === 'epub') return parseEpub(book.file, book.fileName);
  if (book.format === 'legacy') return parseLegacy(await book.file.text());
  return parseMarkdown(decodeText(await book.file.arrayBuffer()) ?? '', book.fileName);
}
