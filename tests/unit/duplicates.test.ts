import { afterEach, describe, expect, it } from 'vitest';
import { duplicateGroups, fileStemKey, findSameBook, looksLikeBook, planDuplicates, titleKey, type CopyData } from '../../src/book/duplicates';
import { importBook } from '../../src/book/service';
import { newCard, putCard } from '../../src/storage/cards';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { listBooks } from '../../src/storage/library';
import { anchorFromOffsets } from '../../src/reader/anchor';
import { makePdf } from '../fixtures/make-pdf';
import './pdf-worker';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const book = (title: string, author: string | null, format: 'epub' | 'pdf' | 'md' = 'epub', fileName = `${title}.${format}`) => ({ title, author, format, fileName });

describe('reconnaître le même livre dans un autre fichier', () => {
  it('titre ramené à l’essentiel', () => {
    expect(titleKey('Les 48 Lois du Pouvoir (French Edition) [z-lib.org]')).toBe('les 48 lois du pouvoir');
    expect(titleKey('L’Aventure ambiguë')).toBe('l aventure ambigue');
    expect(fileStemKey('Les_48_lois_du_pouvoir (1).epub')).toBe('les 48 lois du pouvoir');
  });

  it('même titre, auteur compatible ; autre format ou édition', () => {
    const library = [book('Les 48 lois du pouvoir', 'Robert Greene')];
    expect(findSameBook(book('LES 48 LOIS DU POUVOIR (French Edition)', 'Greene, Robert', 'pdf'), library)).toBe(library[0]);
    expect(findSameBook(book('Les 48 lois du pouvoir', null, 'pdf'), library)).toBe(library[0]);
    // Titre tiré du nom de fichier : « Titre - Auteur ».
    expect(findSameBook(book('Les 48 lois du pouvoir - Robert Greene', null, 'pdf'), library)).toBe(library[0]);
  });

  it('pas de fausse alerte : autre auteur, autre titre, titre vague, notes Markdown', () => {
    const library = [book('Introduction à la psychologie', 'Jean Dupont'), book('Sans titre', null, 'pdf'), book('Notes de lecture', null, 'md')];
    expect(findSameBook(book('Introduction à la psychologie', 'Marie Curie'), library)).toBeNull();
    expect(findSameBook(book('Introduction à la sociologie', 'Jean Dupont'), library)).toBeNull();
    expect(findSameBook(book('Sans titre', null, 'pdf'), library)).toBeNull();
    expect(findSameBook(book('Notes de lecture', null, 'md'), library)).toBeNull();
  });

  it('doublons déjà présents, et fichiers du téléphone qui ont l’air d’un livre présent', () => {
    const library = [book('Père riche, père pauvre', 'Robert Kiyosaki'), book('Pere riche pere pauvre', null, 'pdf'), book('L’Alchimiste', 'Paulo Coelho')];
    expect(duplicateGroups(library).map((g) => g.length)).toEqual([2]);
    expect(looksLikeBook('Père riche père pauvre (1).pdf', library)).toBe(true);
    expect(looksLikeBook('L_Alchimiste - Paulo Coelho.epub', library)).toBe(true);
    expect(looksLikeBook('Le Prophète.epub', library)).toBe(false);
    expect(looksLikeBook('Père riche père pauvre.md', library)).toBe(false);
  });
});

describe('retirer les doublons déjà présents', () => {
  const copy = (id: string, lastOpenedAt: number) => ({ id, lastOpenedAt });
  it('garde l’exemplaire aux fiches, puis aux notes, puis le plus lu, puis le plus récent ; retire seulement ceux sans fiche ni note', () => {
    const data: Record<string, CopyData> = {
      epub: { cards: 3, notes: false, read: 10 },
      pdf: { cards: 0, notes: false, read: 90 },
      copie: { cards: 0, notes: false, read: 0 },
    };
    const [plan] = planDuplicates([[copy('pdf', 3), copy('copie', 9), copy('epub', 1)]], (b) => data[b.id]!);
    expect(plan!.keep.id).toBe('epub');
    expect(plan!.remove.map((b) => b.id).sort()).toEqual(['copie', 'pdf']);
    expect(plan!.conflicts).toEqual([]);
  });

  it('sans fiches : notes, puis lecture, puis dernier ouvert', () => {
    const plan = (data: Record<string, CopyData>, a = 1, b = 2) => planDuplicates([[copy('a', a), copy('b', b)]], (x) => data[x.id]!)[0]!;
    expect(plan({ a: { cards: 0, notes: true, read: 0 }, b: { cards: 0, notes: false, read: 80 } }).keep.id).toBe('a');
    expect(plan({ a: { cards: 0, notes: false, read: 40 }, b: { cards: 0, notes: false, read: 5 } }).keep.id).toBe('a');
    expect(plan({ a: { cards: 0, notes: false, read: 0 }, b: { cards: 0, notes: false, read: 0 } }).keep.id).toBe('b');
  });

  it('plusieurs exemplaires avec des fiches : aucun n’est retiré, l’utilisateur choisit', () => {
    const data: Record<string, CopyData> = { a: { cards: 5, notes: false, read: 0 }, b: { cards: 2, notes: false, read: 0 } };
    const [plan] = planDuplicates([[copy('a', 1), copy('b', 2)]], (x) => data[x.id]!);
    expect(plan!.keep.id).toBe('a');
    expect(plan!.remove).toEqual([]);
    expect(plan!.conflicts.map((b) => b.id)).toEqual(['b']);
  });
});

describe('import : jamais de doublon', () => {
  const pdf = (text: string, title = 'Le Livre de Test', author = 'Ada Lovelace') => makePdf({ title, author, pages: [{ runs: [{ text, x: 72, y: 700, size: 12 }] }] });
  const pdf_ = (text: string, title?: string, author?: string) => pdf(text, title, author) as BlobPart;

  it('autre fichier du même livre : pas ajouté, le livre présent est rendu', async () => {
    const first = await importBook(new File([pdf_('Première édition.')], 'livre.pdf', { type: 'application/pdf' }));
    expect(first.existed).toBe(false);
    const second = await importBook(new File([pdf_('Deuxième édition, corrigée.', 'LE LIVRE DE TEST (French Edition)', 'Lovelace, Ada')], 'livre-v2.pdf', { type: 'application/pdf' }));
    expect(second).toMatchObject({ existed: true, otherCopy: true });
    expect(second.book.id).toBe(first.book.id);
    expect(await listBooks()).toHaveLength(1);
    // Fichier identique : le même livre, sans « autre copie ».
    const same = await importBook(new File([pdf_('Première édition.')], 'copie.pdf', { type: 'application/pdf' }));
    expect(same).toMatchObject({ existed: true });
    expect(same.otherCopy).toBeUndefined();
  });

  it('livre attendu par des fiches restaurées : importé même si un même titre est là', async () => {
    await importBook(new File([pdf_('Première édition.')], 'livre.pdf', { type: 'application/pdf' }));
    const bytes = pdf('Édition de mes fiches.');
    const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('');
    await putCard(newCard(id, 0, anchorFromOffsets('Édition de mes fiches.', 0, 7)));
    const result = await importBook(new File([bytes as BlobPart], 'mes-fiches.pdf', { type: 'application/pdf' }));
    expect(result.existed).toBe(false);
    expect(result.book.id).toBe(id);
    expect(await listBooks()).toHaveLength(2);
  });

  it('notes Markdown au même titre : deux documents différents, tous deux importés', async () => {
    await importBook(new File(['# Notes de lecture\n\nPremier carnet.\n'], 'notes.md', { type: 'text/markdown' }));
    const second = await importBook(new File(['# Notes de lecture\n\nDeuxième carnet.\n'], 'notes.md', { type: 'text/markdown' }));
    expect(second.existed).toBe(false);
    expect(await listBooks()).toHaveLength(2);
  });
});
