import { parseEpub } from './epub';
import { parseMarkdown } from './markdown';
import type { BookFormat, ParsedBook } from './types';

export class ImportError extends Error {}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Détermine le format par le contenu (signature ZIP) puis par l'extension. */
export function detectFormat(fileName: string, head: Uint8Array): BookFormat | null {
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) return 'epub';
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

export async function parseBookFile(file: Blob, fileName: string): Promise<ImportedBook> {
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
  if (String.fromCharCode(...head) === '%PDF-') throw new ImportError('Les fichiers PDF ne sont pas encore pris en charge. Choisis un fichier .epub, .md ou .txt.');
  const format = detectFormat(fileName, head);
  if (!format) throw new ImportError('Format non pris en charge. Choisis un fichier .epub, .md ou .txt.');
  const id = await sha256Hex(buffer);
  if (format === 'epub') return { id, parsed: await parseEpub(buffer, fileName) };
  const text = decodeText(buffer);
  if (text === null) throw new ImportError('Ce fichier n’est pas un texte lisible. Choisis un fichier .epub, .md ou .txt.');
  return { id, parsed: parseMarkdown(text, fileName) };
}
