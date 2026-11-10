import { afterEach, describe, expect, it } from 'vitest';
import { collectBackup, decrypt, encrypt, exportBackup, readBackup, restoreBackup } from '../../src/storage/backup';
import { importBook, openBook } from '../../src/book/service';
import { listAllCards, listReviews, putCard, recordReview, newCard } from '../../src/storage/cards';
import { closeDb, DB_NAME, tx } from '../../src/storage/db';
import { getBook, getChapterCache, listBooks, saveProgress } from '../../src/storage/library';
import { putSetting, getSetting } from '../../src/storage/settings';
import { anchorFromOffsets } from '../../src/reader/anchor';
import { newSrs, rate } from '../../src/core/scheduler';
import { makePdf, typesetBook, filler } from '../fixtures/make-pdf';
import './pdf-worker';

const MD = '# Un\n\nPremier chapitre avec du texte.\n';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

async function wipeAll(): Promise<void> {
  await tx(['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'], 'readwrite', (t) => {
    for (const s of ['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'] as const) t.objectStore(s).clear();
  });
}

async function seed(): Promise<string> {
  const { book } = await importBook(new File([MD], 'cours.md', { type: 'text/markdown' }));
  const card = { ...newCard(book.id, 0, anchorFromOffsets('Premier chapitre avec du texte.', 0, 7)), kind: 'qa' as const, question: 'Q ?', answer: 'R.', srs: newSrs() };
  await putCard(card);
  const after = rate(card.srs, 3);
  await recordReview({ ...card, srs: after }, { cardId: card.id, bookId: book.id, at: 1000, grade: 3, confidence: 3, durationMs: 5, answer: 'x', stateBefore: 0, stabilityBefore: 0, stabilityAfter: after.stability, dueAfter: after.due });
  await saveProgress(book.id, 0, 0.5);
  await putSetting('reader', { fontSize: 24 });
  await putSetting('migration-v5', { at: 1 });
  return book.id;
}

describe('chiffrement', () => {
  it('aller-retour, et mauvais mot de passe refusé', async () => {
    const payload = await encrypt('secret', 'motdepasse', 1000);
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(await decrypt(payload, 'motdepasse')).toBe('secret');
    await expect(decrypt(payload, 'faux')).rejects.toThrow('Mot de passe incorrect');
  });
});

describe('sauvegarde', () => {
  it('n’exporte pas les réglages propres à l’appareil, et les livres seulement sur demande', async () => {
    await seed();
    const light = await collectBackup(false);
    expect(light.books[0]!.file).toBeUndefined();
    expect(light.settings.map((s) => s.key)).toEqual(['reader']);
    expect((await collectBackup(true)).books[0]!.file?.data).toBeTruthy();
  });

  it('restauration complète sur un appareil vide', async () => {
    const bookId = await seed();
    const { blob } = await exportBackup({ includeBooks: true });
    await wipeAll();

    const parsed = await readBackup(await blob.text(), async () => null);
    const report = await restoreBackup(parsed);
    expect(report).toMatchObject({ books: 1, cards: 1, reviews: 1, missingBooks: [] });
    expect((await getBook(bookId))?.chapterCount).toBe(1);
    expect(await (await getBook(bookId))!.file.text()).toBe(MD);
    expect(await getSetting('reader')).toEqual({ fontSize: 24 });
  });

  it('un PDF protégé par mot de passe se restaure, et sera relu (mot de passe demandé) à l’ouverture', async () => {
    const pdf = makePdf(typesetBook({ title: 'Secret', author: 'A', outline: true, userPassword: 'lune', chapters: [{ title: 'Un', paragraphs: [filler(200, 1)] }, { title: 'Deux', paragraphs: [filler(200, 2)] }] }));
    const { book } = await importBook(new File([pdf as BlobPart], 'secret.pdf', { type: 'application/pdf' }), { askPassword: async () => 'lune' });
    const { blob } = await exportBackup({ includeBooks: true });
    await wipeAll();
    const report = await restoreBackup(await readBackup(await blob.text(), async () => null));
    expect(report.failures).toEqual([]);
    expect(report.books).toBe(1);
    // Importé pour être lu en pages : pas encore de texte adapté, mais son nombre de pages.
    const restored = (await getBook(book.id))!;
    expect(restored).toMatchObject({ format: 'pdf', chapterLabels: [], pageCount: book.pageCount });
    expect(book.pageCount).toBeGreaterThanOrEqual(3);
    expect(await getChapterCache(book.id)).toBeUndefined();
    // Texte adapté à la demande : mot de passe demandé, chapitres connus ensuite.
    const asked: boolean[] = [];
    const opened = await openBook(book.id, { askPassword: async (retry) => (asked.push(retry), 'lune') });
    expect(asked).toEqual([false]);
    expect(opened.chapters.map((c) => c.label)).toEqual(['Début du livre', 'Un', 'Deux']);
    expect(await getChapterCache(book.id)).toBeDefined();
    expect((await getBook(book.id))!.chapterLabels).toEqual(['Début du livre', 'Un', 'Deux']);
  });

  it('PDF converti par une version plus ancienne : texte adapté refait s’il est vierge, gardé dès qu’une fiche y est posée', async () => {
    const pdf = makePdf(typesetBook({ title: 'Vieux', author: 'A', outline: true, chapters: [{ title: 'Un', paragraphs: [filler(200, 1)] }, { title: 'Deux', paragraphs: [filler(200, 2)] }] }));
    const { book } = await importBook(new File([pdf as BlobPart], 'vieux.pdf', { type: 'application/pdf' }));
    await openBook(book.id);
    expect((await getChapterCache(book.id))!.pdfText).toBe(2);
    // Cache d'une conversion d'avant (sans version), avec ses défauts.
    const old = async () => {
      const cache = (await getChapterCache(book.id))!;
      await tx(['chapters'], 'readwrite', (t) => t.objectStore('chapters').put({ ...cache, pdfText: undefined, chapters: [{ label: 'Rss', html: '<p>Ancien texte</p>' }] }));
    };
    await old();
    const fresh = await openBook(book.id);
    expect(fresh.chapters.map((c) => c.label)).toEqual(['Début du livre', 'Un', 'Deux']);
    expect((await getChapterCache(book.id))!.pdfText).toBe(2);
    // Une fiche posée sur l'ancien texte : il reste tel quel (la fiche ne perd pas sa place).
    await old();
    await putCard(newCard(book.id, 0, anchorFromOffsets('Ancien texte', 0, 6)));
    expect((await openBook(book.id)).chapters.map((c) => c.label)).toEqual(['Rss']);
  });

  it('sans les livres : signale ceux à réimporter, garde les fiches', async () => {
    await seed();
    const { blob } = await exportBackup({ includeBooks: false });
    await wipeAll();
    const report = await restoreBackup(await readBackup(await blob.text(), async () => null));
    expect(report.missingBooks).toEqual(['cours']);
    expect(await listBooks()).toHaveLength(0);
    expect(await listAllCards()).toHaveLength(1);
  });

  it('restaurée sans les livres puis sauvegardée de nouveau : les livres à réimporter restent décrits', async () => {
    const id = await seed();
    const original = (await getBook(id))!;
    const { blob } = await exportBackup({ includeBooks: false });
    await wipeAll();
    await restoreBackup(await readBackup(await blob.text(), async () => null));
    // Nouvelle sauvegarde avant d'avoir réimporté le livre (sauvegarde automatique, par exemple).
    const second = await collectBackup(false);
    expect(second.books).toHaveLength(1);
    expect(second.books[0]).toMatchObject({ id, title: original.title, layout: original.layout, chapterCount: original.chapterCount });
    expect(second.books[0]!.file).toBeUndefined();
    expect(second.settings.map((s) => s.key)).not.toContain('absent-books');
    // Elle se restaure à son tour avec la liste des livres à réimporter.
    await wipeAll();
    const report = await restoreBackup(await readBackup(JSON.stringify(second), async () => null));
    expect(report.missingBooks).toEqual(['cours']);
    expect(await listAllCards()).toHaveLength(1);
    // Réimporté : décrit une seule fois, par le livre lui-même.
    await importBook(new File([MD], 'cours.md', { type: 'text/markdown' }));
    expect((await collectBackup(false)).books.map((b) => b.id)).toEqual([id]);
  });

  it('un livre absent dont plus rien ne dépend n’est plus repris', async () => {
    const id = await seed();
    const { blob } = await exportBackup({ includeBooks: false });
    await wipeAll();
    await restoreBackup(await readBackup(await blob.text(), async () => null));
    await tx(['cards', 'progress'], 'readwrite', (t) => {
      t.objectStore('cards').clear();
      t.objectStore('progress').clear();
    });
    expect((await collectBackup(false)).books.map((b) => b.id)).not.toContain(id);
  });

  it('fusion : rien n’est dupliqué ni écrasé, la fiche la plus récente gagne', async () => {
    await seed();
    const { blob } = await exportBackup({ includeBooks: true });
    const [card] = await listAllCards();
    await putCard({ ...card!, question: 'Question modifiée après la sauvegarde', updatedAt: Date.now() + 1000 });

    const report = await restoreBackup(await readBackup(await blob.text(), async () => null));
    expect(report).toMatchObject({ books: 0, cards: 0, reviews: 0 });
    expect((await listAllCards())[0]!.question).toBe('Question modifiée après la sauvegarde');
    expect(await listReviews()).toHaveLength(1);
    expect(await listBooks()).toHaveLength(1);
  });

  it('sauvegarde chiffrée : demande le mot de passe', async () => {
    await seed();
    const { blob, fileName } = await exportBackup({ includeBooks: false, password: 'un mot de passe' });
    expect(fileName).toContain('chiffree');
    await expect(readBackup(await blob.text(), async () => null)).rejects.toThrow('annulée');
    await expect(readBackup(await blob.text(), async () => 'faux')).rejects.toThrow('Mot de passe incorrect');
    expect((await readBackup(await blob.text(), async () => 'un mot de passe')).kind).toBe('v6');
  });

  it('refuse un fichier étranger ou d’une version future', async () => {
    await expect(readBackup('pas du json', async () => null)).rejects.toThrow('JSON illisible');
    await expect(readBackup('{"foo":1}', async () => null)).rejects.toThrow('pas une sauvegarde');
    await expect(readBackup('{"app":"liseuse","format":7,"books":[],"cards":[]}', async () => null)).rejects.toThrow('plus récente');
  });

  it('accepte une sauvegarde V5 chiffrée (format de la V5.7)', async () => {
    const v5 = { formatVersion: 4, books: [{ id: 'b', title: 'T' }], cards: { b: [{ id: 'c', chapter: 0, text: 'Texte', mojorNumber: 1, reformulation: 'R' }] }, reviewLog: [], prefs: {}, progress: {}, mojor: null };
    const enc = await encrypt(JSON.stringify(v5), 'pw', 1000);
    const v5Payload = { formatVersion: 4, encrypted: true, kdf: 'PBKDF2-SHA256', iterations: 1000, salt: Array.from(atob(enc.salt as string), (c) => c.charCodeAt(0)), iv: Array.from(atob(enc.iv as string), (c) => c.charCodeAt(0)), data: Array.from(atob(enc.data as string), (c) => c.charCodeAt(0)) };
    const parsed = await readBackup(JSON.stringify(v5Payload), async () => 'pw');
    expect(parsed.kind).toBe('v5');
    const report = await restoreBackup(parsed);
    expect(report).toMatchObject({ cards: 1, missingBooks: ['T'] });
  });
});
