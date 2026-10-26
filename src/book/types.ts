/** `legacy` : livre d'une très ancienne V5 dont seul le HTML des chapitres a été conservé. */
export type BookFormat = 'epub' | 'md' | 'legacy';

export interface Chapter {
  /** Libellé affiché dans la table des matières. */
  label: string;
  /** HTML nettoyé. Les images pointent vers une ressource via `data-res`. */
  html: string;
}

export interface ParsedBook {
  format: BookFormat;
  title: string;
  author: string | null;
  chapters: Chapter[];
  /** Ressources binaires (images) référencées par `data-res` dans les chapitres. */
  resources: Record<string, Blob>;
  cover: Blob | null;
}

/** Version du format produit par les analyseurs : un changement invalide le cache des chapitres. */
export const PARSER_VERSION = 1;
