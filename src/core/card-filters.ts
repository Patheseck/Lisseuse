import { isNew, type SrsState } from './scheduler';
import { fold } from '../reader/search';

// « Mes fiches » : état de chaque fiche, filtres, recherche et tris (logique sans interface).

export type CardType = 'all' | 'qa' | 'sequence' | 'highlight' | 'guide';
export type CardStateFilter = 'all' | 'new' | 'due' | 'difficult' | 'mastered' | 'paused';
export type CardSort = 'book' | 'recent' | 'due' | 'difficult';

/** Ce dont les filtres ont besoin d'une fiche. */
export interface FilterableCard {
  id: string;
  bookId: string;
  chapter: number;
  kind: 'highlight' | 'qa' | 'sequence';
  origin?: 'v5' | 'guide';
  question: string;
  answer: string;
  steps: string[];
  anchor: { start: number; quote: string };
  srs: SrsState | null;
  suspended?: boolean;
  createdAt: number;
}

/** Une fiche est « maîtrisée » quand sa mémoire tient au moins trois semaines. */
export const MASTERED_DAYS = 21;
/** « Difficile » : oubliée au moins deux fois, ou jugée très difficile par l'algorithme. */
export const DIFFICULT_LAPSES = 2;
export const DIFFICULT_DIFFICULTY = 8;

export function endOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isDifficult(srs: SrsState): boolean {
  return srs.lapses >= DIFFICULT_LAPSES || srs.difficulty >= DIFFICULT_DIFFICULTY;
}

export function isMastered(srs: SrsState): boolean {
  return !isNew(srs) && srs.stability >= MASTERED_DAYS;
}

export function isDueToday(srs: SrsState, now: number): boolean {
  return !isNew(srs) && srs.due <= endOfDay(now);
}

export function matchesType(card: FilterableCard, type: CardType): boolean {
  if (type === 'all') return true;
  if (type === 'guide') return card.origin === 'guide';
  if (type === 'qa') return card.kind === 'qa' && card.origin !== 'guide';
  return card.kind === type;
}

export function matchesState(card: FilterableCard, state: CardStateFilter, now: number): boolean {
  if (state === 'all') return true;
  if (state === 'paused') return !!card.suspended && card.kind !== 'highlight';
  const srs = card.srs;
  if (!srs || card.kind === 'highlight' || card.suspended) return false;
  if (state === 'new') return isNew(srs);
  if (state === 'due') return isDueToday(srs, now);
  if (state === 'difficult') return isDifficult(srs);
  return isMastered(srs);
}

/** Texte cherché : question, réponse, étapes et passage, sans tenir compte des accents ni de la casse. */
export function matchesQuery(card: FilterableCard, query: string): boolean {
  const q = fold(query.trim().replace(/\s+/g, ' '));
  if (!q) return true;
  return fold([card.question, card.answer, card.steps.join(' '), card.anchor.quote].join(' ').replace(/\s+/g, ' ')).includes(q);
}

export interface CardFilters {
  book: string | 'all';
  type: CardType;
  state: CardStateFilter;
  query: string;
}

export function filterCards<T extends FilterableCard>(cards: readonly T[], f: CardFilters, now: number): T[] {
  return cards.filter((c) => (f.book === 'all' || c.bookId === f.book) && matchesType(c, f.type) && matchesState(c, f.state, now) && matchesQuery(c, f.query));
}

/**
 * Tri : ordre du livre (livres dans l'ordre donné, puis chapitre et position), plus récentes,
 * prochaine révision (surlignages et fiches en pause à la fin), ou plus difficiles d'abord.
 */
export function sortCards<T extends FilterableCard>(cards: readonly T[], sort: CardSort, bookOrder: readonly string[] = []): T[] {
  const rank = new Map(bookOrder.map((id, i) => [id, i]));
  const byBook = (a: T, b: T) => (rank.get(a.bookId) ?? Infinity) - (rank.get(b.bookId) ?? Infinity) || a.bookId.localeCompare(b.bookId) || a.chapter - b.chapter || a.anchor.start - b.anchor.start;
  const due = (c: T) => (c.srs && !c.suspended && c.kind !== 'highlight' ? c.srs.due : Infinity);
  const hardness = (c: T) => (c.srs ? c.srs.lapses * 10 + c.srs.difficulty : -1);
  const compare: Record<CardSort, (a: T, b: T) => number> = {
    book: byBook,
    recent: (a, b) => b.createdAt - a.createdAt,
    due: (a, b) => due(a) - due(b) || byBook(a, b),
    difficult: (a, b) => hardness(b) - hardness(a) || byBook(a, b),
  };
  return [...cards].sort(compare[sort]);
}

export interface CardSummary {
  questions: number;
  highlights: number;
  dueToday: number;
  mastered: number;
}

export function summarize(cards: readonly FilterableCard[], now: number): CardSummary {
  let questions = 0;
  let highlights = 0;
  let dueToday = 0;
  let mastered = 0;
  for (const c of cards) {
    if (c.kind === 'highlight' || !c.srs) {
      highlights++;
      continue;
    }
    questions++;
    if (c.suspended) continue;
    if (isDueToday(c.srs, now)) dueToday++;
    if (isMastered(c.srs)) mastered++;
  }
  return { questions, highlights, dueToday, mastered };
}

export type StatusTone = 'passage' | 'paused' | 'new' | 'due' | 'hard' | 'done' | 'later';

/** Étiquette d'état affichée dans la liste : la plus utile d'abord. */
export function cardStatus(card: FilterableCard, now: number): { label: string; tone: StatusTone } {
  const srs = card.srs;
  if (card.kind === 'highlight' || !srs) return { label: 'Passage surligné', tone: 'passage' };
  if (card.suspended) return { label: 'En pause', tone: 'paused' };
  if (isNew(srs)) return { label: 'Nouvelle', tone: 'new' };
  if (isDueToday(srs, now)) return { label: 'À revoir', tone: 'due' };
  if (isDifficult(srs)) return { label: 'Difficile', tone: 'hard' };
  if (isMastered(srs)) return { label: 'Maîtrisée', tone: 'done' };
  const days = Math.max(1, Math.round((srs.due - now) / 86_400_000));
  return { label: `dans ${days} j`, tone: 'later' };
}
