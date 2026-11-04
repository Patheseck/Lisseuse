import { describe, expect, it } from 'vitest';
import { surveyChapter, surveyIsEmpty } from '../../src/core/survey';
import { percentRead } from '../../src/storage/library';
import { bilanKey, bookSettingKeys, loadBilan, loadBookmarks, loadFocus, loadGuides, normalizeFocus, normalizeShelf, saveBilan, saveBookmarks, saveFocus, saveGuide } from '../../src/storage/method';
import { putSetting } from '../../src/storage/settings';
import { normalizeReaderSettings } from '../../src/storage/settings';

describe('surveyChapter', () => {
  it('relève intertitres, gras, italique, listes et figures, sans doublon', () => {
    const s = surveyChapter(`<h1>Titre</h1><h2>Partie A</h2><p>Un <strong>terme clé</strong>, encore <b>terme clé</b>, et <em>une nuance</em>.</p>
      <p><strong>${'mot '.repeat(20)}</strong></p><ul><li>premier</li><li>second</li></ul><figure><img alt="Schéma du cycle"><figcaption>Le cycle</figcaption></figure><table></table>`);
    expect(s.headings).toEqual(['Partie A']);
    expect(s.bold).toEqual(['terme clé']);
    expect(s.italic).toEqual(['une nuance']);
    expect(s.lists).toEqual(['premier', 'second']);
    expect(s.figures).toEqual(['Le cycle', 'Schéma du cycle']);
    expect(s.figureCount).toBe(2);
    expect(surveyIsEmpty(s)).toBe(false);
  });

  it('signale un chapitre sans repère', () => {
    expect(surveyIsEmpty(surveyChapter('<h1>Seul</h1><p>Du texte simple.</p>'))).toBe(true);
  });
});

describe('percentRead avec chapitres choisis', () => {
  const book = { chapterCount: 10 };
  it('ne compte que les chapitres choisis', () => {
    expect(percentRead(book, { chapter: 5, offset: 0.5 })).toBe(55);
    expect(percentRead(book, { chapter: 5, offset: 0.5 }, [2, 5, 8, 9])).toBe(38); // 1 + 0,5 sur 4
    expect(percentRead(book, { chapter: 9, offset: 1 }, [2, 5])).toBe(100);
    expect(percentRead(book, { chapter: 0, offset: 0.9 }, [3])).toBe(0);
  });
});

describe('normalisation', () => {
  it('filtre les chapitres invalides et trie', () => {
    expect(normalizeFocus([3, 1, 1, 'x', -1, 2.5, 9], 5)).toEqual([1, 3]);
    expect(normalizeFocus('x', 5)).toEqual([]);
  });
  it('préférences d’étagère par défaut', () => {
    expect(normalizeShelf(null)).toEqual({ view: 'grid', sort: 'recent' });
    expect(normalizeShelf({ view: 'list', sort: 'title' })).toEqual({ view: 'list', sort: 'title' });
    expect(normalizeShelf({ view: 'mur', sort: 'taille' })).toEqual({ view: 'grid', sort: 'recent' });
  });
  it('vitesse de défilement bornée et méthode guidée par défaut', () => {
    expect(normalizeReaderSettings({ autoSpeed: 99 }).autoSpeed).toBe(10);
    expect(normalizeReaderSettings({}).guided).toBe(true);
    expect(normalizeReaderSettings({ guided: false }).guided).toBe(false);
  });
});

describe('stockage de la méthode', () => {
  it('enregistre questions directrices, chapitres choisis et signets par livre', async () => {
    await saveGuide('b1', 0, { question: 'Pourquoi ?', questionAt: 1 });
    await saveGuide('b1', 2, { question: 'Comment ?', questionAt: 2, main: 'Ainsi.', gaps: [{ label: 'x', level: 'hard' }] });
    expect(Object.keys(await loadGuides('b1'))).toEqual(['0', '2']);
    expect((await loadGuides('b1'))[2]?.gaps?.[0]?.level).toBe('hard');
    expect(await loadGuides('autre')).toEqual({});

    await saveFocus('b1', [4, 1, 4]);
    expect(await loadFocus('b1', 3)).toEqual([1]);

    await saveBookmarks('b1', [{ id: 'b', chapter: 2, offset: 0.1, label: '', at: 1 }, { id: 'a', chapter: 0, offset: 0.5, label: '', at: 2 }]);
    expect((await loadBookmarks('b1')).map((b) => b.id)).toEqual(['a', 'b']);
  });
});

describe('bilan du livre', () => {
  it('s’enregistre par livre et part avec le livre', async () => {
    expect(await loadBilan('b-bilan')).toBeNull();
    const bilan = { about: 'Le sommeil consolide', ideas: ['A', 'B'], links: [{ from: 'A', relation: 'cause' as const, to: 'B', cardId: 'c1' }], reached: 'partly' as const, next: 'Dormir plus', at: 5, aboutCardId: 'c2' };
    await saveBilan('b-bilan', bilan);
    expect(await loadBilan('b-bilan')).toEqual(bilan);
    expect(await loadBilan('autre')).toBeNull();
    expect(bookSettingKeys('b-bilan')).toContain(bilanKey('b-bilan'));
  });

  it('relit un bilan abîmé sans planter', async () => {
    await putSetting(bilanKey('b-abime'), { about: 3, ideas: 'A', links: [{ from: 'A' }, { from: 'A', relation: 'oppose', to: 'B' }], reached: 'peut-être', at: 'hier' });
    const bilan = await loadBilan('b-abime');
    expect(bilan).toMatchObject({ about: '', ideas: [], links: [{ from: 'A', relation: 'oppose', to: 'B' }], reached: null, next: '' });
    expect(typeof bilan?.at).toBe('number');
  });

  it('les idées et liens des chapitres sont vérifiés à la lecture', async () => {
    await saveGuide('b-guide-abime', 0, { question: 'Q', questionAt: 1, ideas: ['A', 4 as unknown as string], links: [{ from: 'A', relation: 'x' as never, to: 'B' }] });
    const guides = await loadGuides('b-guide-abime');
    expect(guides[0]?.ideas).toEqual(['A']);
    expect(guides[0]?.links).toEqual([]);
  });
});
