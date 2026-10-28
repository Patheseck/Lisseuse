// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME, promisify, tx } from '../../src/storage/db';
import { deleteBook, getBook, getChapterCache, getProgress, listBooks, listProgress, percentRead, saveBook, saveProgress } from '../../src/storage/library';
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
});
