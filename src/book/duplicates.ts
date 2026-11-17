import type { BookFormat } from './types';

// Doublons : le même livre dans un autre fichier (autre édition, autre format, copie
// retéléchargée). Un fichier identique a déjà la même empreinte (même identifiant) ; ici, on
// reconnaît le livre à son titre et à son auteur. Seulement pour les livres publiés (EPUB, PDF) :
// deux notes Markdown peuvent légitimement porter le même titre.

interface BookLike {
  title: string;
  author: string | null;
  format: BookFormat;
}

/**
 * Titre ramené à l'essentiel : sans accents, majuscules ni ponctuation, et sans les mentions
 * entre parenthèses ou crochets (« (French Edition) », « [z-lib.org] », « (1) »).
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Nom de fichier ramené à l'essentiel, sans extension (« Les 48 lois (1).epub » → « les 48 lois »). */
export function fileStemKey(fileName: string): string {
  return titleKey(fileName.replace(/\.[^.]+$/, ''));
}

const words = (key: string) => key.split(' ').filter(Boolean);

/** Titre qui ne désigne pas un livre précis : trop court, ou générique. */
function vague(key: string): boolean {
  return key.length < 6 || /^(sans titre|untitled|document \d*|livre|book|ebook|notes?|cours|chapitre \d+|tome \d+|volume \d+)$/.test(key);
}

/** Auteurs compatibles : l'un des deux manque, ou ils ont un nom en commun (« Greene, Robert » et « Robert Greene »). */
function sameAuthor(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const names = new Set(words(titleKey(a)).filter((w) => w.length >= 3));
  return words(titleKey(b)).some((w) => w.length >= 3 && names.has(w));
}

/**
 * Même titre ; un titre suivi ou précédé du nom de l'auteur (titre tiré d'un nom de fichier :
 * « Le pouvoir du moment présent - Eckhart Tolle ») compte comme le titre seul.
 */
function sameTitle(a: BookLike, b: BookLike): boolean {
  const ka = titleKey(a.title);
  const kb = titleKey(b.title);
  if (vague(ka) || vague(kb)) return false;
  if (ka === kb) return true;
  const author = new Set([...words(titleKey(a.author ?? '')), ...words(titleKey(b.author ?? ''))]);
  const strip = (key: string) => {
    const w = words(key);
    while (w.length > 1 && author.has(w[w.length - 1]!)) w.pop();
    while (w.length > 1 && author.has(w[0]!)) w.shift();
    return w.join(' ');
  };
  const sa = strip(ka);
  return !vague(sa) && sa === strip(kb);
}

const published = (f: BookFormat) => f === 'epub' || f === 'pdf';

/** Le même livre que `candidate` dans `books` (autre fichier), ou null. */
export function findSameBook<T extends BookLike>(candidate: BookLike, books: T[]): T | null {
  if (!published(candidate.format)) return null;
  return books.find((b) => published(b.format) && sameAuthor(candidate.author, b.author) && sameTitle(candidate, b)) ?? null;
}

/** Livres présents en plusieurs exemplaires dans la bibliothèque (groupes d'au moins deux). */
export function duplicateGroups<T extends BookLike>(books: T[]): T[][] {
  const groups: T[][] = [];
  for (const book of books) {
    const group = groups.find((g) => findSameBook(book, g));
    if (group) group.push(book);
    else groups.push([book]);
  }
  return groups.filter((g) => g.length > 1);
}

/**
 * Fichier trouvé dans le téléphone qui a l'air d'un livre déjà présent : même nom de fichier
 * (sans extension, mentions ni « (1) »), ou nom égal à son titre (« Titre - Auteur » compris).
 */
export function looksLikeBook(fileName: string, books: (BookLike & { fileName: string })[]): boolean {
  const ext = /\.(epub|pdf)$/i.exec(fileName)?.[1]?.toLowerCase() as 'epub' | 'pdf' | undefined;
  if (!ext) return false;
  const stem = fileStemKey(fileName);
  if (!vague(stem) && books.some((b) => published(b.format) && fileStemKey(b.fileName) === stem)) return true;
  return !!findSameBook({ title: fileName.replace(/\.[^.]+$/, ''), author: null, format: ext }, books);
}

/** Ce que l'utilisateur a mis dans un exemplaire : fiches, notes (signets, objectif, bilan…), lecture. */
export interface CopyData {
  cards: number;
  notes: boolean;
  /** Pourcentage lu. */
  read: number;
}

export interface DuplicatePlan<T> {
  /** L'exemplaire gardé. */
  keep: T;
  /** Les exemplaires sans fiches ni notes : retirés sans rien perdre. */
  remove: T[];
  /** Les autres exemplaires qui ont aussi des fiches ou des notes : à l'utilisateur de choisir. */
  conflicts: T[];
}

/**
 * Pour chaque groupe de doublons : on garde l'exemplaire qui a le plus de fiches, puis des notes,
 * puis la lecture la plus avancée, puis le plus récemment ouvert ; les autres partent s'ils n'ont
 * ni fiche ni note (leur seule perte : une position de lecture moins avancée).
 */
export function planDuplicates<T extends { lastOpenedAt: number }>(groups: T[][], data: (book: T) => CopyData): DuplicatePlan<T>[] {
  return groups.map((group) => {
    const ranked = [...group].sort((a, b) => {
      const da = data(a);
      const db = data(b);
      return db.cards - da.cards || Number(db.notes) - Number(da.notes) || db.read - da.read || b.lastOpenedAt - a.lastOpenedAt;
    });
    const [keep, ...others] = ranked as [T, ...T[]];
    const personal = (b: T) => data(b).cards > 0 || data(b).notes;
    return { keep, remove: others.filter((b) => !personal(b)), conflicts: others.filter(personal) };
  });
}
