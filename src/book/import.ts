import { parseEpub } from './epub';
import { ImportError } from './errors';
import { parseMarkdown } from './markdown';
import { parsePdf, type PdfOptions } from './pdf';
import type { BookFormat, ParsedBook } from './types';

export { ImportError };

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signature « %PDF- » : en tête du fichier, ou plus loin dans le premier kilo-octet (la norme
 * le permet) pour un fichier nommé .pdf. Un texte qui parle du format PDF n'est pas un PDF.
 */
export function isPdf(head: Uint8Array, fileName = ''): boolean {
  const at = String.fromCharCode(...head.subarray(0, 1024)).indexOf('%PDF-');
  return at >= 0 && (at < 8 || /\.pdf$/i.test(fileName));
}

/** Détermine le format par le contenu (signature ZIP ou PDF) puis par l'extension. */
export function detectFormat(fileName: string, head: Uint8Array): BookFormat | null {
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) return 'epub';
  if (isPdf(head, fileName)) return 'pdf';
  if (/\.(md|markdown|txt)$/i.test(fileName)) return 'md';
  return null;
}

export interface ImportedBook {
  id: string;
  parsed: ParsedBook;
}

/** Texte lisible (UTF-8 valide, sans octets nuls), ou null pour un fichier binaire. */
export function decodeText(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1 << 16));
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    // Ancien fichier texte Windows (accents en Latin-1) : on le lit quand même.
    const latin = new TextDecoder('windows-1252').decode(buffer);
    return /[\u0000-\u0008\u000E-\u001F]/.test(latin.slice(0, 65536)) ? null : latin;
  }
}

export async function parseBookFile(file: Blob, fileName: string, options: PdfOptions = {}): Promise<ImportedBook> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength));
  const format = detectFormat(fileName, head);
  if (!format) throw new ImportError('Format non pris en charge. Choisis un fichier .epub, .pdf, .md ou .txt.');
  const id = await sha256Hex(buffer);
  if (format === 'epub') return { id, parsed: await parseEpub(buffer, fileName) };
  // pdf.js prend possession du tampon : l'empreinte est calculée avant.
  if (format === 'pdf') return { id, parsed: await parsePdf(new Uint8Array(buffer), file, fileName, options) };
  const text = decodeText(buffer);
  if (text === null) throw new ImportError('Ce fichier n’est pas un texte lisible. Choisis un fichier .epub, .pdf, .md ou .txt.');
  return { id, parsed: parseMarkdown(text, fileName) };
}
