import { describe, expect, it } from 'vitest';
import { EpubError, parseEpub, resolvePath } from '../../src/book/epub';
import { detectFormat, parseBookFile } from '../../src/book/import';
import { makeEpub2, makeEpub3 } from '../fixtures/make-epub';

describe('resolvePath', () => {
  it('résout les chemins relatifs', () => {
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a.png')).toBe('OEBPS/images/a.png');
    expect(resolvePath('ch1.xhtml', './b.xhtml')).toBe('b.xhtml');
    expect(resolvePath('a/b.xhtml', 'https://x.org/y')).toBe('https://x.org/y');
  });
});

describe('parseEpub — EPUB 3', async () => {
  const book = await parseEpub(await makeEpub3(), 'test.epub');

  it('lit les métadonnées', () => {
    expect(book.title).toBe('Le Livre de Test');
    expect(book.author).toBe('Ada Lovelace');
    expect(book.cover?.type).toBe('image/png');
  });

  it('suit l’ordre de lecture et les libellés du sommaire', () => {
    expect(book.chapters.map((c) => c.label)).toEqual(['Premier chapitre', 'Deuxième chapitre', 'Annexe sans entrée de sommaire']);
  });

  it('extrait les images comme ressources (chemins encodés compris)', () => {
    expect(Object.keys(book.resources)).toEqual(['OEBPS/images/pic 1.png']);
    expect(book.chapters[0]!.html).toContain('data-res="OEBPS/images/pic 1.png"');
    expect(book.chapters[0]!.html).not.toMatch(/<img[^>]+src=/);
  });

  it('convertit les liens internes et garde les ancres', () => {
    const html = book.chapters[0]!.html;
    expect(html).toContain('data-chapter="1"');
    expect(html).toContain('data-anchor="suite"');
    expect(book.chapters[1]!.html).toContain('data-anchor-id="suite"');
    expect(html).toContain('href="https://example.org"');
  });

  it('neutralise scripts, gestionnaires et styles', () => {
    const html = book.chapters[0]!.html;
    expect(html).not.toMatch(/<script|onclick|style=/);
    expect(html).toContain('Paragraphe piégé');
  });
});

describe('parseEpub — EPUB 2', () => {
  it('lit le sommaire NCX, la couverture meta et le XHTML mal formé', async () => {
    const book = await parseEpub(await makeEpub2(), 'ancien.epub');
    expect(book.title).toBe('Ancien Format');
    expect(book.author).toBeNull();
    expect(book.cover).not.toBeNull();
    expect(book.chapters.map((c) => c.label)).toEqual(['Chapitre A', 'Chapitre B']);
    expect(book.chapters[0]!.html).toContain('Texte A');
  });
});

describe('erreurs', () => {
  it('refuse un fichier qui n’est pas une archive', async () => {
    await expect(parseEpub(new TextEncoder().encode('pas un zip'), 'x.epub')).rejects.toBeInstanceOf(EpubError);
  });

  it('détecte le format par le contenu', () => {
    expect(detectFormat('livre.bin', Uint8Array.of(0x50, 0x4b, 3, 4))).toBe('epub');
    expect(detectFormat('notes.md', Uint8Array.of(0x23, 0x20))).toBe('md');
    expect(detectFormat('image.png', Uint8Array.of(0x89, 0x50))).toBeNull();
  });

  it('donne le même identifiant au même fichier', async () => {
    const bytes = await makeEpub2();
    const a = await parseBookFile(new Blob([bytes as BlobPart]), 'a.epub');
    const b = await parseBookFile(new Blob([bytes as BlobPart]), 'b.epub');
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).toBe(b.id);
  });
});
