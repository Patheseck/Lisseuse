import { describe, expect, it } from 'vitest';
import { formatInterval, isNew, newSrs, preview, rate, retrievability } from '../../src/core/scheduler';
import { interleave, newIntroducedToday, planSession, shouldRequeue, startOfDay, type QueueCard } from '../../src/core/session';

const DAY = 86400000;
const MIN = 60000;
const NOW = new Date('2026-03-10T10:00:00').getTime();

describe('scheduler (FSRS-6 via ts-fsrs)', () => {
  it('une fiche neuve est due immédiatement', () => {
    const s = newSrs(NOW);
    expect(isNew(s)).toBe(true);
    expect(s.due).toBe(NOW);
    expect(retrievability(s, NOW)).toBe(0);
  });

  it('« Encore » sur une fiche neuve la fait revenir dans la séance', () => {
    const s = rate(newSrs(NOW), 1, NOW);
    expect(s.due - NOW).toBeLessThanOrEqual(10 * MIN);
    expect(shouldRequeue(s, NOW)).toBe(true);
  });

  it('les échéances augmentent avec la note', () => {
    const p = preview(newSrs(NOW), NOW);
    expect(p[1]).toBeLessThanOrEqual(p[2]);
    expect(p[2]).toBeLessThanOrEqual(p[3]);
    expect(p[3]).toBeLessThan(p[4]);
    expect(p[4] - NOW).toBeGreaterThanOrEqual(DAY);
  });

  it('des réussites espacées allongent l’intervalle ; un oubli le raccourcit', () => {
    let s = rate(newSrs(NOW), 4, NOW);
    let t = s.due;
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = rate(s, 3, t);
      intervals.push(s.due - t);
      t = s.due;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
    const lapsed = rate(s, 1, t);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.due - t).toBeLessThan(DAY);
    expect(lapsed.stability).toBeLessThan(s.stability);
  });

  it('la probabilité de rappel baisse avec le temps', () => {
    const s = rate(rate(newSrs(NOW), 3, NOW), 3, NOW + 10 * MIN);
    expect(retrievability(s, s.due)).toBeGreaterThan(retrievability(s, s.due + 30 * DAY));
  });

  it('formate les intervalles en français', () => {
    expect(formatInterval(30 * 1000)).toBe('1 min');
    expect(formatInterval(10 * MIN)).toBe('10 min');
    expect(formatInterval(5 * 3600000)).toBe('5 h');
    expect(formatInterval(3 * DAY)).toBe('3 j');
    expect(formatInterval(70 * DAY)).toBe('2 mois');
    expect(formatInterval(550 * DAY)).toBe('1,5 an');
    expect(formatInterval(800 * DAY)).toBe('2,2 ans');
  });
});

function card(id: string, bookId: string, chapter: number, srs: QueueCard['srs'], createdAt = 0): QueueCard {
  return { id, bookId, chapter, createdAt, srs };
}
const seeded = () => {
  let x = 42;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
};
const reviewed = (due: number) => ({ ...rate(rate(newSrs(NOW - 30 * DAY), 3, NOW - 30 * DAY), 3, NOW - 29 * DAY), due });

describe('planSession', () => {
  it('ne garde que les fiches dues et ignore les simples surlignages', () => {
    const plan = planSession(
      [card('due', 'a', 0, reviewed(NOW - DAY)), card('later', 'a', 0, reviewed(NOW + 3 * DAY)), card('hl', 'a', 0, null)],
      [],
      { now: NOW, newPerDay: 20, random: seeded() },
    );
    expect(plan.queue).toEqual(['due']);
    expect(plan.nextDue).toBe(NOW + 3 * DAY);
  });

  it('plafonne les nouvelles fiches, en tenant compte de celles déjà vues aujourd’hui', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`n${i}`, 'a', i, newSrs(NOW), i));
    const today = [{ cardId: 'old', at: NOW - MIN, stateBefore: 0 as const }, { cardId: 'old', at: NOW - 2 * MIN, stateBefore: 0 as const }, { cardId: 'x', at: NOW - 2 * DAY, stateBefore: 0 as const }];
    expect(newIntroducedToday(today, NOW)).toBe(1);
    const plan = planSession(cards, today, { now: NOW, newPerDay: 4, random: seeded() });
    expect(plan.newCount).toBe(3);
    expect(plan.queue.sort()).toEqual(['n0', 'n1', 'n2']);
    expect(plan.nextDue).toBe(startOfDay(NOW) + DAY);
  });

  it('entrelace livres et chapitres', () => {
    const cards = [
      ...['a1', 'a2', 'a3'].map((id, i) => card(id, 'A', 0, reviewed(NOW - DAY - i))),
      ...['b1', 'b2', 'b3'].map((id, i) => card(id, 'B', 2, reviewed(NOW - DAY - i))),
    ];
    const queue = planSession(cards, [], { now: NOW, newPerDay: 0, random: seeded() }).queue;
    for (let i = 1; i < queue.length; i++) expect(queue[i]![0]).not.toBe(queue[i - 1]![0]);
  });

  it('répartit les nouvelles fiches parmi les révisions', () => {
    const due = Array.from({ length: 6 }, (_, i) => card(`d${i}`, `B${i}`, 0, reviewed(NOW - DAY)));
    const fresh = [card('n0', 'N', 0, newSrs(NOW), 0), card('n1', 'N', 1, newSrs(NOW), 1)];
    const queue = planSession([...due, ...fresh], [], { now: NOW, newPerDay: 5, random: seeded() }).queue;
    expect(queue).toHaveLength(8);
    expect(queue.indexOf('n0')).toBeGreaterThan(0);
    expect(queue.indexOf('n1')).toBeLessThan(queue.length);
    expect(Math.abs(queue.indexOf('n0') - queue.indexOf('n1'))).toBeGreaterThan(1);
  });

  it('interleave conserve toutes les fiches', () => {
    const cards = Array.from({ length: 20 }, (_, i) => card(`c${i}`, `b${i % 3}`, i % 2, null));
    expect(interleave(cards, seeded(), () => 0).map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
  });
});
