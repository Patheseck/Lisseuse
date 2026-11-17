// Reprise des données de la V5.7 : depuis l'appareil (premier lancement de la V6) ou depuis un
// fichier de sauvegarde V5. Les données V5 d'origine ne sont jamais modifiées ni supprimées.

import { parseBookFile } from '../book/import';
import { legacyBookBlob, parseLegacy } from '../book/legacy';
import { openBook } from '../book/service';
import type { ParsedBook } from '../book/types';
import { errorMessage, logError } from '../core/errors';
import { htmlToText } from '../reader/search';
import { listAllCards, listReviews, type CardRecord, type ReviewRecord } from './cards';
import { promisify, tx } from './db';
import { getBook, getProgress, putImportedBook, type BookRecord } from './library';
import { getSetting, putSetting } from './settings';
import {
  convertCard, convertPrefs, convertProgress, convertReview, relocateCard,
  type V5Book, type V5Card, type V5Progress, type V5ReviewEntry, type V5Snapshot,
} from './v5';

export const V5_DB_NAME = 'liseuse-db';
const V5_STORE = 'books';
const MIGRATION_KEY = 'migration-v5';

export interface ImportReport {
  books: number;
  cards: number;
  reviews: number;
  /** Livres dont le fichier n'est pas disponible : leurs fiches réapparaîtront s'ils sont réimportés. */
  missingBooks: string[];
  failures: string[];
}

export function emptyReport(): ImportReport {
  return { books: 0, cards: 0, reviews: 0, missingBooks: [], failures: [] };
}

// ---------- Lecture des données V5 sur l'appareil ----------

function v5LocalKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith('liseuse:') && !k.startsWith('liseuse:v6:'));
  } catch {
    return [];
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Ouvre la base V5 sans jamais la créer : null si elle n'existe pas. */
function openV5Db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(V5_DB_NAME);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      // La base n'existait pas : on annule pour ne pas la créer.
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(V5_STORE)) {
        db.close();
        resolve(null);
      } else resolve(db);
    };
    req.onerror = () => resolve(null);
  });
}

async function readV5Books(): Promise<V5Book[]> {
  const db = await openV5Db();
  if (!db) return [];
  try {
    return (await promisify(db.transaction(V5_STORE, 'readonly').objectStore(V5_STORE).getAll())) as V5Book[];
  } finally {
    db.close();
  }
}

export async function readDeviceSnapshot(): Promise<V5Snapshot | null> {
  const keys = v5LocalKeys();
  const books = await readV5Books();
  if (!books.length && !keys.some((k) => k.startsWith('liseuse:cards:'))) return null;
  const cards: Record<string, V5Card[]> = {};
  for (const key of keys.filter((k) => k.startsWith('liseuse:cards:'))) {
    cards[key.slice('liseuse:cards:'.length)] = readJson<V5Card[]>(key, []);
  }
  return {
    books,
    cards,
    progress: readJson<Record<string, V5Progress>>('liseuse:progress', {}),
    prefs: readJson<Record<string, unknown>>('liseuse:prefs', {}),
    reviewLog: readJson<V5ReviewEntry[]>('liseuse:review-log', []),
    mojor: readJson<Record<string, unknown> | null>('liseuse:mojor', null),
  };
}

// ---------- Application d'un instantané V5 ----------

function fileNameOf(book: V5Book): string {
  const name = (book.fileBlob as File | null | undefined)?.name || book.sourceName;
  if (name) return name;
  return `${book.title || 'livre'}.${book.format === 'epub' ? 'epub' : 'md'}`;
}

interface BookImport {
  id: string;
  chapterTexts: string[] | null;
}

/** Ajoute le livre V5 à la bibliothèque V6 (sans écraser un livre déjà présent). */
async function importBook(book: V5Book, report: ImportReport): Promise<BookImport> {
  const title = book.title || 'Sans titre';
  let id = book.id;
  let parsed: ParsedBook | null = null;
  let file: Blob | null = null;
  let fileName = fileNameOf(book);

  if (book.fileBlob) {
    const imported = await parseBookFile(book.fileBlob, fileName);
    id = imported.id; // SHA-256 du fichier : identique à un import direct dans la V6
    parsed = imported.parsed;
    file = book.fileBlob;
  } else if (book.chapters?.length) {
    file = legacyBookBlob(title, book.chapters.map((c, i) => ({ label: c.label || `Section ${i + 1}`, html: c.html })));
    parsed = parseLegacy(await file.text());
    fileName = `${title}.json`;
  }

  const existing = await getBook(id);
  if (existing) {
    const opened = await openBook(id).catch(() => null);
    return { id, chapterTexts: opened ? opened.chapters.map((c) => htmlToText(c.html)) : null };
  }
  if (!parsed || !file) {
    report.missingBooks.push(title);
    return { id, chapterTexts: null };
  }
  const record: BookRecord = {
    schemaVersion: 1,
    id,
    title: book.title || parsed.title,
    author: parsed.author,
    format: parsed.format,
    file,
    fileName,
    cover: book.coverBlob ?? parsed.cover,
    chapterCount: parsed.chapters.length,
    chapterLabels: parsed.chapters.map((c) => c.label),
    addedAt: book.addedAt ?? Date.now(),
    lastOpenedAt: book.lastOpenedAt ?? Date.now(),
  };
  await putImportedBook(record, parsed);
  report.books++;
  return { id, chapterTexts: parsed.chapters.map((c) => htmlToText(c.html)) };
}

/** Applique un instantané V5. Peut être relancé sans créer de doublons. */
export async function importV5Snapshot(snapshot: V5Snapshot): Promise<ImportReport> {
  const report = emptyReport();
  const now = Date.now();
  const bookIds = new Map<string, string>();
  const texts = new Map<string, string[] | null>();

  for (const book of snapshot.books) {
    try {
      const { id, chapterTexts } = await importBook(book, report);
      bookIds.set(book.id, id);
      texts.set(id, chapterTexts);
    } catch (err) {
      logError('migration V5', err);
      report.failures.push(`${book.title || 'Livre sans titre'} : ${errorMessage(err)}`);
    }
  }

  // Fiches : y compris celles d'un livre absent (elles réapparaîtront s'il est réimporté).
  const existingCards = new Set((await listAllCards()).map((c) => c.id));
  const cardIds = new Map<string, string>();
  const newCards: CardRecord[] = [];
  for (const [v5BookId, cards] of Object.entries(snapshot.cards)) {
    if (!Array.isArray(cards)) continue;
    const bookId = bookIds.get(v5BookId) ?? v5BookId;
    const chapterTexts = texts.get(bookId) ?? null;
    for (const raw of cards) {
      const card = raw && convertCard(bookId, raw, now);
      if (!card) continue;
      cardIds.set(`${v5BookId}|${raw.id}`, card.id);
      if (existingCards.has(card.id)) continue;
      newCards.push(chapterTexts ? relocateCard(card, chapterTexts) : card);
    }
  }

  // Journal des révisions, sans doublon (même fiche, même instant).
  const seen = new Set((await listReviews()).map((r) => `${r.cardId}|${r.at}`));
  const newReviews: ReviewRecord[] = [];
  for (const entry of snapshot.reviewLog) {
    if (!entry || typeof entry.cardId !== 'string') continue;
    const cardId = cardIds.get(`${entry.bookId}|${entry.cardId}`);
    if (!cardId) continue;
    const review = convertReview(entry, bookIds.get(entry.bookId) ?? entry.bookId, cardId);
    if (!review || seen.has(`${cardId}|${review.at}`)) continue;
    seen.add(`${cardId}|${review.at}`);
    newReviews.push(review);
  }

  await tx(['cards', 'reviews'], 'readwrite', (t) => {
    newCards.forEach((c) => t.objectStore('cards').put(c));
    newReviews.forEach((r) => t.objectStore('reviews').add(r));
  });
  report.cards = newCards.length;
  report.reviews = newReviews.length;

  // Progression : seulement pour les livres sans progression V6.
  for (const [v5BookId, value] of Object.entries(snapshot.progress)) {
    const progress = convertProgress(value);
    const bookId = bookIds.get(v5BookId) ?? v5BookId;
    if (!progress || (await getProgress(bookId))) continue;
    await tx(['progress'], 'readwrite', (t) => {
      t.objectStore('progress').put({ bookId, chapter: progress.chapter, offset: progress.offset, updatedAt: now });
    });
  }

  // Réglages et table Mojor : seulement s'ils n'existent pas encore dans la V6.
  if (Object.keys(snapshot.prefs).length && (await getSetting('reader')) === undefined) await putSetting('reader', convertPrefs(snapshot.prefs));
  if (snapshot.mojor && (await getSetting('mojor')) === undefined) await putSetting('mojor', snapshot.mojor);

  return report;
}

// ---------- Migration automatique au démarrage ----------

/**
 * Au premier lancement de la V6 sur un appareil qui avait la V5.7, reprend toutes ses données.
 * Ne s'exécute qu'une fois ; renvoie null s'il n'y avait rien à reprendre.
 */
export async function migrateDeviceIfNeeded(): Promise<ImportReport | null> {
  if (await getSetting(MIGRATION_KEY)) return null;
  const snapshot = await readDeviceSnapshot();
  if (!snapshot) return null;
  const report = await importV5Snapshot(snapshot);
  await putSetting(MIGRATION_KEY, { at: Date.now(), report });
  return report;
}

export function describeReport(r: ImportReport): string {
  const parts = [`${r.books} livre${r.books > 1 ? 's' : ''}`, `${r.cards} fiche${r.cards > 1 ? 's' : ''}`, `${r.reviews} révision${r.reviews > 1 ? 's' : ''}`];
  return parts.join(', ');
}
