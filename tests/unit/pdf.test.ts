import { describe, expect, it } from 'vitest';
import './pdf-worker';
import { DrmError } from '../../src/book/epub';
import { ImportCancelled, ImportError, ScannedPdfError } from '../../src/book/errors';
import { parseBookFile } from '../../src/book/import';
import { cleanAuthor, cleanTitle, parsePdf, readPdfInfo } from '../../src/book/pdf';
import { filler, makePdf, OCR_JUNK, typesetBook, type BookSpec } from '../fixtures/make-pdf';

const BOOK: BookSpec = {
  title: 'Le Sommeil et la Mémoire',
  author: 'Claire Dupont',
  outline: true,
  furniture: true,
  chapters: [
    { title: 'Chapitre 1 — Dormir', paragraphs: [filler(250, 1)] },
    { title: 'Chapitre 2 — Rêver', paragraphs: [filler(250, 2)] },
  ],
};

const bytes = (spec: Partial<BookSpec> = {}) => makePdf(typesetBook({ ...BOOK, ...spec }));
const parse = (data: Uint8Array, name = 'livre.pdf', options = {}) => parsePdf(data.slice(), new Blob([data as BlobPart]), name, options);

describe('lecture d’un PDF', () => {
  it('titre, auteur, langue et chapitres', async () => {
    const book = await parse(bytes());
    expect(book).toMatchObject({ format: 'pdf', title: 'Le Sommeil et la Mémoire', author: 'Claire Dupont', language: 'fr', resources: {} });
    expect(book.chapters.map((c) => c.label)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);
  });

  it('un titre de métadonnées sans valeur laisse la place au nom du fichier', async () => {
    const data = makePdf({ ...typesetBook(BOOK), title: 'Microsoft Word - brouillon.docx', author: 'Administrateur' });
    const book = await parse(data, 'Mon_cours_de_biologie.pdf');
    expect(book.title).toBe('Mon cours de biologie');
    expect(book.author).toBeNull();
  });

  it('titres et auteurs : toutes les écritures gardées, valeurs sans intérêt écartées', () => {
    expect(cleanTitle('Война и мир', 'x.pdf')).toBe('Война и мир');
    expect(cleanTitle('東京物語', 'x.pdf')).toBe('東京物語');
    expect(cleanTitle('道', 'x.pdf')).toBe('道');
    expect(cleanTitle('كليلة ودمنة', 'x.pdf')).toBe('كليلة ودمنة');
    expect(cleanTitle('Document Design Basics', 'x.pdf')).toBe('Document Design Basics');
    expect(cleanTitle('Title IX and Sports', 'x.pdf')).toBe('Title IX and Sports');
    for (const junk of ['', ' ', '123', '---', 'Untitled', 'Document1', 'Microsoft Word - brouillon', 'cours.docx']) expect(cleanTitle(junk, 'mon_cours.pdf')).toBe('mon cours');
    expect(cleanAuthor('Лев Толстой')).toBe('Лев Толстой');
    expect(cleanAuthor(['Ada Lovelace', 'Charles Babbage'])).toBe('Ada Lovelace, Charles Babbage');
    for (const junk of ['', '1234', 'Administrator', 'user']) expect(cleanAuthor(junk)).toBeNull();
  });

  it('import pour les pages originales : titre, auteur, nombre de pages, sans convertir le texte', async () => {
    const data = bytes();
    const info = await readPdfInfo(data.slice(), new Blob([data as BlobPart]), 'livre.pdf');
    expect(info).toMatchObject({ format: 'pdf', title: 'Le Sommeil et la Mémoire', author: 'Claire Dupont', chapters: [] });
    expect(info.pageCount).toBe((await parse(data)).pageCount);
    // Un PDF scanné s'importe aussi : ses pages sont des images, elles se lisent telles quelles.
    const scanned = makePdf({ pages: [{ runs: [], image: true }, { runs: [], image: true }] });
    expect((await readPdfInfo(scanned.slice(), new Blob([scanned as BlobPart]), 'scan.pdf')).pageCount).toBe(2);
  });

  it('donne le même identifiant au même PDF', async () => {
    const data = bytes();
    const a = await parseBookFile(new Blob([data as BlobPart]), 'a.pdf');
    const b = await parseBookFile(new Blob([data as BlobPart]), 'b.pdf');
    expect(a.id).toBe(b.id);
    expect(a.parsed.format).toBe('pdf');
  });

  it('suit l’avancement page par page', async () => {
    const seen: [number, number][] = [];
    await parse(bytes(), 'livre.pdf', { onProgress: (done: number, total: number) => seen.push([done, total]) });
    expect(seen.at(-1)).toEqual([seen.length, seen.length]);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});

describe('PDF scannés avec reconnaissance de caractères (OCR)', () => {
  const ocrBook: BookSpec = {
    ...BOOK,
    outline: false,
    chapters: [
      { title: 'Chapitre 1 — Dormir', paragraphs: ['Pendant le sommeil profond, le cerveau rejoue longuement les souvenirs de la journée passée et les range avec soin pour le lendemain matin.', `Ensuite ${filler(300, 1)}`] },
      { title: 'Chapitre 2 — Rêver', paragraphs: [`Puis ${filler(300, 2)}`] },
      { title: 'Chapitre 3 — Réviser', paragraphs: [`Enfin ${filler(300, 3)}`] },
    ],
  };
  const scan = () => makePdf(typesetBook({ ...ocrBook, ocr: true }));

  it('reconnu à son texte invisible posé sur l’image des pages, dès l’import', async () => {
    const data = scan();
    expect((await readPdfInfo(data.slice(), new Blob([data as BlobPart]), 'scan.pdf')).ocr).toBe(true);
    expect((await parse(data)).ocr).toBe(true);
    const digital = bytes();
    expect((await readPdfInfo(digital.slice(), new Blob([digital as BlobPart]), 'livre.pdf')).ocr).toBeUndefined();
    expect((await parse(digital)).ocr).toBeUndefined();
  });

  it('texte adapté : bruit des illustrations retiré, vrais chapitres, paragraphes recollés malgré les tailles irrégulières', async () => {
    const book = await parse(scan());
    expect(book.chapters.map((c) => c.label)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver', 'Chapitre 3 — Réviser']);
    const html = book.chapters.map((c) => c.html).join('\n');
    for (const junk of [...OCR_JUNK, '&amp;']) expect(html).not.toContain(junk.replace(/'/g, '&#39;'));
    expect(html).not.toMatch(/<p>&amp;<\/p>|<h\d>&amp;/);
    // Le premier paragraphe court sur trois lignes de tailles reconnues différentes : il reste entier.
    expect(book.chapters[1]!.html).toContain('<p>Pendant le sommeil profond, le cerveau rejoue longuement les souvenirs de la journée passée et les range avec soin pour le lendemain matin.</p>');
  });
});

describe('PDF protégés et refusés', () => {
  it('mot de passe : demandé, redemandé s’il est faux', async () => {
    const data = bytes({ userPassword: 'lune' });
    const asked: boolean[] = [];
    const answers = ['soleil', 'lune'];
    const book = await parse(data, 'secret.pdf', { askPassword: async (retry: boolean) => (asked.push(retry), answers.shift() ?? null) });
    expect(asked).toEqual([false, true]);
    expect(book.title).toBe('Le Sommeil et la Mémoire');
  });

  it('mot de passe : abandon, ou aucune façon de le demander', async () => {
    const data = bytes({ userPassword: 'lune' });
    await expect(parse(data, 'secret.pdf', { askPassword: async () => null })).rejects.toBeInstanceOf(ImportCancelled);
    await expect(parse(data, 'secret.pdf')).rejects.toThrow('protégé par un mot de passe');
  });

  it('DRM : refusé en nommant la protection', async () => {
    const error = await parse(makePdf({ ...typesetBook(BOOK), drm: true })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DrmError);
    expect((error as DrmError).vendor).toBe('Adobe');
  });

  it('scanné : aucun texte à lire', async () => {
    const scanned = makePdf({ pages: [{ runs: [], image: true }, { runs: [], image: true }, { runs: [], image: true }] });
    await expect(parse(scanned)).rejects.toBeInstanceOf(ScannedPdfError);
  });

  it('abîmé : message clair', async () => {
    await expect(parse(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'))).rejects.toBeInstanceOf(ImportError);
  });
});
