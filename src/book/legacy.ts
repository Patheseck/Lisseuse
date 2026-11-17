import { sanitizeHtml } from './sanitize';
import type { Chapter, ParsedBook } from './types';

// Les toutes premières versions de la V5 ne gardaient pas le fichier d'origine, seulement le
// HTML des chapitres. On le conserve tel quel dans un fichier JSON pour ne rien perdre.

export interface LegacyBookFile {
  title: string;
  chapters: Chapter[];
}

export function legacyBookBlob(title: string, chapters: Chapter[]): Blob {
  return new Blob([JSON.stringify({ title, chapters } satisfies LegacyBookFile)], { type: 'application/json' });
}

export function parseLegacy(text: string): ParsedBook {
  const data = JSON.parse(text) as Partial<LegacyBookFile>;
  const chapters = (Array.isArray(data.chapters) ? data.chapters : [])
    .filter((c) => c && typeof c.html === 'string')
    .map((c, i) => ({ label: typeof c.label === 'string' && c.label ? c.label : `Section ${i + 1}`, html: sanitizeHtml(c.html) }));
  if (!chapters.length) throw new Error('Livre ancien sans contenu lisible.');
  return { format: 'legacy', title: data.title || 'Sans titre', author: null, chapters, resources: {}, cover: null };
}
