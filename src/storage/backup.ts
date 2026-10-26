// Sauvegarde et restauration. La restauration FUSIONNE : elle n'efface ni n'écrase jamais
// un livre présent, et garde la version la plus récente de chaque fiche.

import { parseStoredBook } from '../book/service';
import { base64ToBytes, bytesToBase64 } from '../core/base64';
import { errorMessage, logError } from '../core/errors';
import { normalizeCard, type CardRecord, type ReviewRecord } from './cards';
import { promisify, tx } from './db';
import { putImportedBook, type BookRecord, type ProgressRecord } from './library';
import { emptyReport, importV5Snapshot, type ImportReport } from './migrate-v5';
import { isV5Backup, snapshotFromV5Backup, type V5Snapshot } from './v5';

export const BACKUP_FORMAT = 6;
const PBKDF2_ITERATIONS = 600_000;
/** Réglages propres à l'appareil, jamais exportés. */
const LOCAL_ONLY_SETTINGS = new Set(['migration-v5']);

interface EncodedBlob {
  type: string;
  data: string;
}

export interface BackupBook extends Omit<BookRecord, 'file' | 'cover'> {
  file?: EncodedBlob;
  cover?: EncodedBlob;
}

export interface BackupV6 {
  app: 'liseuse';
  format: 6;
  exportedAt: string;
  includesBooks: boolean;
  books: BackupBook[];
  cards: CardRecord[];
  reviews: Omit<ReviewRecord, 'id'>[];
  progress: ProgressRecord[];
  settings: { key: string; value: unknown }[];
}

interface EncryptedPayload {
  app?: 'liseuse';
  format?: number;
  encrypted: true;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string | number[];
  iv: string | number[];
  data: string | number[];
}

// ---------- Base64 ----------

export { base64ToBytes, bytesToBase64 };

async function encodeBlob(blob: Blob): Promise<EncodedBlob> {
  return { type: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
}

function decodeBlob(e: EncodedBlob): Blob {
  return new Blob([base64ToBytes(e.data)], { type: e.type });
}

// ---------- Chiffrement (AES-GCM, clé dérivée du mot de passe par PBKDF2) ----------

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plain: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return { app: 'liseuse', format: BACKUP_FORMAT, encrypted: true, kdf: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(data) };
}

/** Déchiffre une sauvegarde V6 (base64) ou V5 (tableaux de nombres). */
export async function decrypt(payload: EncryptedPayload, password: string): Promise<string> {
  const bytes = (v: string | number[]) => (typeof v === 'string' ? base64ToBytes(v) : new Uint8Array(v));
  try {
    const key = await deriveKey(password, bytes(payload.salt), payload.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Mot de passe incorrect ou fichier endommagé.');
  }
}

// ---------- Export ----------

export async function collectBackup(includeBooks: boolean): Promise<BackupV6> {
  const [books, cards, reviews, progress, settings] = await tx(['books', 'cards', 'reviews', 'progress', 'settings'], 'readonly', async (t) => [
    (await promisify(t.objectStore('books').getAll())) as BookRecord[],
    (await promisify(t.objectStore('cards').getAll())) as CardRecord[],
    (await promisify(t.objectStore('reviews').getAll())) as ReviewRecord[],
    (await promisify(t.objectStore('progress').getAll())) as ProgressRecord[],
    (await promisify(t.objectStore('settings').getAll())) as { key: string; value: unknown }[],
  ] as const);
  const encodedBooks: BackupBook[] = [];
  for (const { file, cover, ...meta } of books) {
    encodedBooks.push({
      ...meta,
      ...(includeBooks ? { file: await encodeBlob(file) } : {}),
      ...(includeBooks && cover ? { cover: await encodeBlob(cover) } : {}),
    });
  }
  return {
    app: 'liseuse',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    includesBooks: includeBooks,
    books: encodedBooks,
    cards: cards.map(normalizeCard),
    reviews: reviews.map(({ id: _id, ...r }) => r),
    progress,
    settings: settings.filter((s) => !LOCAL_ONLY_SETTINGS.has(s.key)),
  };
}

export async function exportBackup(opts: { includeBooks: boolean; password?: string }): Promise<{ blob: Blob; fileName: string }> {
  const json = JSON.stringify(await collectBackup(opts.includeBooks));
  const date = new Date().toISOString().slice(0, 10);
  const body = opts.password ? JSON.stringify(await encrypt(json, opts.password)) : json;
  return {
    blob: new Blob([body], { type: 'application/json' }),
    fileName: `liseuse-sauvegarde-${date}${opts.password ? '-chiffree' : ''}.json`,
  };
}

// ---------- Lecture d'un fichier de sauvegarde ----------

export type ParsedBackup = { kind: 'v6'; data: BackupV6 } | { kind: 'v5'; snapshot: V5Snapshot };

export function isEncrypted(data: unknown): data is EncryptedPayload {
  const d = data as Partial<EncryptedPayload> | null;
  return !!d && d.encrypted === true && d.kdf === 'PBKDF2-SHA256' && typeof d.iterations === 'number' && d.data !== undefined;
}

/** Identifie le format (V6, V5, chiffré ou non). `askPassword` est appelé pour un fichier chiffré. */
export async function readBackup(text: string, askPassword: () => Promise<string | null>): Promise<ParsedBackup> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde de la liseuse (JSON illisible).');
  }
  if (isEncrypted(data)) {
    const password = await askPassword();
    if (!password) throw new Error('Restauration annulée.');
    data = JSON.parse(await decrypt(data, password));
  }
  const d = data as Partial<BackupV6> | null;
  if (d && d.app === 'liseuse') {
    if (d.format !== BACKUP_FORMAT) throw new Error('Cette sauvegarde vient d’une version plus récente de l’application.');
    if (!Array.isArray(d.books) || !Array.isArray(d.cards)) throw new Error('Sauvegarde incomplète ou endommagée.');
    return { kind: 'v6', data: d as BackupV6 };
  }
  if (isV5Backup(data)) return { kind: 'v5', snapshot: snapshotFromV5Backup(data) };
  throw new Error('Ce fichier n’est pas une sauvegarde de la liseuse.');
}

// ---------- Restauration par fusion ----------

export async function restoreBackup(parsed: ParsedBackup): Promise<ImportReport> {
  if (parsed.kind === 'v5') return importV5Snapshot(parsed.snapshot);
  const backup = parsed.data;
  const report = emptyReport();

  const [books, cards, reviews, progress, settings] = await tx(['books', 'cards', 'reviews', 'progress', 'settings'], 'readonly', async (t) => [
    new Set((await promisify(t.objectStore('books').getAllKeys())) as string[]),
    new Map(((await promisify(t.objectStore('cards').getAll())) as CardRecord[]).map((c) => [c.id, c])),
    new Set(((await promisify(t.objectStore('reviews').getAll())) as ReviewRecord[]).map((r) => `${r.cardId}|${r.at}`)),
    new Map(((await promisify(t.objectStore('progress').getAll())) as ProgressRecord[]).map((p) => [p.bookId, p])),
    new Set((await promisify(t.objectStore('settings').getAllKeys())) as string[]),
  ] as const);

  // Livres : ajoutés seulement s'ils manquent ; jamais écrasés.
  for (const b of backup.books) {
    if (!b || typeof b.id !== 'string' || books.has(b.id)) continue;
    if (!b.file) {
      report.missingBooks.push(b.title || 'Sans titre');
      continue;
    }
    try {
      const { file: encodedFile, cover: encodedCover, ...meta } = b;
      const record: BookRecord = { ...meta, file: decodeBlob(encodedFile), cover: encodedCover ? decodeBlob(encodedCover) : null };
      const parsedBook = await parseStoredBook(record);
      await putImportedBook({ ...record, chapterCount: parsedBook.chapters.length, chapterLabels: parsedBook.chapters.map((c) => c.label) }, parsedBook);
      report.books++;
    } catch (err) {
      logError('restauration', err);
      report.failures.push(`${b.title || 'Livre sans titre'} : ${errorMessage(err)}`);
    }
  }

  const cardsToPut = backup.cards
    .filter((c) => c && typeof c.id === 'string' && typeof c.bookId === 'string' && c.anchor)
    .map(normalizeCard)
    .filter((c) => {
      const local = cards.get(c.id);
      return !local || c.updatedAt > local.updatedAt;
    });
  const reviewsToAdd = (backup.reviews ?? []).filter((r) => r && typeof r.cardId === 'string' && !reviews.has(`${r.cardId}|${r.at}`));
  const progressToPut = (backup.progress ?? []).filter((p) => p && typeof p.bookId === 'string' && (!progress.has(p.bookId) || p.updatedAt > progress.get(p.bookId)!.updatedAt));
  const settingsToPut = (backup.settings ?? []).filter((s) => s && typeof s.key === 'string' && !LOCAL_ONLY_SETTINGS.has(s.key) && !settings.has(s.key));

  await tx(['cards', 'reviews', 'progress', 'settings'], 'readwrite', (t) => {
    cardsToPut.forEach((c) => t.objectStore('cards').put(c));
    reviewsToAdd.forEach(({ id: _id, ...r }: ReviewRecord) => t.objectStore('reviews').add(r));
    progressToPut.forEach((p) => t.objectStore('progress').put(p));
    settingsToPut.forEach((s) => t.objectStore('settings').put(s));
  });
  report.cards = cardsToPut.length;
  report.reviews = reviewsToAdd.length;
  return report;
}
