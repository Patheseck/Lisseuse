/** `legacy` : livre d'une très ancienne V5 dont seul le HTML des chapitres a été conservé. */
export type BookFormat = 'epub' | 'md' | 'legacy';

export interface Chapter {
  /** Libellé affiché dans la table des matières. */
  label: string;
  /** HTML nettoyé. Les images pointent vers une ressource via `data-res`. */
  html: string;
  /** 1 pour une section d'un chapitre découpé (décalée dans le sommaire). */
  depth?: number;
}

export interface ParsedBook {
  format: BookFormat;
  title: string;
  author: string | null;
  chapters: Chapter[];
  /** Ressources binaires (images) référencées par `data-res` dans les chapitres. */
  resources: Record<string, Blob>;
  cover: Blob | null;
  /** Langue du texte (balise BCP 47, ex. « fr », « en-GB ») si elle est connue. */
  language?: string | null;
}

/**
 * Version du format produit par les analyseurs : un changement invalide le cache des chapitres.
 * 2 (6.3) : les .txt écrits avec un paragraphe par ligne sont découpés en paragraphes.
 */
export const PARSER_VERSION = 2;
