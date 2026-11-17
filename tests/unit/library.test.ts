// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME, promisify, tx } from '../../src/storage/db';
import { deleteBook, getBook, getChapterCache, getProgress, listBooks, listProgress, percentRead, readsPages, saveBook, saveJump, savePageProgress, saveProgress } from '../../src/storage/library';
import { loadPageMarks, loadPdfPrefs, normalizePageMarks, normalizePdfPrefs, savePageMarks, savePdfPrefs } from '../../src/storage/method';
import type { ParsedBook } from '../../src/book/types';

function parsed(title: string, chapters = 3): ParsedBook {
  return {
    format: 'md',
    title,
    author: null,
    chapters: Array.from({ length: chapters }, (_, i) => ({ label: `C${i}`, html: `<p>${i}</p>` })),
    resources: { 'img.png': new Blob(['x'], { type: 'image/png' }) },
    cover: null,
  };
}

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('bibliothèque', () => {
  it('enregistre un livre avec son nombre de chapitres et son cache', async () => {
    const { book, existed } = await saveBook('id1', parsed('Un'), new Blob(['# Un']), 'un.md');
    expect(existed).toBe(false);
    expect(book.chapterCount).toBe(3);
    expect((await getBook('id1'))?.title).toBe('Un');
    const cache = await getChapterCache('id1');
    expect(cache?.chapters).toHaveLength(3);
    expect(cache?.resources['img.png']).toBeInstanceOf(Blob);
  });

  it('conserve la date d’ajout lors d’une réimportation', async () => {
    const first = await saveBook('id1', parsed('Un'), new Blob(['a']), 'un.md');
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveBook('id1', parsed('Un'), new Blob(['a']), 'un.md');
    expect(second.existed).toBe(true);
    expect(second.book.addedAt).toBe(first.book.addedAt);
  });

  it('trie par dernière ouverture', async () => {
    await saveBook('a', parsed('A'), new Blob(['a']), 'a.md');
    await new Promise((r) => setTimeout(r, 5));
    await saveBook('b', parsed('B'), new Blob(['b']), 'b.md');
    expect((await listBooks()).map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('supprime un livre et toutes ses données liées, sans toucher aux autres', async () => {
    await saveBook('a', parsed('A'), new Blob(['a']), 'a.md');
    await saveBook('b', parsed('B'), new Blob(['b']), 'b.md');
    await saveProgress('a', 1, 0.5);
    await saveProgress('b', 2, 0);
    await tx(['cards', 'reviews', 'settings'], 'readwrite', (t) => {
      t.objectStore('cards').put({ id: 'ca', bookId: 'a' });
      t.objectStore('cards').put({ id: 'cb', bookId: 'b' });
      t.objectStore('reviews').put({ cardId: 'ca', bookId: 'a' });
      t.objectStore('reviews').put({ cardId: 'cb', bookId: 'b' });
      for (const key of ['guide:a', 'focus:a', 'bookmarks:a', 'recall:a', 'guide:b']) t.objectStore('settings').put({ key, value: 1 });
    });

    await deleteBook('a');
    const keys = await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').getAllKeys()));
    expect(keys).toEqual(['guide:b']);

    expect(await getBook('a')).toBeUndefined();
    expect(await getChapterCache('a')).toBeUndefined();
    expect(await getProgress('a')).toBeUndefined();
    const [cards, reviews] = await tx(['cards', 'reviews'], 'readonly', async (t) => [
      await promisify(t.objectStore('cards').getAll()),
      await promisify(t.objectStore('reviews').getAll()),
    ]);
    expect(cards.map((c: { id: string }) => c.id)).toEqual(['cb']);
    expect(reviews).toHaveLength(1);
    expect(await getBook('b')).toBeDefined();
    expect((await listProgress()).has('b')).toBe(true);
  });
});

describe('progression', () => {
  it('borne la position et calcule le pourcentage réel', async () => {
    await saveProgress('x', 1, 1.7);
    const p = await getProgress('x');
    expect(p?.offset).toBe(1);
    expect(percentRead({ chapterCount: 4 }, { chapter: 1, offset: 0.5 })).toBe(38);
    expect(percentRead({ chapterCount: 4 }, { chapter: 3, offset: 1 })).toBe(100);
    expect(percentRead({ chapterCount: 4 }, undefined)).toBe(0);
    expect(percentRead({ chapterCount: 0 }, { chapter: 0, offset: 0 })).toBe(0);
  });

  it('PDF : position en pages et position dans le texte adapté, gardées chacune de leur côté', async () => {
    await saveProgress('pdf', 2, 0.5);
    await savePageProgress('pdf', 9, 0.25);
    expect(await getProgress('pdf')).toMatchObject({ chapter: 2, offset: 0.5, page: 9, pageOffset: 0.25 });
    await saveProgress('pdf', 3, 0.1);
    expect(await getProgress('pdf')).toMatchObject({ chapter: 3, offset: 0.1, page: 9, pageOffset: 0.25 });
    // Changement de mode : l'endroit où reprendre, effacé par la position suivante.
    await saveJump('pdf', 0.6);
    expect((await getProgress('pdf'))?.jump).toBe(0.6);
    await savePageProgress('pdf', 12, 0);
    expect((await getProgress('pdf'))?.jump).toBeUndefined();

    const pages = { chapterCount: 3, format: 'pdf' as const, pageCount: 40 };
    expect(readsPages(pages)).toBe(true);
    expect(readsPages({ ...pages, pdfView: 'text' as const })).toBe(false);
    expect(percentRead(pages, { chapter: 2, offset: 0.5, page: 9, pageOffset: 0 })).toBe(23);
    expect(percentRead(pages, { chapter: 2, offset: 0.5 })).toBe(0);
    expect(percentRead({ ...pages, pdfView: 'text' }, { chapter: 2, offset: 0.5, page: 9 })).toBe(83);
  });
});

describe('PDF en pages originales', () => {
  it('signets de page et préférences d’affichage', async () => {
    expect(normalizePageMarks([3, 1, 3, -1, 2.5, 'x', 40], 10)).toEqual([1, 3]);
    await savePageMarks('livre', [5, 2, 5]);
    expect(await loadPageMarks('livre')).toEqual([2, 5]);
    expect(await loadPageMarks('livre', 4)).toEqual([2]);
    expect(normalizePdfPrefs(null)).toEqual({ scroll: 'vertical', colors: 'theme' });
    expect(normalizePdfPrefs({ scroll: 'pages', colors: 'original', zoom: 3 })).toEqual({ scroll: 'pages', colors: 'original' });
    await savePdfPrefs({ scroll: 'pages', colors: 'theme' });
    expect(await loadPdfPrefs()).toEqual({ scroll: 'pages', colors: 'theme' });
  });

  it('un PDF importé pour ses pages garde le texte adapté déjà converti et son mode de lecture', async () => {
    const converted: ParsedBook = { format: 'pdf', title: 'P', author: null, chapters: [{ label: 'A', html: '<p>a</p>' }], resources: {}, cover: null, pageCount: 12 };
    await saveBook('p1', converted, new Blob(['%PDF-']), 'p.pdf', 1);
    const db = await getBook('p1');
    await tx(['books'], 'readwrite', (t) => {
      t.objectStore('books').put({ ...db!, pdfView: 'text' });
    });
    // Réimporté (sans conversion) : chapitres, cache et mode de lecture restent.
    await saveBook('p1', { ...converted, chapters: [] }, new Blob(['%PDF-']), 'p.pdf', 1);
    expect(await getBook('p1')).toMatchObject({ chapterCount: 1, chapterLabels: ['A'], pageCount: 12, pdfView: 'text' });
    expect((await getChapterCache('p1'))?.chapters).toHaveLength(1);
  });
});
