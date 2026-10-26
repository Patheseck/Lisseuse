import { describe, expect, it } from 'vitest';
import { fold, htmlToText, searchChapters } from '../../src/reader/search';

describe('fold', () => {
  it('ignore casse et accents en gardant la longueur', () => {
    expect(fold('Éléphant ÇA Œuvre')).toBe('elephant ca œuvre');
    for (const s of ['Éléphant', 'naïve', '😀 ok', 'İstanbul', 'ﬁn']) expect(fold(s)).toHaveLength(s.length);
  });
});

describe('htmlToText', () => {
  it('donne le même texte que le rendu du lecteur', () => {
    const html = '<h1>Titre</h1>\n<p>Un <em>mot</em> &amp; demi</p>';
    const el = document.createElement('article');
    el.innerHTML = html;
    expect(htmlToText(html)).toBe(el.textContent);
  });
});

describe('searchChapters', () => {
  const texts = ['La photosynthèse produit du glucose.', 'Rien ici.', 'PHOTOSYNTHESE encore, et photosynthèse.'];

  it('trouve toutes les occurrences, sans tenir compte des accents', () => {
    const hits = searchChapters(texts, 'photosynthese');
    expect(hits.map((h) => h.chapter)).toEqual([0, 2, 2]);
    expect(hits[1]!.match).toBe('PHOTOSYNTHESE');
    expect(texts[2]!.slice(hits[2]!.start, hits[2]!.end)).toBe('photosynthèse');
  });

  it('fournit un extrait autour du résultat', () => {
    const [hit] = searchChapters(texts, 'glucose');
    expect(hit!.before).toBe('La photosynthèse produit du ');
    expect(hit!.after).toBe('.');
  });

  it('ignore les requêtes trop courtes et respecte la limite', () => {
    expect(searchChapters(texts, 'a')).toEqual([]);
    expect(searchChapters(['aa '.repeat(500)], 'aa', 10)).toHaveLength(10);
  });

  it('trouve une expression coupée par un retour à la ligne', () => {
    expect(searchChapters(['le\nprocessus'], 'le processus')).toHaveLength(1);
  });
});
