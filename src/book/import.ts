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

export async function parseBookFile(file: Blob, fileName: string): Promise<ImportedBook> {
  const buffer = await file.arrayBuffer();
  const format = detectFormat(fileName, new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)));
  if (!format) throw new ImportError('Format non pris en charge. Choisis un fichier .epub ou .md.');
  const id = await sha256Hex(buffer);
  const parsed = format === 'epub' ? await parseEpub(buffer, fileName) : parseMarkdown(new TextDecoder().decode(buffer), fileName);
  return { id, parsed };
}
