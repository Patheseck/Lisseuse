import { afterEach, describe, expect, it } from 'vitest';
import { chapterText, LAYOUT_VERSION } from '../../src/book/layout';
import { markdownToHtml } from '../../src/book/markdown';
import { importBook, openBook } from '../../src/book/service';
import { exportBackup, readBackup, restoreBackup } from '../../src/storage/backup';
import { listCards, newCard, putCard, type CardRecord } from '../../src/storage/cards';
import { closeDb, DB_NAME, tx } from '../../src/storage/db';
import { addRecall, listRecalls, markPretest, pretestDates } from '../../src/storage/learning';
import { deleteBook, getBook, getChapterCache, getProgress, saveBook, saveProgress } from '../../src/storage/library';
import { layoutHintKey, loadBookmarks, loadFocus, loadGuides, saveBookmarks, saveFocus, saveGuide } from '../../src/storage/method';
import { anchorFromOffsets, locate } from '../../src/reader/anchor';
import { getSetting } from '../../src/storage/settings';

// Un Markdown d'un seul chapitre (titres « ## » seulement) : la 6.2 le gardait d'un bloc,
// le découpage actuel en fait une section par « ## ».
const SECTIONS = ['Mémoire', 'Oubli', 'Sommeil'];
const MD = `# Notes\n\n${SECTIONS.map((s) => `## ${s}\n\nLe paragraphe sur ${s.toLowerCase()} dit quelque chose d’important.`).join('\n\n')}\n`;

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

/** Livre tel qu'enregistré par la 6.2 : chapitres de l'analyseur, sans version de découpage. */
async function oldBook(id = 'livre-ancien'): Promise<{ id: string; text: string }> {
  const html = markdownToHtml(MD);
  await saveBook(id, { format: 'md', title: 'Notes', author: null, chapters: [{ label: 'Notes', html }], resources: {}, cover: null }, new File([MD], 'notes.md'), 'notes.md', 0);
  await tx(['books'], 'readwrite', async (t) => {
    const store = t.objectStore('books');
    const req = store.get(id);
    await new Promise((r) => (req.onsuccess = r));
    const { layout: _l, language: _g, ...old } = req.result;
    store.put(old);
  });
  return { id, text: chapterText(html) };
}

function cardOn(bookId: string, text: string, quote: string, chapter = 0): CardRecord {
  const start = text.indexOf(quote);
  return { ...newCard(bookId, chapter, anchorFromOffsets(text, start, start + quote.length)), kind: 'qa', question: `Que dit-on de ${quote} ?`, answer: 'Une réponse.' };
}

describe('migration du découpage à l’ouverture', () => {
  it('convertit fiches, progression, signets, questions, objectifs, rappels et pré-tests', async () => {
    const { id, text } = await oldBook();
    const sommeil = cardOn(id, text, 'sommeil dit quelque chose');
    const memoire = cardOn(id, text, 'mémoire dit');
    await putCard(sommeil);
    await putCard(memoire);
    const posSommeil = text.indexOf('Sommeil') / text.length;
    await saveProgress(id, 0, posSommeil);
    await saveBookmarks(id, [{ id: 'b1', chapter: 0, offset: posSommeil, label: 'Sommeil', at: 1 }]);
    await saveGuide(id, 0, { question: 'Pourquoi dort-on ?', questionAt: 1 });
    await saveFocus(id, [0]);
    await addRecall(id, { chapter: 0, at: 1, text: 'x', found: 1, total: 2 });
    await markPretest(id, 0, 5);

    const opened = await openBook(id);
    expect(opened.chapters.map((c) => c.label)).toEqual(SECTIONS);
    expect(opened.book.layout).toBe(LAYOUT_VERSION);
    expect((await getBook(id))?.chapterCount).toBe(3);
    expect((await getChapterCache(id))?.layout).toBe(LAYOUT_VERSION);

    const texts = opened.chapters.map((c) => chapterText(c.html));
    const cards = await listCards(id);
    const moved = cards.find((c) => c.id === sommeil.id)!;
    expect(moved.chapter).toBe(2);
    expect(texts[2]!.slice(moved.anchor.start, moved.anchor.end)).toBe('sommeil dit quelque chose');
    expect(locate(texts[0]!, cards.find((c) => c.id === memoire.id)!.anchor)).not.toBeNull();

    expect((await getProgress(id))?.chapter).toBe(2);
    expect((await loadBookmarks(id))[0]?.chapter).toBe(2);
    expect(Object.keys(await loadGuides(id))).toEqual(['0']);
    expect(await loadFocus(id, 3)).toEqual([0, 1, 2]);
    expect((await listRecalls(id))[0]?.chapter).toBe(0);
    expect(await pretestDates(id)).toEqual({ 0: 5 });

    // Une seconde ouverture ne refait rien.
    const again = await openBook(id);
    expect(again.chapters.map((c) => c.label)).toEqual(SECTIONS);
    expect((await listCards(id)).find((c) => c.id === sommeil.id)?.chapter).toBe(2);
  });

  it('un livre sans chapitre à découper change seulement de version', async () => {
    const { book } = await importBook(new File(['# Un\n\nA.\n\n# Deux\n\nB.'], 'court.md'));
    expect(book.layout).toBe(LAYOUT_VERSION);
    const opened = await openBook(book.id);
    expect(opened.chapters.map((c) => c.label)).toEqual(['Un', 'Deux']);
  });

  it('détecte et enregistre la langue d’un livre importé avant la 6.3', async () => {
    const { id } = await oldBook();
    const opened = await openBook(id);
    // Texte trop court pour trancher : langue inconnue, mais la question n'est plus reposée.
    expect(opened.book.language).toBeNull();
    expect((await getBook(id))?.language).toBeNull();

    const english = 'The reader is not able to remember the text, and that is why we test ourselves with the questions of this chapter which we have written for the book.';
    const html = markdownToHtml(`# Memory\n\n${english}`);
    await saveBook('en', { format: 'md', title: 'Memory', author: null, chapters: [{ label: 'Memory', html }], resources: {}, cover: null }, new File([english], 'memory.md'), 'memory.md', 1);
    await tx(['books'], 'readwrite', async (t) => {
      const req = t.objectStore('books').get('en');
      await new Promise((r) => (req.onsuccess = r));
      const { language: _g, ...old } = req.result;
      t.objectStore('books').put(old);
    });
    expect((await openBook('en')).book.language).toBe('en');
  });
});

describe('import et restauration selon le découpage', () => {
  it('un nouveau livre est découpé dès l’import', async () => {
    const { book } = await importBook(new File([MD], 'notes.md'));
    expect(book.layout).toBe(LAYOUT_VERSION);
    expect(book.chapterLabels).toEqual(SECTIONS);
  });

  it('un livre dont des fiches attendent déjà (restaurées sans lui) garde leur découpage, puis migre avec elles', async () => {
    const file = new File([MD], 'notes.md');
    const { book } = await importBook(file);
    await deleteBook(book.id);
    const text = chapterText(markdownToHtml(MD));
    await putCard(cardOn(book.id, text, 'sommeil dit quelque chose'));

    const again = await importBook(file);
    expect(again.book.layout).toBe(0);
    const opened = await openBook(book.id);
    const card = (await listCards(book.id))[0]!;
    expect(card.chapter).toBe(2);
    expect(chapterText(opened.chapters[2]!.html).slice(card.anchor.start, card.anchor.end)).toBe('sommeil dit quelque chose');
  });

  it('restaure une sauvegarde de la 6.2 sur un livre déjà découpé', async () => {
    // Sauvegarde faite avec la 6.2 : livre non découpé, fiche dans le chapitre unique.
    const { id, text } = await oldBook();
    await putCard(cardOn(id, text, 'oubli dit quelque chose'));
    const backup = await readBackup(await (await exportBackup({ includeBooks: true })).blob.text(), async () => null);
    await tx(['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'], 'readwrite', (t) => {
      for (const s of ['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'] as const) t.objectStore(s).clear();
    });
    // Nouvel appareil : le même fichier importé avec la 6.3 (découpé).
    await importBook(new File([MD], 'notes.md'));
    const { book } = await importBook(new File([MD], 'notes.md'));
    const restoredId = book.id;
    // L'identifiant d'un import direct est le SHA-256 du fichier : on aligne la sauvegarde dessus.
    const data = backup.kind === 'v6' ? backup.data : null;
    expect(data).not.toBeNull();
    data!.books = data!.books.map((b) => ({ ...b, id: restoredId }));
    data!.cards = data!.cards.map((c) => ({ ...c, bookId: restoredId }));

    await restoreBackup(backup);
    const card = (await listCards(restoredId))[0]!;
    expect(card.chapter).toBe(1);
    const opened = await openBook(restoredId);
    expect(chapterText(opened.chapters[1]!.html).slice(card.anchor.start, card.anchor.end)).toBe('oubli dit quelque chose');
  });

  it('livre absent lors de la restauration : la version de ses fiches est mémorisée pour l’import', async () => {
    const { id, text } = await oldBook();
    await putCard(cardOn(id, text, 'oubli dit quelque chose'));
    const backup = await readBackup(await (await exportBackup({ includeBooks: false })).blob.text(), async () => null);
    await tx(['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'], 'readwrite', (t) => {
      for (const s of ['books', 'chapters', 'cards', 'reviews', 'progress', 'settings'] as const) t.objectStore(s).clear();
    });
    await restoreBackup(backup);
    expect(await getSetting(layoutHintKey(id))).toBe(0);
  });
});
