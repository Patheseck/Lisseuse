import type { Grade4, SrsState } from '../core/scheduler';
import type { TextAnchor } from '../reader/anchor';
import { promisify, tx } from './db';

/**
 * - `highlight` : simple passage surligné, jamais révisé ;
 * - `qa` : question → réponse rédigées par l'utilisateur ;
 * - `sequence` : étapes à rappeler dans l'ordre.
 */
export type CardKind = 'highlight' | 'qa' | 'sequence';

export interface CardRecord {
  schemaVersion: 1;
  id: string;
  bookId: string;
  chapter: number;
  anchor: TextAnchor;
  createdAt: number;
  updatedAt: number;
  kind: CardKind;
  question: string;
  answer: string;
  steps: string[];
  /** État de révision ; null pour un simple surlignage. */
  srs: SrsState | null;
}

/** Confiance annoncée avant de voir la correction. */
export type Confidence = 1 | 2 | 3;

export interface ReviewRecord {
  id?: number;
  cardId: string;
  bookId: string;
  at: number;
  grade: Grade4;
  confidence: Confidence;
  durationMs: number;
  /** Réponse écrite par l'utilisateur avant la correction (peut être vide). */
  answer: string;
  stateBefore: SrsState['state'];
  stabilityBefore: number;
  stabilityAfter: number;
  dueAfter: number;
}

export function newCard(bookId: string, chapter: number, anchor: TextAnchor): CardRecord {
  const now = Date.now();
  return { schemaVersion: 1, id: crypto.randomUUID(), bookId, chapter, anchor, createdAt: now, updatedAt: now, kind: 'highlight', question: '', answer: '', steps: [], srs: null };
}

/** Complète les enregistrements anciens (surlignages de l'étape 2) avec les champs par défaut. */
export function normalizeCard(raw: Partial<CardRecord> & Pick<CardRecord, 'id' | 'bookId' | 'chapter' | 'anchor'>): CardRecord {
  return {
    schemaVersion: 1,
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
    kind: raw.kind ?? 'highlight',
    question: raw.question ?? '',
    answer: raw.answer ?? '',
    steps: raw.steps ?? [],
    srs: raw.srs ?? null,
    id: raw.id,
    bookId: raw.bookId,
    chapter: raw.chapter,
    anchor: raw.anchor,
  };
}

function sortCards(cards: CardRecord[]): CardRecord[] {
  return cards.sort((a, b) => a.chapter - b.chapter || a.anchor.start - b.anchor.start);
}

export async function listCards(bookId: string): Promise<CardRecord[]> {
  const raw = (await tx(['cards'], 'readonly', (t) => promisify(t.objectStore('cards').index('bookId').getAll(bookId)))) as CardRecord[];
  return sortCards(raw.map(normalizeCard));
}

export async function listAllCards(): Promise<CardRecord[]> {
  const raw = (await tx(['cards'], 'readonly', (t) => promisify(t.objectStore('cards').getAll()))) as CardRecord[];
  return raw.map(normalizeCard);
}

export async function putCard(card: CardRecord): Promise<void> {
  await tx(['cards'], 'readwrite', (t) => {
    t.objectStore('cards').put(card);
  });
}

export async function deleteCard(id: string): Promise<void> {
  await tx(['cards', 'reviews'], 'readwrite', async (t) => {
    t.objectStore('cards').delete(id);
    const reviewKeys = await promisify(t.objectStore('reviews').index('cardId').getAllKeys(id));
    reviewKeys.forEach((key) => t.objectStore('reviews').delete(key));
  });
}

/** Enregistre la nouvelle planification de la fiche et l'entrée de journal, de façon atomique. */
export async function recordReview(card: CardRecord, review: ReviewRecord): Promise<void> {
  await tx(['cards', 'reviews'], 'readwrite', (t) => {
    t.objectStore('cards').put(card);
    t.objectStore('reviews').add(review);
  });
}

export async function listReviews(): Promise<ReviewRecord[]> {
  return (await tx(['reviews'], 'readonly', (t) => promisify(t.objectStore('reviews').getAll()))) as ReviewRecord[];
}

/** Redevient un simple surlignage : la question, la réponse et l'historique de révision sont effacés. */
export async function demoteCard(card: CardRecord): Promise<void> {
  await tx(['cards', 'reviews'], 'readwrite', async (t) => {
    t.objectStore('cards').put(card);
    const reviewKeys = await promisify(t.objectStore('reviews').index('cardId').getAllKeys(card.id));
    reviewKeys.forEach((key) => t.objectStore('reviews').delete(key));
  });
}
