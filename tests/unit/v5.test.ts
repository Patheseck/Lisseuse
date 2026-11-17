import { describe, expect, it } from 'vitest';
import { convertCard, convertPrefs, convertProgress, convertReview, convertSrs, isV5Backup, relocateCard, snapshotFromV5Backup, v5CardId } from '../../src/storage/v5';
import { locate } from '../../src/reader/anchor';

const NOW = new Date('2026-05-01T10:00:00').getTime();
const DAY = 86400000;

describe('convertSrs', () => {
  it('reprend un état FSRS V5', () => {
    const s = convertSrs({ id: 'c', mojorNumber: 3, review: { fsrs: { difficulty: 4.2, stability: 12.5, reps: 5, lapses: 1, lastReviewed: NOW - 5 * DAY }, due: NOW + 7 * DAY, interval: 12 } }, NOW)!;
    expect(s).toMatchObject({ state: 2, stability: 12.5, difficulty: 4.2, reps: 5, lapses: 1, due: NOW + 7 * DAY, lastReview: NOW - 5 * DAY, scheduledDays: 12 });
  });

  it('convertit un ancien état SM-2 comme le faisait la V5', () => {
    const s = convertSrs({ id: 'c', mojorNumber: 1, review: { ef: 2.0, interval: 6, n: 3, due: NOW + DAY } }, NOW)!;
    expect(s.state).toBe(2);
    expect(s.difficulty).toBe(8);
    expect(s.stability).toBe(6);
  });

  it('fiche encodée jamais révisée → nouvelle ; fiche non encodée → pas de révision', () => {
    expect(convertSrs({ id: 'c', mojorNumber: 4, review: null, createdAt: NOW - DAY }, NOW)!.state).toBe(0);
    expect(convertSrs({ id: 'c', mojorNumber: 4, review: { fsrs: null, due: NOW } }, NOW)!.state).toBe(0);
    expect(convertSrs({ id: 'c', mojorNumber: null, review: null }, NOW)).toBeNull();
  });
});

describe('convertCard', () => {
  it('fiche « concept » avec reformulation → question-réponse avec aide-mémoire', () => {
    const c = convertCard('book', { id: 'c1', chapter: 2, text: '  La lumière est captée.  ', mode: 'concept', reformulation: 'Les plantes captent la lumière', mojorNumber: 7, association: { word: 'Lampe', place: 'Cuisine' }, review: null, createdAt: NOW - DAY }, NOW)!;
    expect(c).toMatchObject({ id: v5CardId('book', 'c1'), kind: 'qa', chapter: 2, answer: 'Les plantes captent la lumière', origin: 'v5' });
    expect(c.question).toBe('Quelle est l’idée essentielle de ce passage ?');
    expect(c.anchor.quote).toBe('La lumière est captée.');
    expect(c.mnemonic).toMatchObject({ number: 7, word: 'Lampe', place: 'Cuisine', verb: '' });
    expect(c.srs!.state).toBe(0);
  });

  it('séquence V5 → fiche étapes', () => {
    const c = convertCard('b', { id: 's', text: 'a b c', mode: 'sequence', sequenceItems: ['Un', ' Deux ', ''], mojorNumber: 1 }, NOW)!;
    expect(c.kind).toBe('sequence');
    expect(c.steps).toEqual(['Un', 'Deux']);
  });

  it('passage jamais encodé ni reformulé → simple surlignage', () => {
    const c = convertCard('b', { id: 'h', text: 'Passage', mojorNumber: null, review: null }, NOW)!;
    expect(c.kind).toBe('highlight');
    expect(c.srs).toBeNull();
    expect(c.mnemonic).toBeUndefined();
  });

  it('ignore une fiche vide', () => {
    expect(convertCard('b', { id: 'x', text: '   ' }, NOW)).toBeNull();
  });
});

describe('relocateCard', () => {
  const texts = ['Introduction générale.', 'Le chat\n  dort sur le tapis. Fin.', 'Autre.'];
  it('retrouve la citation malgré des espaces différents', () => {
    const c = convertCard('b', { id: 'c', chapter: 1, text: 'chat dort sur', mojorNumber: 1 }, NOW)!;
    const r = relocateCard(c, texts);
    expect(r.chapter).toBe(1);
    expect(texts[1]!.slice(r.anchor.start, r.anchor.end)).toBe('chat\n  dort sur');
    expect(locate(texts[1]!, r.anchor)).toEqual({ start: r.anchor.start, end: r.anchor.end });
  });

  it('cherche dans les autres chapitres si le découpage a changé', () => {
    const c = convertCard('b', { id: 'c', chapter: 0, text: 'Autre.', mojorNumber: 1 }, NOW)!;
    expect(relocateCard(c, texts).chapter).toBe(2);
  });

  it('garde la fiche (introuvable) sans planter', () => {
    const c = convertCard('b', { id: 'c', chapter: 9, text: 'absent', mojorNumber: 1 }, NOW)!;
    const r = relocateCard(c, texts);
    expect(r.chapter).toBe(2);
    expect(r.anchor.quote).toBe('absent');
  });
});

describe('autres conversions', () => {
  it('journal de révision', () => {
    const r = convertReview({ cardId: 'c', bookId: 'b', timestamp: NOW, rating: 3, stabilityBefore: 2, stabilityAfter: 6, intervalDays: 6, recallSeconds: 4.2 }, 'b', 'v5:b:c')!;
    expect(r).toMatchObject({ cardId: 'v5:b:c', grade: 3, confidence: null, durationMs: 4200, stateBefore: 2, dueAfter: NOW + 6 * DAY });
    expect(convertReview({ cardId: 'c', bookId: 'b', timestamp: NaN, rating: 3 }, 'b', 'x')).toBeNull();
  });

  it('progression (ancien format numérique ou objet)', () => {
    expect(convertProgress(3)).toEqual({ chapter: 3, offset: 0 });
    expect(convertProgress({ chapter: 2, scrollTop: 900 })).toEqual({ chapter: 2, offset: 0 });
    expect(convertProgress(undefined)).toBeNull();
  });

  it('préférences d’affichage', () => {
    expect(convertPrefs({ fontSize: 21, theme: 'dark', readerFont: 'sans', readerLeading: 1.9, readingMode: 'page' })).toMatchObject({ fontSize: 21, font: 'sans', leading: 1.9, width: 'normal', theme: 'dark' });
    expect(convertPrefs({})).toMatchObject({ fontSize: 18, theme: 'auto' });
  });

  it('reconnaît une sauvegarde V5', () => {
    const backup = { formatVersion: 4, appVersion: '4.0.0', books: [{ id: 'b', title: 'T' }, null], cards: { b: [] }, reviewLog: [], prefs: {}, progress: {}, mojor: null };
    expect(isV5Backup(backup)).toBe(true);
    expect(isV5Backup({ app: 'liseuse', format: 6, books: [] })).toBe(false);
    expect(snapshotFromV5Backup(backup).books).toHaveLength(1);
    expect(() => snapshotFromV5Backup({})).toThrow();
  });
});
