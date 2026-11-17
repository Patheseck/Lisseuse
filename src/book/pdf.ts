import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { logError } from '../core/errors';
import { detectLanguage, normalizeLanguage } from '../core/language';
import { DrmError, textSample } from './epub';
import { ImportCancelled, ImportError, ScannedPdfError } from './errors';
import { convertPdfText, unreadableRatio, type PdfOutlineEntry, type PdfPageText } from './pdf-text';
import { sanitizeHtml } from './sanitize';
import type { ParsedBook } from './types';

// Lecture des PDF avec pdf.js (le moteur PDF de Firefox), chargé seulement quand un PDF arrive.
// Aucun contenu actif du PDF n'est exécuté : pdf.js n'exécute ni les scripts des PDF ni code
// évalué à la volée (compatible avec la politique de sécurité de l'app), et les formulaires XFA
// sont désactivés. Tout se passe sur l'appareil.

export interface PdfOptions {
  /** Avancement de la lecture des pages. */
  onProgress?: (done: number, total: number) => void;
  /** Mot de passe d'un PDF protégé (`retry` : le précédent était faux) ; null pour abandonner. */
  askPassword?: (retry: boolean) => Promise<string | null>;
  /**
   * Dessin de secours, si le texte des pages ne s'affiche pas sur l'appareil : chaque lettre est
   * tracée comme une forme (sans police chargée dans la WebView), sans accélération graphique.
   */
  safeRendering?: boolean;
  /** Mot de passe déjà donné pour ce PDF (réouverture), sinon demandé par `askPassword`. */
  password?: string;
}

/** Adresse d'un dossier de ressources de pdf.js livré avec l'app (voir vite.config.ts). */
function resourceUrl(dir: string): string | undefined {
  return typeof document !== 'undefined' ? new URL(`pdfjs/${dir}/`, document.baseURI).href : undefined;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let library: Promise<PdfJs> | null = null;

/**
 * pdf.js lit le texte des pages (recherche, texte adapté) en parcourant un flux avec `for await`,
 * que les WebView antérieures à Chrome 124 ne connaissent pas. Le minimum de pdf.js est Chrome 119
 * (où en reste Android 7) ; sa version « legacy » complète déjà le JavaScript, et la taille des
 * pages (CSS round(), Chrome 125) est traitée à la construction (vite.config.ts).
 */
function polyfillForPdfJs(): void {
  const proto = globalThis.ReadableStream?.prototype;
  if (!proto || Symbol.asyncIterator in proto) return;
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    async *value(this: ReadableStream) {
      const reader = this.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function loadPdfJs(): Promise<PdfJs> {
  polyfillForPdfJs();
  library ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  });
  return library;
}

type PdfViewerLib = typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
let viewerLibrary: Promise<{ pdfjs: PdfJs; viewer: PdfViewerLib }> | null = null;

/**
 * Visionneuse de pdf.js (pages, couche de texte, liens, recherche), chargée seulement pour lire un
 * PDF en pages originales. Elle s'appuie sur la bibliothèque déclarée dans `globalThis.pdfjsLib`.
 */
export function loadPdfViewer(): Promise<{ pdfjs: PdfJs; viewer: PdfViewerLib }> {
  viewerLibrary ??= loadPdfJs().then(async (pdfjs) => {
    (globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
    return { pdfjs, viewer: await import('pdfjs-dist/legacy/web/pdf_viewer.mjs') };
  });
  return viewerLibrary;
}

/** Marques des DRM connus dans le dictionnaire de chiffrement. */
const DRM_MARKERS: [RegExp, string][] = [
  [/EBX_HANDLER|ADEPT/, 'Adobe'],
  [/FOPN_/, 'FileOpen'],
  [/LOCKLIZARD|LLZ/i, 'LockLizard'],
];

async function drmVendor(source: Blob): Promise<string> {
  // Le dictionnaire de chiffrement est presque toujours près de la fin du fichier.
  const tail = source.slice(Math.max(0, source.size - (1 << 20)));
  const text = new TextDecoder('latin1').decode(await tail.arrayBuffer());
  return DRM_MARKERS.find(([re]) => re.test(text))?.[1] ?? 'inconnu';
}

const isTextItem = (item: object): item is TextItem => 'str' in item;

/**
 * Titre des métadonnées, sauf s'il ne vaut rien : vide, sans aucune lettre (quelle que soit
 * l'écriture), nom de logiciel ou de fichier (« Microsoft Word - cours.docx », « Document1 »).
 */
export function cleanTitle(raw: unknown, fileName: string): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  // (Un seul caractère latin ne fait pas un titre ; un idéogramme, si : « 道 ».)
  const junk = /^[\x00-\x7f]?$/.test(t)
    || !/\p{L}/u.test(t)
    || /^(untitled|sans titre|document\s*\d*|titre|title|sans nom)$/i.test(t)
    || /^microsoft (word|powerpoint)\b/i.test(t)
    || /\.(docx?|pdf|indd|qxd|rtf|odt|tex|dvi|ps|pages)$/i.test(t);
  if (!junk) return t.slice(0, 200);
  return fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sans titre';
}

/** Auteur des métadonnées, sauf compte d'ordinateur ou valeur vide (« Administrateur », « user »). */
export function cleanAuthor(raw: unknown): string | null {
  const t = (Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
  if (!t || !/\p{L}/u.test(t) || /^(unknown|inconnu|admin(istrat(or|eur))?|user|utilisateur|owner|auteur|author|propriétaire)$/i.test(t)) return null;
  return t.slice(0, 200);
}

/** Sommaire (signets) du PDF, avec la page et la hauteur de chaque destination. */
export async function readOutline(doc: PDFDocumentProxy, origins: number[] = []): Promise<PdfOutlineEntry[]> {
  const out: PdfOutlineEntry[] = [];
  type Node = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];
  const walk = async (items: Node[] | null | undefined, level: number): Promise<void> => {
    for (const item of items ?? []) {
      if (out.length >= 2000) return;
      let page = -1;
      let y: number | null = null;
      try {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
          page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
          const mode = (dest[1] as { name?: string } | undefined)?.name;
          const top = mode === 'XYZ' ? dest[3] : mode === 'FitH' || mode === 'FitBH' ? dest[2] : null;
          if (typeof top === 'number') y = top - (origins[page] ?? 0);
        }
      } catch {
        // signet sans destination utilisable : ignoré
      }
      out.push({ title: item.title ?? '', level, page, y });
      await walk(item.items as Node[], level + 1);
    }
  };
  await walk(await doc.getOutline().catch(() => null), 0);
  return out;
}

/**
 * Première page rendue en image. `illustratedOnly` : seulement si elle ressemble à une couverture
 * (illustrée, pas une page de texte) ; sinon la page telle quelle, comme dans les autres liseuses.
 */
async function renderCover(doc: PDFDocumentProxy, illustratedOnly = true): Promise<Blob | null> {
  // Hors navigateur (tests unitaires sous jsdom) : pas de dessin possible.
  if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return null;
  try {
    const page = await doc.getPage(1);
    const scale = Math.min(2, 480 / page.getViewport({ scale: 1 }).width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let inked = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i]! < 235 || data[i + 1]! < 235 || data[i + 2]! < 235) inked++;
    if (illustratedOnly && inked / (data.length / 16) < 0.2) return null;
    if (!inked) return null; // page blanche
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } catch (err) {
    // Sans couverture, le livre s'importe quand même ; l'échec est noté (diagnostic).
    logError('couverture pdf', err);
    return null;
  }
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Libère le document et le worker de pdf.js. */
  close(): void;
  /** Mot de passe qui a ouvert le PDF (gardé en mémoire le temps de la lecture, pour le rouvrir). */
  password?: string;
}

/**
 * Ouvre un PDF avec pdf.js : mot de passe demandé, DRM et fichier abîmé refusés avec une erreur
 * claire. `data` est cédé à pdf.js ; `source` sert à relire le fichier (nom du DRM).
 */
export async function openPdf(data: Uint8Array, source: Blob, options: PdfOptions = {}): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const safe = options.safeRendering === true;
  // Réglages de la visionneuse de pdf.js sur Android (Firefox, et les liseuses qui l'utilisent) :
  // polices standard livrées avec l'app plutôt que celles du système, dessin accéléré par le
  // processeur graphique, décodeurs d'images fournis. L'app lit elle-même ces fichiers.
  const task = pdfjs.getDocument({
    data,
    password: options.password,
    enableXfa: false,
    useSystemFonts: false,
    standardFontDataUrl: resourceUrl('standard_fonts'),
    cMapUrl: resourceUrl('cmaps'),
    cMapPacked: true,
    wasmUrl: resourceUrl('wasm'),
    useWorkerFetch: false,
    enableHWA: !safe,
    disableFontFace: safe ? true : undefined,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let cancelled = false;
  let password = options.password;
  task.onPassword = (update: (password: string) => void, reason: number) => {
    const ask = options.askPassword;
    if (!ask) {
      cancelled = true;
      void task.destroy();
      return;
    }
    void ask(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((given) => {
      if (given === null) {
        cancelled = true;
        void task.destroy();
      } else {
        password = given;
        update(given);
      }
    }, () => {
      cancelled = true;
      void task.destroy();
    });
  };

  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    // Échec d'ouverture (DRM, fichier abîmé…) : le worker de pdf.js est libéré quand même.
    if (!cancelled) void task.destroy();
    if (cancelled) {
      if (!options.askPassword) throw new ImportError('Ce PDF est protégé par un mot de passe.');
      throw new ImportCancelled();
    }
    const message = String((err as Error)?.message ?? err);
    if (/encryption/i.test(message)) throw new DrmError(await drmVendor(source));
    if ((err as Error)?.name === 'InvalidPDFException' || /invalid pdf/i.test(message)) throw new ImportError('Ce fichier PDF est abîmé ou incomplet.');
    throw err;
  }
  return { doc, close: () => void task.destroy(), password };
}

async function readMeta(doc: PDFDocumentProxy, fileName: string): Promise<{ title: string; author: string | null }> {
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  return {
    title: cleanTitle(meta?.metadata?.get('dc:title') ?? info.Title, fileName),
    author: cleanAuthor(meta?.metadata?.get('dc:creator') ?? info.Author),
  };
}

/**
 * Import d'un PDF pour le lire en pages originales : titre, auteur, nombre de pages et couverture,
 * sans convertir le texte (ce sera fait à la demande, en « texte adapté »). Un PDF scanné s'importe
 * aussi : ses pages sont des images, elles se lisent telles quelles.
 */
export async function readPdfInfo(data: Uint8Array, source: Blob, fileName: string, options: PdfOptions = {}): Promise<ParsedBook> {
  const { doc, close } = await openPdf(data, source, options);
  try {
    const [{ title, author }, cover, ocr] = await Promise.all([readMeta(doc, fileName), renderCover(doc, false), scannedWithOcr(doc)]);
    options.onProgress?.(1, 1);
    return { format: 'pdf', title, author, chapters: [], resources: {}, cover, language: null, pageCount: doc.numPages, ...(ocr ? { ocr } : {}) };
  } finally {
    close();
  }
}

/**
 * Convertit un PDF en livre (« texte adapté ») : texte des pages, chapitres (signets, titres ou
 * tranches de pages), métadonnées et couverture.
 */
export async function parsePdf(data: Uint8Array, source: Blob, fileName: string, options: PdfOptions = {}): Promise<ParsedBook> {
  const { doc, close } = await openPdf(data, source, options);
  try {
    const total = doc.numPages;
    const pages: PdfPageText[] = [];
    const origins: number[] = [];
    let lang: string | null = null;
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      const content = await page.getTextContent();
      lang ??= content.lang;
      origins.push(y0);
      pages.push({
        width: x1 - x0,
        height: y1 - y0,
        items: content.items.filter(isTextItem).map((it) => ({
          str: it.str,
          x: (it.transform[4] as number) - x0,
          y: (it.transform[5] as number) - y0,
          width: it.width,
          size: Math.hypot(it.transform[2] as number, it.transform[3] as number) || it.height,
          font: it.fontName,
        })),
      });
      page.cleanup();
      options.onProgress?.(i, total);
    }
    const [outline, { title, author }, cover, ocr] = await Promise.all([readOutline(doc, origins), readMeta(doc, fileName), renderCover(doc), scannedWithOcr(doc)]);

    const result = convertPdfText(pages, outline, title, { ocr });
    if (result.words < Math.max(20, total * 3)) throw new ScannedPdfError();
    const chapters = result.chapters.map((c) => ({ ...c, html: sanitizeHtml(c.html) }));
    const sample = textSample(chapters);
    if (unreadableRatio(sample) > 0.3) {
      throw new ImportError('Le texte de ce PDF est illisible : ses polices ne disent pas à quelles lettres correspondent leurs caractères.');
    }
    const language = normalizeLanguage(lang) ?? detectLanguage(sample);
    return { format: 'pdf', title, author, chapters, resources: {}, cover, language, pageCount: total, ...(ocr ? { ocr } : {}) };
  } finally {
    close();
  }
}

/**
 * Livre scanné dont le texte vient d'une reconnaissance de caractères (OCR) : ce texte est posé,
 * invisible (mode de rendu 3), sur l'image de la page. Trois pages réparties suffisent à le voir.
 */
async function scannedWithOcr(doc: PDFDocumentProxy): Promise<boolean> {
  const { OPS } = await loadPdfJs();
  const total = doc.numPages;
  const picks = [...new Set([0.25, 0.5, 0.75].map((f) => Math.min(total, Math.max(1, Math.round(total * f)))))];
  for (const n of picks) {
    const page = await doc.getPage(n);
    try {
      const { fnArray, argsArray } = await page.getOperatorList();
      const image = fnArray.some((fn) => fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject);
      const invisible = fnArray.some((fn, i) => fn === OPS.setTextRenderingMode && (argsArray[i] as number[] | undefined)?.[0] === 3);
      if (image && invisible) return true;
    } catch {
      // page illisible : on regarde la suivante
    } finally {
      page.cleanup();
    }
  }
  return false;
}
