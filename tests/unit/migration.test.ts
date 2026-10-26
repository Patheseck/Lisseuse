import { afterEach, describe, expect, it } from 'vitest';
import { listAllCards, listReviews } from '../../src/storage/cards';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { getProgress, listBooks } from '../../src/storage/library';
import { importV5Snapshot, migrateDeviceIfNeeded, readDeviceSnapshot, V5_DB_NAME } from '../../src/storage/migrate-v5';
import { getSetting, loadReaderSettings } from '../../src/storage/settings';
import { sha256Hex } from '../../src/book/import';
import type { V5Snapshot } from '../../src/storage/v5';

const NOW = Date.now();
const MD = '# Un\n\nLa photosynthèse produit du glucose.\n\n# Deux\n\nLe cycle de Calvin fixe le carbone.\n';

async function wipe(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = () => resolve();
  });
}

afterEach(async () => {
  await closeDb();
  await wipe(DB_NAME);
  await wipe(V5_DB_NAME);
  localStorage.clear();
});

async function snapshot(): Promise<{ snap: V5Snapshot; v6Id: string }> {
  const file = new File([MD], 'cours.md', { type: 'text/markdown' });
  const v6Id = await sha256Hex(await file.arrayBuffer());
  const legacyId = 'cours.md:' + file.size; // ancien identifiant V5 (nom + taille)
  return {
    v6Id,
    snap: {
      books: [
        { id: legacyId, title: 'Cours', format: 'md', fileBlob: file, addedAt: NOW - 10_000, lastOpenedAt: NOW - 5_000 },
        { id: 'sans-fichier', title: 'Livre perdu' },
      ],
      cards: {
        [legacyId]: [
          // Chapitre faux dans la V5 : la citation est dans le chapitre 1.
          { id: 'c1', chapter: 0, text: 'Le cycle de Calvin fixe le carbone.', mode: 'concept', reformulation: 'Calvin fixe le CO2', mojorNumber: 2, review: { fsrs: { difficulty: 5, stability: 4, reps: 2, lapses: 0, lastReviewed: NOW - 86400000 }, due: NOW - 1000, interval: 4 } },
          { id: 'c2', chapter: 0, text: 'produit du glucose', mojorNumber: null, review: null },
        ],
        'sans-fichier': [{ id: 'c3', chapter: 0, text: 'Texte', mojorNumber: 1, reformulation: 'R' }],
      },
      progress: { [legacyId]: { chapter: 1, scrollTop: 120 } },
      prefs: { fontSize: 22, theme: 'dark' },
      reviewLog: [
        { cardId: 'c1', bookId: legacyId, timestamp: NOW - 86400000, rating: 3, stabilityBefore: 1, stabilityAfter: 4, intervalDays: 4 },
        { cardId: 'inconnue', bookId: legacyId, timestamp: NOW, rating: 1 },
      ],
      mojor: { '2': { number: 2, word: 'Cygne' } },
    },
  };
}

describe('importV5Snapshot', () => {
  it('reprend livres, fiches, révisions, progression et réglages', async () => {
    const { snap, v6Id } = await snapshot();
    const report = await importV5Snapshot(snap);
    expect(report).toMatchObject({ books: 1, cards: 3, reviews: 1, missingBooks: ['Livre perdu'], failures: [] });

    const [book] = await listBooks();
    expect(book).toMatchObject({ id: v6Id, title: 'Cours', chapterCount: 2, addedAt: NOW - 10_000 });

    const cards = await listAllCards();
    const c1 = cards.find((c) => c.id.endsWith(':c1'))!;
    expect(c1).toMatchObject({ bookId: v6Id, chapter: 1, kind: 'qa', answer: 'Calvin fixe le CO2' });
    expect(c1.srs).toMatchObject({ state: 2, stability: 4, reps: 2 });
    expect(c1.anchor.end).toBeGreaterThan(c1.anchor.start);
    expect(cards.find((c) => c.id.endsWith(':c2'))!.kind).toBe('highlight');
    expect(cards.find((c) => c.id.endsWith(':c3'))!.bookId).toBe('sans-fichier');

    const reviews = await listReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ cardId: c1.id, bookId: v6Id, confidence: null });

    expect(await getProgress(v6Id)).toMatchObject({ chapter: 1, offset: 0 });
    expect(await loadReaderSettings()).toMatchObject({ fontSize: 22, theme: 'dark' });
    expect(await getSetting('mojor')).toEqual({ '2': { number: 2, word: 'Cygne' } });
  });

  it('peut être relancée sans créer de doublons', async () => {
    const { snap } = await snapshot();
    await importV5Snapshot(snap);
    const second = await importV5Snapshot(snap);
    expect(second).toMatchObject({ books: 0, cards: 0, reviews: 0 });
    expect(await listBooks()).toHaveLength(1);
    expect(await listAllCards()).toHaveLength(3);
    expect(await listReviews()).toHaveLength(1);
  });
});

describe('migration de l’appareil', () => {
  async function seedDevice(): Promise<void> {
    const { snap } = await snapshot();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(V5_DB_NAME, 2);
      req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
      req.onsuccess = () => {
        const t = req.result.transaction('books', 'readwrite');
        snap.books.forEach((b) => t.objectStore('books').put(b));
        t.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
    for (const [id, cards] of Object.entries(snap.cards)) localStorage.setItem(`liseuse:cards:${id}`, JSON.stringify(cards));
    localStorage.setItem('liseuse:progress', JSON.stringify(snap.progress));
    localStorage.setItem('liseuse:prefs', JSON.stringify(snap.prefs));
    localStorage.setItem('liseuse:review-log', JSON.stringify(snap.reviewLog));
  }

  it('ne fait rien (et ne crée pas la base V5) sans données V5', async () => {
    expect(await readDeviceSnapshot()).toBeNull();
    expect(await migrateDeviceIfNeeded()).toBeNull();
    const dbs = await indexedDB.databases();
    expect(dbs.map((d) => d.name)).not.toContain(V5_DB_NAME);
  });

  it('migre une seule fois et laisse les données V5 intactes', async () => {
    await seedDevice();
    const report = await migrateDeviceIfNeeded();
    expect(report).toMatchObject({ books: 1, cards: 3 });
    expect(await migrateDeviceIfNeeded()).toBeNull();
    expect(localStorage.getItem('liseuse:review-log')).not.toBeNull();
    expect((await readDeviceSnapshot())!.books).toHaveLength(2);
  });
});
