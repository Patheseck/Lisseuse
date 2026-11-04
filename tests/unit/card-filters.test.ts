import { describe, expect, it } from 'vitest';
import { cardStatus, endOfDay, filterCards, sortCards, summarize, type FilterableCard } from '../../src/core/card-filters';
import { newSrs, type SrsState } from '../../src/core/scheduler';
import { isReviewable, normalizeCard } from '../../src/storage/cards';

const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const DAY = 86_400_000;
const learned = (over: Partial<SrsState> = {}): SrsState => ({ ...newSrs(NOW - 30 * DAY), state: 2, reps: 4, stability: 5, difficulty: 5, lapses: 0, due: NOW + 3 * DAY, ...over });

function card(id: string, over: Partial<FilterableCard> = {}): FilterableCard {
  return { id, bookId: 'b1', chapter: 0, kind: 'qa', question: `Question ${id} ?`, answer: 'Réponse', steps: [], anchor: { start: 0, quote: 'passage' }, srs: newSrs(NOW), createdAt: NOW, ...over };
}

const cards = [
  card('nouvelle'),
  card('due', { srs: learned({ due: NOW + 2 * 3600_000 }), question: 'Pourquoi le sommeil consolide-t-il la mémoire ?' }),
  card('difficile', { srs: learned({ lapses: 3 }), chapter: 1 }),
  card('maitrisee', { srs: learned({ stability: 40, due: NOW + 30 * DAY }), bookId: 'b2' }),
  card('pause', { srs: learned(), suspended: true }),
  card('surlignage', { kind: 'highlight', srs: null, question: '', anchor: { start: 10, quote: 'La mémoire épisodique' } }),
  card('directrice', { origin: 'guide', createdAt: NOW - DAY }),
  card('etapes', { kind: 'sequence', steps: ['Encodage', 'Stockage'], createdAt: NOW - 2 * DAY }),
];
const ids = (list: FilterableCard[]) => list.map((c) => c.id);
const f = (over: Partial<Parameters<typeof filterCards>[1]>) => ({ book: 'all', type: 'all' as const, state: 'all' as const, query: '', ...over });

describe('Mes fiches : états et filtres', () => {
  it('classe chaque fiche par état', () => {
    expect(ids(filterCards(cards, f({ state: 'new' }), NOW))).toEqual(['nouvelle', 'directrice', 'etapes']);
    expect(ids(filterCards(cards, f({ state: 'due' }), NOW))).toEqual(['due']);
    expect(ids(filterCards(cards, f({ state: 'difficult' }), NOW))).toEqual(['difficile']);
    expect(ids(filterCards(cards, f({ state: 'mastered' }), NOW))).toEqual(['maitrisee']);
    expect(ids(filterCards(cards, f({ state: 'paused' }), NOW))).toEqual(['pause']);
  });

  it('filtre par type et par livre', () => {
    expect(ids(filterCards(cards, f({ type: 'highlight' }), NOW))).toEqual(['surlignage']);
    expect(ids(filterCards(cards, f({ type: 'guide' }), NOW))).toEqual(['directrice']);
    expect(ids(filterCards(cards, f({ type: 'sequence' }), NOW))).toEqual(['etapes']);
    expect(ids(filterCards(cards, f({ type: 'qa' }), NOW))).not.toContain('directrice');
    expect(ids(filterCards(cards, f({ book: 'b2' }), NOW))).toEqual(['maitrisee']);
  });

  it('cherche sans tenir compte des accents ni de la casse, y compris dans les passages et les étapes', () => {
    expect(ids(filterCards(cards, f({ query: 'SOMMEIL' }), NOW))).toEqual(['due']);
    expect(ids(filterCards(cards, f({ query: 'memoire episodique' }), NOW))).toEqual(['surlignage']);
    expect(ids(filterCards(cards, f({ query: 'stockage' }), NOW))).toEqual(['etapes']);
  });

  it('trie par ordre du livre, récence, prochaine révision, difficulté', () => {
    expect(ids(sortCards(cards, 'book', ['b2', 'b1']))[0]).toBe('maitrisee');
    expect(ids(sortCards(cards, 'recent')).slice(-2)).toEqual(['directrice', 'etapes']);
    const byDue = ids(sortCards(cards, 'due'));
    expect(byDue.indexOf('pause')).toBeGreaterThan(byDue.indexOf('maitrisee'));
    expect(byDue.at(-1)).toBe('surlignage');
    expect(ids(sortCards(cards, 'difficult'))[0]).toBe('difficile');
  });

  it('résume et étiquette', () => {
    expect(summarize(cards, NOW)).toEqual({ questions: 7, highlights: 1, dueToday: 1, mastered: 1 });
    expect(cardStatus(cards[1]!, NOW).label).toBe('À revoir');
    expect(cardStatus(cards[4]!, NOW).label).toBe('En pause');
    expect(cardStatus(cards[5]!, NOW).label).toBe('Passage surligné');
    expect(cardStatus(card('x', { srs: learned({ due: NOW + 3 * DAY }) }), NOW).label).toBe('dans 3 j');
    expect(endOfDay(NOW)).toBeGreaterThan(NOW);
  });

  it('une fiche en pause ne revient plus en révision', () => {
    const qa = normalizeCard({ id: 'a', bookId: 'b', chapter: 0, anchor: { start: 0, end: 1, quote: 'x', prefix: '', suffix: '' }, kind: 'qa', srs: newSrs() });
    expect(isReviewable(qa)).toBe(true);
    expect(isReviewable({ ...qa, suspended: true })).toBe(false);
    expect(isReviewable({ ...qa, kind: 'highlight' })).toBe(false);
    expect(normalizeCard({ ...qa, suspended: true }).suspended).toBe(true);
    expect('suspended' in normalizeCard(qa)).toBe(false);
  });
});
