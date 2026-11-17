import { describe, expect, it } from 'vitest';
import { chapterText, computeLayout, firstPartOf, mapFraction, mapOffset, MAX_WORDS, partsOf } from '../../src/book/layout';
import { markdownToHtml } from '../../src/book/markdown';
import type { Chapter } from '../../src/book/types';

const words = (n: number, word = 'mot') => Array.from({ length: n }, () => word).join(' ');
const paragraphs = (count: number, size: number) => Array.from({ length: count }, (_, i) => `<p>Paragraphe ${i} ${words(size)}</p>`).join('\n');
const md = { format: 'md' as const, fileName: 'notes.md' };
const epub = { format: 'epub' as const, fileName: 'livre.epub' };

function expectSameText(base: Chapter[], layout: ReturnType<typeof computeLayout>) {
  base.forEach((chapter, b) => {
    const joined = partsOf(layout, b).map((q) => chapterText(layout.chapters[q]!.html)).join('');
    expect(joined).toBe(chapterText(chapter.html));
  });
}

describe('computeLayout', () => {
  it('laisse intacts des chapitres de taille normale', () => {
    const base = [{ label: 'Un', html: paragraphs(3, 50) }, { label: 'Deux', html: paragraphs(3, 50) }];
    const layout = computeLayout(base, epub);
    expect(layout.chapters).toBe(base);
    expect(layout.parts).toEqual([{ base: 0, start: 0, length: -1 }, { base: 1, start: 0, length: -1 }]);
  });

  it('Markdown d’un seul chapitre : une section par « ## », introduction courte rattachée', () => {
    const html = markdownToHtml(`# Mes notes\n\n## Mémoire\n\nLa mémoire.\n\n## Oubli\n\nL'oubli.\n\n## Sommeil\n\nLe sommeil.`);
    const base = [{ label: 'Mes notes', html }];
    const layout = computeLayout(base, md);
    expect(layout.chapters.map((c) => c.label)).toEqual(['Mémoire', 'Oubli', 'Sommeil']);
    expect(chapterText(layout.chapters[0]!.html)).toContain('Mes notes');
    expectSameText(base, layout);
    expect(layout.parts.map((p) => p.start)).toEqual([0, chapterText(layout.chapters[0]!.html).length, expect.any(Number)]);
  });

  it('garde une vraie introduction comme section à part', () => {
    const html = markdownToHtml(`# Guide\n\n${words(80, 'intro')}\n\n## A\n\nTexte A.\n\n## B\n\nTexte B.`);
    const layout = computeLayout([{ label: 'Guide', html }], md);
    expect(layout.chapters.map((c) => c.label)).toEqual(['Guide', 'A', 'B']);
  });

  it('ne découpe pas les « ## » d’un Markdown qui a déjà plusieurs chapitres', () => {
    const base = [{ label: 'Un', html: markdownToHtml('# Un\n\n## a\n\nx\n\n## b\n\ny') }, { label: 'Deux', html: '<p>z</p>' }];
    expect(computeLayout(base, md).chapters).toBe(base);
  });

  it('texte brut : les lignes « Chapitre … » deviennent des chapitres', () => {
    const html = markdownToHtml(`Mon roman\n\nCHAPITRE PREMIER\n\nIl était une fois.\n\nCHAPITRE II\n\nLa suite.\n\nÉpilogue\n\nFin.`);
    const base = [{ label: 'Document', html }];
    const layout = computeLayout(base, { format: 'md', fileName: 'roman.txt' });
    expect(layout.chapters.map((c) => c.label)).toEqual(['CHAPITRE PREMIER', 'CHAPITRE II', 'Épilogue']);
    expectSameText(base, layout);
  });

  it('découpe un chapitre géant en morceaux, de préférence avant un titre', () => {
    const html = `<h1>Long</h1>${paragraphs(30, 200)}<h2>Milieu</h2>${paragraphs(30, 200)}`;
    const base = [{ label: 'Long', html }];
    const layout = computeLayout(base, epub);
    expect(layout.chapters.length).toBeGreaterThan(1);
    expect(layout.chapters[0]!.label).toBe('Long');
    for (const c of layout.chapters) expect(chapterText(c.html).split(/\s+/).length).toBeLessThan(MAX_WORDS);
    expect(layout.chapters.slice(1).every((c) => c.depth === 1)).toBe(true);
    expect(layout.chapters.some((c) => c.label === 'Milieu')).toBe(true);
    expectSameText(base, layout);
  });

  it('sans intertitre interne, vise des morceaux d’environ 5 000 mots (le titre de tête ne compte pas)', () => {
    const html = `<h2>Chapitre II</h2>${paragraphs(75, 200)}`;
    const layout = computeLayout([{ label: 'Chapitre II', html }], epub);
    expect(layout.chapters.map((c) => c.label)).toEqual(['Chapitre II', 'Chapitre II (2/3)', 'Chapitre II (3/3)']);
    for (const c of layout.chapters) expect(chapterText(c.html).split(/\s+/).length).toBeLessThan(6_500);
  });

  it('descend dans les enveloppes (<div> contenant tout le chapitre) sans perdre de texte', () => {
    const html = `\n<div><section>\n<h1>Titre</h1>\n${paragraphs(70, 200)}\n</section>\n</div>\n`;
    const base = [{ label: 'Enveloppé', html }];
    const layout = computeLayout(base, epub);
    expect(layout.chapters.length).toBeGreaterThan(1);
    for (const c of layout.chapters) expect(c.html.trim().startsWith('<div><section>') || c.html.includes('<div><section>')).toBe(true);
    expectSameText(base, layout);
  });

  it('réoriente les liens internes vers le morceau qui contient leur cible', () => {
    const big = `<h1>Gros</h1>${paragraphs(40, 200)}<p data-anchor-id="loin">Cible lointaine</p>${paragraphs(40, 200)}<p><a data-anchor="loin">ici</a></p>`;
    const base = [{ label: 'Intro', html: '<p><a data-chapter="1" data-anchor="loin">voir</a> et <a data-chapter="2">fin</a></p>' }, { label: 'Gros', html: big }, { label: 'Fin', html: '<p>Fin</p>' }];
    const layout = computeLayout(base, epub);
    const target = layout.chapters.findIndex((c) => c.html.includes('data-anchor-id="loin"'));
    const last = layout.chapters.length - 1;
    expect(target).toBeGreaterThan(1);
    expect(layout.chapters[0]!.html).toContain(`data-chapter="${target}" data-anchor="loin"`);
    expect(layout.chapters[0]!.html).toContain(`data-chapter="${last}"`);
    // Lien interne au chapitre d'origine, désormais vers un autre morceau.
    expect(layout.chapters.find((c) => c.html.includes('>ici<'))!.html).toContain(`data-chapter="${target}"`);
    expectSameText(base, layout);
  });
});

describe('conversion des positions', () => {
  const base = [{ label: 'Court', html: '<p>abc</p>' }, { label: 'Long', html: `<h1>L</h1>${paragraphs(60, 200)}` }, { label: 'Fin', html: '<p>z</p>' }];
  const layout = computeLayout(base, epub);
  const longParts = partsOf(layout, 1);

  it('associe chaque chapitre d’origine à ses morceaux', () => {
    expect(partsOf(layout, 0)).toEqual([0]);
    expect(longParts.length).toBeGreaterThan(1);
    expect(firstPartOf(layout, 1)).toBe(1);
    expect(partsOf(layout, 2)).toEqual([layout.chapters.length - 1]);
  });

  it('convertit une position en caractères', () => {
    expect(mapOffset(layout, 0, 2)).toEqual({ chapter: 0, offset: 2 });
    const second = layout.parts[longParts[1]!]!;
    expect(mapOffset(layout, 1, second.start + 5)).toEqual({ chapter: longParts[1], offset: 5 });
    expect(mapOffset(layout, 2, 0)).toEqual({ chapter: layout.chapters.length - 1, offset: 0 });
  });

  it('convertit une position relative (progression, signets)', () => {
    expect(mapFraction(layout, 0, 0.5)).toEqual({ chapter: 0, fraction: 0.5 });
    expect(mapFraction(layout, 1, 0)).toEqual({ chapter: longParts[0], fraction: 0 });
    expect(mapFraction(layout, 1, 1)).toEqual({ chapter: longParts.at(-1), fraction: 1 });
    const mid = mapFraction(layout, 1, 0.5);
    expect(longParts).toContain(mid.chapter);
    expect(mid.fraction).toBeGreaterThan(0);
    expect(mid.fraction).toBeLessThan(1);
  });
});
