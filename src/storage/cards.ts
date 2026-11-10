import type { Grade4, SrsState } from '../core/scheduler';
import type { TextAnchor } from '../reader/anchor';
import { promisify, tx } from './db';

/**
 * - `highlight` : simple passage surligné, jamais révisé ;
 * - `qa` : question → réponse rédigées par l'utilisateur ;
 * - `sequence` : étapes à rappeler dans l'ordre.
 */
export type CardKind = 'highlight' | 'qa' | 'sequence';
export type CardOrigin = 'v5' | 'guide' | 'ideas' | 'link' | 'bilan';

/** Fiche de synthèse (question directrice, idées, lien, bilan) : elle ne renvoie pas à un passage. */
export function isSynthesis(card: Pick<CardRecord, 'origin'>): boolean {
  return card.origin === 'guide' || card.origin === 'ideas' || card.origin === 'link' || card.origin === 'bilan';
}

/** Étiquette du type de fiche, affichée en révision et dans les listes. */
export function originLabel(card: Pick<CardRecord, 'origin' | 'kind'>): string {
  if (card.origin === 'guide') return 'Question directrice';
  if (card.origin === 'ideas') return 'Idées centrales';
  if (card.origin === 'link') return 'Lien entre idées';
  if (card.origin === 'bilan') return 'Bilan du livre';
  return card.kind === 'sequence' ? 'Étapes' : 'Question';
}

/** Où se situe la fiche : son chapitre, ou tout le livre pour une fiche du bilan. */
export function cardPlace(card: Pick<CardRecord, 'origin' | 'chapter'>, chapterLabel: string | undefined): string {
  if (card.origin === 'bilan') return 'Tout le livre';
  return chapterLabel ?? `Chapitre ${card.chapter + 1}`;
}

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
  /** Aide-mémoire (table Mojor, palais mental), repris de la V5 ou créé à l'étape 5. */
  mnemonic?: Mnemonic;
  /**
   * `v5` : fiche reprise de la V5 (question générée, à personnaliser). Les autres sont des fiches
   * de synthèse, sans passage (ancrées au début de leur chapitre, jamais surlignées) :
   * `guide` question directrice, `ideas` idées centrales, `link` lien entre deux idées,
   * `bilan` bilan du livre.
   */
  origin?: CardOrigin;
  /** Fiche mise en pause : elle ne revient plus en révision, sans rien perdre. */
  suspended?: boolean;
}

export interface Mnemonic {
  number: number | null;
  word: string;
  verb: string;
  person: string;
  place: string;
  object: string;
  color: string;
  sound: string;
}

/** Confiance annoncée avant de voir la correction. */
export type Confidence = 1 | 2 | 3;

export interface ReviewRecord {
  id?: number;
  cardId: string;
  bookId: string;
  at: number;
  grade: Grade4;
  /** null pour les révisions reprises de la V5, qui ne demandait pas la confiance. */
  confidence: Confidence | null;
  durationMs: number;
  /** Réponse écrite par l'utilisateur avant la correction (peut être vide). */
  answer: string;
  stateBefore: SrsState['state'];
  stabilityBefore: number;
  stabilityAfter: number;
  dueAfter: number;
  /** L'aide-mémoire a été consulté avant de répondre. */
  hinted?: boolean;
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
    ...(raw.mnemonic ? { mnemonic: raw.mnemonic } : {}),
    ...(raw.origin ? { origin: raw.origin } : {}),
    ...(raw.suspended ? { suspended: true } : {}),
    id: raw.id,
    bookId: raw.bookId,
    chapter: raw.chapter,
    anchor: raw.anchor,
  };
}

/** Fiche qui participe aux révisions : une question (pas un simple surlignage), pas en pause. */
export function isReviewable(card: Pick<CardRecord, 'kind' | 'srs' | 'suspended'>): boolean {
  return card.kind !== 'highlight' && !!card.srs && !card.suspended;
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
