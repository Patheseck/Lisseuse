// Conversion des données de la V5.7 vers le modèle V6. Fonctions pures, testées unitairement.
// Le format V5 est décrit d'après legacy/v5.7/www/index.html (localStorage + IndexedDB « liseuse-db »).

import { newSrs, type SrsState } from '../core/scheduler';
import { anchorFromOffsets, locateLoose, type TextAnchor } from '../reader/anchor';
import type { CardRecord, Mnemonic, ReviewRecord } from './cards';
import { DEFAULT_READER_SETTINGS, normalizeReaderSettings, type ReaderSettings } from './settings';

const DAY_MS = 86400000;

export interface V5Book {
  id: string;
  title?: string;
  format?: string;
  fileBlob?: Blob | null;
  coverBlob?: Blob | null;
  chapters?: { label?: string | null; html: string }[];
  addedAt?: number;
  lastOpenedAt?: number;
  sourceName?: string;
}

export interface V5Association {
  word?: string; verb?: string; person?: string; place?: string; object?: string; color?: string; sound?: string;
}

export interface V5Card {
  id: string;
  chapter?: number;
  text?: string;
  createdAt?: number;
  mojorNumber?: number | null;
  association?: V5Association | null;
  mode?: 'concept' | 'sequence' | 'verbatim' | string;
  reformulation?: string;
  sequenceItems?: string[];
  review?: {
    fsrs?: { difficulty?: number; stability?: number; reps?: number; lapses?: number; lastReviewed?: number | null } | null;
    due?: number;
    interval?: number;
    lastReviewed?: number;
    // Ancien SM-2 (avant la V3)
    ef?: number;
    n?: number;
  } | null;
}

export interface V5ReviewEntry {
  cardId: string;
  bookId: string;
  timestamp: number;
  rating: number;
  stabilityBefore?: number;
  stabilityAfter?: number;
  intervalDays?: number;
  recallSeconds?: number | null;
}

export type V5Progress = number | { chapter?: number; scrollTop?: number; updatedAt?: number };

/** Instantané complet des données V5, lu sur l'appareil ou dans un fichier de sauvegarde V5. */
export interface V5Snapshot {
  books: V5Book[];
  cards: Record<string, V5Card[]>;
  progress: Record<string, V5Progress>;
  prefs: Record<string, unknown>;
  reviewLog: V5ReviewEntry[];
  mojor: Record<string, unknown> | null;
}

/** Identifiant V6 d'une fiche V5 : les id V5 n'étaient uniques qu'au sein d'un livre. */
export function v5CardId(bookId: string, cardId: string): string {
  return `v5:${bookId.slice(0, 16)}:${cardId}`;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** État de révision V5 (FSRS ou ancien SM-2) → état FSRS V6. Null si la fiche n'était pas révisable. */
export function convertSrs(card: V5Card, now: number): SrsState | null {
  const r = card.review;
  const encoded = card.mojorNumber !== null && card.mojorNumber !== undefined;
  if (!r) return encoded ? newSrs(card.createdAt ?? now) : null;
  const fsrs = r.fsrs;
  const reps = num(fsrs?.reps) ?? num(r.n) ?? 0;
  if (reps <= 0) return newSrs(card.createdAt ?? now);
  // Même approximation que la V5 pour les fiches SM-2 jamais converties.
  const ef = num(r.ef) ?? 2.5;
  const difficulty = clamp(num(fsrs?.difficulty) ?? 7 - (ef - 2.5) * 2, 1, 10);
  const stability = Math.max(0.1, num(fsrs?.stability) ?? num(r.interval) ?? 1);
  const lastReview = num(fsrs?.lastReviewed) ?? num(r.lastReviewed);
  const due = num(r.due) ?? (lastReview ?? now) + stability * DAY_MS;
  return {
    due,
    stability,
    difficulty,
    scheduledDays: Math.max(0, Math.round(num(r.interval) ?? stability)),
    learningSteps: 0,
    reps,
    lapses: num(fsrs?.lapses) ?? 0,
    state: 2, // Review
    lastReview,
  };
}

function convertMnemonic(card: V5Card): Mnemonic | undefined {
  const a = card.association ?? {};
  const m: Mnemonic = {
    number: num(card.mojorNumber),
    word: a.word ?? '', verb: a.verb ?? '', person: a.person ?? '', place: a.place ?? '',
    object: a.object ?? '', color: a.color ?? '', sound: a.sound ?? '',
  };
  return m.number !== null || Object.entries(m).some(([k, v]) => k !== 'number' && v) ? m : undefined;
}

const QUESTIONS: Record<string, string> = {
  concept: 'Quelle est l’idée essentielle de ce passage ?',
  verbatim: 'Récite ce passage aussi fidèlement que possible.',
  sequence: 'Quelles sont les étapes, dans l’ordre ?',
};

/** Fiche V5 → fiche V6. L'ancre ne contient que la citation : elle est relocalisée ensuite. */
export function convertCard(bookId: string, card: V5Card, now: number): CardRecord | null {
  const text = (card.text ?? '').trim();
  if (!card.id || !text) return null;
  const srs = convertSrs(card, now);
  const steps = (card.sequenceItems ?? []).map((s) => s.trim()).filter(Boolean);
  const reformulation = (card.reformulation ?? '').trim();
  const kind: CardRecord['kind'] = !srs && !reformulation ? 'highlight' : card.mode === 'sequence' && steps.length >= 2 ? 'sequence' : 'qa';
  const anchor: TextAnchor = { start: 0, end: 0, quote: text, prefix: '', suffix: '' };
  const mnemonic = convertMnemonic(card);
  const createdAt = num(card.createdAt) ?? now;
  return {
    schemaVersion: 1,
    id: v5CardId(bookId, card.id),
    bookId,
    chapter: Math.max(0, Math.trunc(num(card.chapter) ?? 0)),
    anchor,
    createdAt,
    updatedAt: createdAt,
    kind,
    question: kind === 'highlight' ? '' : kind === 'sequence' ? QUESTIONS.sequence! : (QUESTIONS[card.mode ?? 'concept'] ?? QUESTIONS.concept!),
    answer: kind === 'qa' ? reformulation || text : '',
    steps: kind === 'sequence' ? steps : [],
    srs: kind === 'highlight' ? null : srs ?? newSrs(createdAt),
    ...(mnemonic ? { mnemonic } : {}),
    origin: 'v5',
  };
}

/**
 * Retrouve chaque citation V5 dans le texte des chapitres V6 : d'abord dans le chapitre
 * indiqué, puis dans les autres (le découpage en chapitres a pu légèrement changer).
 */
export function relocateCard(card: CardRecord, chapterTexts: string[]): CardRecord {
  const order = [card.chapter, ...chapterTexts.keys()].filter((c, i, a) => c < chapterTexts.length && a.indexOf(c) === i);
  for (const chapter of order) {
    const text = chapterTexts[chapter]!;
    const found = locateLoose(text, card.anchor.quote);
    if (found) return { ...card, chapter, anchor: anchorFromOffsets(text, found.start, found.end) };
  }
  return { ...card, chapter: Math.min(card.chapter, Math.max(0, chapterTexts.length - 1)) };
}

/** Entrée du journal V5 → révision V6 (confiance inconnue). */
export function convertReview(entry: V5ReviewEntry, bookId: string, cardId: string): ReviewRecord | null {
  const at = num(entry.timestamp);
  const rating = num(entry.rating);
  if (at === null || rating === null) return null;
  const grade = clamp(Math.round(rating), 1, 4) as 1 | 2 | 3 | 4;
  const before = num(entry.stabilityBefore) ?? 0;
  return {
    cardId,
    bookId,
    at,
    grade,
    confidence: null,
    durationMs: Math.round((num(entry.recallSeconds) ?? 0) * 1000),
    answer: '',
    stateBefore: before > 0 ? 2 : 0,
    stabilityBefore: before,
    stabilityAfter: num(entry.stabilityAfter) ?? before,
    dueAfter: at + (num(entry.intervalDays) ?? 0) * DAY_MS,
  };
}

export function convertProgress(value: V5Progress | undefined): { chapter: number; offset: number } | null {
  if (typeof value === 'number') return { chapter: Math.max(0, Math.trunc(value)), offset: 0 };
  if (!value || typeof value !== 'object') return null;
  const chapter = num(value.chapter);
  // La V5 mémorisait une position en pixels, sans équivalent fiable : on reprend au début du chapitre.
  return chapter === null ? null : { chapter: Math.max(0, Math.trunc(chapter)), offset: 0 };
}

export function convertPrefs(prefs: Record<string, unknown>): ReaderSettings {
  return normalizeReaderSettings({
    fontSize: prefs.fontSize ?? DEFAULT_READER_SETTINGS.fontSize,
    font: prefs.readerFont === 'sans' ? 'sans' : 'serif',
    leading: prefs.readerLeading ?? DEFAULT_READER_SETTINGS.leading,
    width: DEFAULT_READER_SETTINGS.width,
    theme: prefs.theme ?? 'auto',
  });
}

/** Valide grossièrement une sauvegarde V5 (formatVersion ≤ 4) et la transforme en instantané. */
export function snapshotFromV5Backup(data: unknown): V5Snapshot {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!Array.isArray(d.books)) throw new Error('Sauvegarde V5 invalide : liste de livres absente.');
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return {
    books: (d.books as V5Book[]).filter((b) => b && typeof b.id === 'string'),
    cards: obj(d.cards) as Record<string, V5Card[]>,
    progress: obj(d.progress) as Record<string, V5Progress>,
    prefs: obj(d.prefs),
    reviewLog: Array.isArray(d.reviewLog) ? (d.reviewLog as V5ReviewEntry[]) : [],
    mojor: d.mojor && typeof d.mojor === 'object' ? (d.mojor as Record<string, unknown>) : null,
  };
}

export function isV5Backup(data: unknown): boolean {
  const d = data as Record<string, unknown> | null;
  return !!d && typeof d === 'object' && Array.isArray(d.books) && !('app' in d) && Number(d.formatVersion ?? d.version ?? 1) <= 4;
}
