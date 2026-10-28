import { afterEach, describe, expect, it } from 'vitest';
import { AMBIANCE_GROUPS, AMBIANCES, crossfadeFor, DUCK_FACTOR, effectiveVolume, findAmbiance, MUSIC_APPS, shuffled } from '../../src/core/ambiances';
import { addTracks, countTracks, deleteTrack, getBookAmbiance, isAudioFile, listTracks, loadAmbiancePrefs, saveAmbiancePrefs, setBookAmbiance } from '../../src/storage/audio';
import { closeDb, DB_NAME, openDb, promisify, tx } from '../../src/storage/db';
import { deleteBook, saveBook } from '../../src/storage/library';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('catalogue des ambiances', () => {
  it('identifiants uniques, groupes connus, recherches prêtes', () => {
    expect(new Set(AMBIANCES.map((a) => a.id)).size).toBe(AMBIANCES.length);
    for (const a of AMBIANCES) expect(AMBIANCE_GROUPS).toContain(a.group);
    expect(findAmbiance('kora')?.region).toContain('Afrique de l’Ouest');
    expect(findAmbiance('inconnue')).toBeNull();
    expect(MUSIC_APPS.map((app) => app.url('kora instrumental'))).toEqual([
      'https://open.spotify.com/search/kora%20instrumental',
      'https://music.youtube.com/search?q=kora%20instrumental',
      'https://www.deezer.com/search/kora%20instrumental',
    ]);
  });

  it('calcule volume, atténuation, ordre mélangé et fondu', () => {
    expect(effectiveVolume(0.4, 1, 1)).toBeCloseTo(0.4);
    expect(effectiveVolume(0.4, 0.5, DUCK_FACTOR)).toBeCloseTo(0.05);
    expect(effectiveVolume(2, 1, 1)).toBe(1);
    const items = [1, 2, 3, 4, 5];
    expect([...shuffled(items, () => 0.3)].sort()).toEqual(items);
    expect(crossfadeFor(240)).toBe(4);
    expect(crossfadeFor(3)).toBe(1);
    expect(crossfadeFor(Number.NaN)).toBe(4);
  });

  it('reconnaît les fichiers audio', () => {
    expect(isAudioFile({ name: 'kora.mp3', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'piste', type: 'audio/ogg' })).toBe(true);
    expect(isAudioFile({ name: 'livre.epub', type: 'application/epub+zip' })).toBe(false);
  });
});

describe('morceaux et choix par livre', () => {
  it('ajoute, compte, liste et retire des morceaux', async () => {
    const [a, b] = await addTracks([
      { ambiance: 'kora', name: 'kora-1.mp3', blob: new Blob(['a'], { type: 'audio/mpeg' }), duration: 300 },
      { ambiance: 'kora', name: 'kora-2.mp3', blob: new Blob(['b'], { type: 'audio/mpeg' }), duration: null },
    ]);
    await addTracks([{ ambiance: 'oud', name: 'oud.mp3', blob: new Blob(['c']), duration: 60 }]);
    expect(Object.fromEntries(await countTracks())).toEqual({ kora: 2, oud: 1 });
    expect((await listTracks('kora')).map((t) => t.name)).toEqual(['kora-1.mp3', 'kora-2.mp3']);
    expect((await listTracks('kora'))[0]!.blob).toBeInstanceOf(Blob);
    await deleteTrack(a!.id);
    expect((await listTracks('kora')).map((t) => t.id)).toEqual([b!.id]);
  });

  it('mémorise le volume et l’ambiance de chaque livre, effacée avec le livre', async () => {
    expect((await loadAmbiancePrefs()).volume).toBe(0.35);
    await saveAmbiancePrefs({ volume: 0.6 });
    expect((await loadAmbiancePrefs()).volume).toBe(0.6);
    await saveBook('livre', { format: 'md', title: 'L', author: null, chapters: [{ label: 'A', html: '<p>a</p>' }], resources: {}, cover: null }, new Blob(['# A']), 'l.md');
    expect(await getBookAmbiance('livre')).toBeNull();
    await setBookAmbiance('livre', 'santour');
    expect(await getBookAmbiance('livre')).toBe('santour');
    await deleteBook('livre');
    expect(await getBookAmbiance('livre')).toBeNull();
  });
});

describe('mise à jour de la base (v1 → v2)', () => {
  it('ajoute le magasin des morceaux sans toucher aux données existantes', async () => {
    // Base telle que créée par la 6.3 (version 1, sans magasin « audio »).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('chapters', { keyPath: 'bookId' });
        db.createObjectStore('progress', { keyPath: 'bookId' });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('bookId', 'bookId');
        const reviews = db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
        reviews.createIndex('cardId', 'cardId');
        reviews.createIndex('bookId', 'bookId');
        db.createObjectStore('settings-test', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction(['settings'], 'readwrite');
        t.objectStore('settings').put({ key: 'reader', value: { fontSize: 22 } });
        t.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    expect(db.version).toBe(2);
    expect(db.objectStoreNames.contains('audio')).toBe(true);
    const reader = await tx(['settings'], 'readonly', (t) => promisify(t.objectStore('settings').get('reader')));
    expect(reader).toEqual({ key: 'reader', value: { fontSize: 22 } });
    await addTracks([{ ambiance: 'kora', name: 'k.mp3', blob: new Blob(['k']), duration: null }]);
    expect((await listTracks('kora')).length).toBe(1);
  });
});
