import { describe, expect, it } from 'vitest';
import { activity, calibration, forecast, retention } from '../../src/core/stats';
import { newSrs } from '../../src/core/scheduler';

const NOW = new Date('2026-04-10T15:00:00').getTime();
const DAY = 86400000;
const learned = (due: number) => ({ kind: 'qa', srs: { ...newSrs(NOW), state: 2 as const, due } });

describe('forecast', () => {
  it('répartit les échéances par jour, retards comptés aujourd’hui, nouvelles ignorées', () => {
    const cards = [learned(NOW - 3 * DAY), learned(NOW + 1000), learned(NOW + DAY), learned(NOW + 6 * DAY), learned(NOW + 9 * DAY), { kind: 'qa', srs: newSrs(NOW) }, { kind: 'highlight', srs: null }];
    expect(forecast(cards, NOW)).toEqual([2, 1, 0, 0, 0, 0, 1]);
  });
});

describe('retention', () => {
  it('ne compte que les révisions espacées de la période', () => {
    const reviews = [
      { at: NOW - DAY, grade: 3, confidence: 3, stateBefore: 2 },
      { at: NOW - DAY, grade: 1, confidence: 2, stateBefore: 2 },
      { at: NOW - DAY, grade: 4, confidence: 3, stateBefore: 2 },
      { at: NOW - DAY, grade: 1, confidence: 1, stateBefore: 0 }, // apprentissage : exclu
      { at: NOW - 40 * DAY, grade: 1, confidence: 1, stateBefore: 2 }, // hors période
    ];
    expect(retention(reviews, NOW)).toEqual({ rate: 2 / 3, count: 3 });
    expect(retention([], NOW)).toEqual({ rate: null, count: 0 });
  });
});

describe('calibration', () => {
  it('réussite par niveau de confiance, révisions V5 sans confiance ignorées', () => {
    const rows = calibration([
      { at: 0, grade: 3, confidence: 3, stateBefore: 2 },
      { at: 0, grade: 1, confidence: 3, stateBefore: 2 },
      { at: 0, grade: 1, confidence: 1, stateBefore: 2 },
      { at: 0, grade: 4, confidence: null, stateBefore: 2 },
    ]);
    expect(rows).toEqual([
      { confidence: 1, count: 1, rate: 0 },
      { confidence: 2, count: 0, rate: null },
      { confidence: 3, count: 2, rate: 0.5 },
    ]);
  });
});

describe('activity', () => {
  it('marque les jours actifs sur 30 jours', () => {
    const a = activity([{ at: NOW, grade: 3, confidence: 2, stateBefore: 2 }, { at: NOW - 2 * DAY, grade: 3, confidence: 2, stateBefore: 2 }, { at: NOW - 2 * DAY + 1000, grade: 3, confidence: 2, stateBefore: 2 }, { at: NOW - 45 * DAY, grade: 3, confidence: 2, stateBefore: 2 }], NOW);
    expect(a.count).toBe(2);
    expect(a.active[29]).toBe(true);
    expect(a.active[27]).toBe(true);
    expect(a.active[28]).toBe(false);
  });
});
