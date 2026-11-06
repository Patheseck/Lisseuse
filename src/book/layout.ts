import type { BookFormat, Chapter } from './types';

// Découpage des chapitres pour la lecture.
//
// L'analyseur produit les chapitres « d'origine » du fichier. Certains sont bien trop longs pour
// être lus confortablement (un .txt entier, un Markdown n'ayant que des titres « ## », un EPUB
// fait d'un seul fichier) : la mise en page de centaines de pages est lente et le sommaire n'aide
// plus. On les découpe donc en morceaux, à des frontières de blocs (paragraphes, titres).
//
// Garantie : recoller le texte des morceaux redonne exactement le texte du chapitre d'origine.
// Toute position (fiche, signet, progression) se convertit ainsi sans perte ; si la garantie
// n'est pas tenue pour un chapitre, il n'est pas découpé.

/** Version du découpage. Un livre enregistré avec une version antérieure est migré à l'ouverture. */
export const LAYOUT_VERSION = 1;
/** Au-delà de ce nombre de mots, un chapitre est découpé (≈ 85 pages en taille de texte par défaut). */
export const MAX_WORDS = 10_000;
/** Taille visée des morceaux d'un chapitre découpé. */
export const TARGET_WORDS = 5_000;
/** Un morceau d'introduction plus court que ceci est rattaché à la section suivante. */
const MIN_INTRO_WORDS = 50;

export interface LayoutPart {
  /** Index du chapitre d'origine. */
  base: number;
  /** Début du morceau dans le texte du chapitre d'origine. */
  start: number;
  /** Longueur du texte du morceau (-1 : chapitre non découpé, le morceau est le chapitre entier). */
  length: number;
}

export interface ChapterLayout {
  chapters: Chapter[];
  /** `parts[i]` décrit l'origine de `chapters[i]`. */
  parts: LayoutPart[];
}

export interface LayoutSource {
  format: BookFormat;
  fileName: string;
}

const HEADING = /^H[1-4]$/;
/** Éléments qui peuvent envelopper tout un chapitre. */
const CONTAINER = /^(DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|BLOCKQUOTE|FIGURE)$/;
/** Titres de chapitre d'un texte brut (.txt), écrits seuls sur leur ligne. */
const TXT_HEADING = /^(?:(?:chapitre|chapter|cap[ií]tulo|capitolo|kapitel|partie|part|livre|book|tome)\b.{0,60}|prologue|[ée]pilogue|pr[ée]face|avant-propos|introduction|conclusion|[IVXLC]{1,7}\.?|\d{1,3}\.?)$/i;

function fragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

/** Texte d'un chapitre, identique au textContent de son rendu dans le lecteur. */
export function chapterText(html: string): string {
  return fragment(html).textContent ?? '';
}

function textOf(node: Node): string {
  return node.textContent ?? '';
}

export function countWords(text: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const space = c === 32 || c === 10 || c === 9 || c === 13 || c === 12 || c === 160;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

/** Estimation rapide (sans analyse du HTML) pour écarter les chapitres de taille normale. */
function roughWords(html: string): number {
  return countWords(html.replace(/<[^>]*>/g, ' '));
}

function serialize(nodes: Node[]): string {
  const box = document.createElement('div');
  box.append(...nodes);
  return box.innerHTML;
}

interface Piece {
  label: string;
  nodes: Node[];
  depth?: number;
}

/** .txt d'un seul tenant : les lignes « Chapitre 3 », « II », « Épilogue »… deviennent des titres. */
function promoteTxtHeadings(frag: DocumentFragment): void {
  const candidates = Array.from(frag.children).filter((el) => {
    if (el.tagName !== 'P') return false;
    const t = textOf(el).trim();
    return t.length > 0 && t.length <= 80 && TXT_HEADING.test(t);
  });
  if (candidates.length < 2) return;
  for (const p of candidates) {
    const h2 = document.createElement('h2');
    h2.append(...Array.from(p.childNodes));
    p.replaceWith(h2);
  }
}

/** Document Markdown ou texte d'un seul chapitre : une section par titre de niveau 2. */
function sectionsByH2(frag: DocumentFragment, label: string): Piece[] | null {
  const top = Array.from(frag.childNodes);
  if (top.filter((n) => n.nodeName === 'H2').length < 2) return null;
  const groups: Node[][] = [[]];
  for (const node of top) {
    if (node.nodeName === 'H2' && groups.at(-1)!.length) groups.push([]);
    groups.at(-1)!.push(node);
  }
  // Une introduction très courte (souvent le seul titre du document) rejoint la 1re section.
  if (groups.length > 1 && countWords(groups[0]!.map(textOf).join('')) < MIN_INTRO_WORDS) {
    groups[1] = [...groups[0]!, ...groups[1]!];
    groups.shift();
  }
  // Chaque section porte le titre de son « ## » ; une introduction sans titre garde celui du chapitre.
  return groups.map((nodes) => {
    const h2 = nodes.find((n) => n.nodeName === 'H2');
    return { label: (h2 && textOf(h2).replace(/\s+/g, ' ').trim()) || label, nodes };
  });
}

/**
 * Découpe une suite de nœuds trop longue en morceaux d'environ TARGET_WORDS mots, de préférence
 * juste avant un titre. Descend dans les enveloppes (un <div> qui contient tout le chapitre).
 */
function splitBySize(nodes: Node[], label: string, depth = 0): Piece[] {
  // Enveloppes successives : un seul élément porte presque tout le texte.
  const chain: Element[] = [];
  const before: Node[][] = [];
  const after: Node[][] = [];
  let units = nodes;
  for (;;) {
    const total = units.reduce((n, u) => n + textOf(u).length, 0);
    const main = units.find((u): u is Element => u.nodeType === Node.ELEMENT_NODE && CONTAINER.test(u.nodeName) && (u as Element).childElementCount > 0 && textOf(u).length >= total * 0.9);
    if (!main || total === 0) break;
    const i = units.indexOf(main);
    chain.push(main);
    before.push(units.slice(0, i));
    after.push(units.slice(i + 1));
    units = Array.from(main.childNodes);
  }

  // Avec des titres, on coupe de préférence juste avant l'un d'eux (jusqu'à 1,6 × la taille visée).
  const isHeading = (n: Node) => n.nodeType === Node.ELEMENT_NODE && HEADING.test(n.nodeName);
  // (Le titre placé en tête du morceau ne compte pas : on ne coupera jamais avant lui.)
  const firstText = units.findIndex((u) => textOf(u).trim() && !isHeading(u));
  const hasHeadings = firstText >= 0 && units.slice(firstText).some(isHeading);
  const groups: Node[][] = [];
  let current: Node[] = [];
  let acc = 0;
  for (const unit of units) {
    const words = countWords(textOf(unit));
    if (current.length && acc >= TARGET_WORDS && (!hasHeadings || isHeading(unit) || acc + words > TARGET_WORDS * 1.6)) {
      groups.push(current);
      current = [];
      acc = 0;
    }
    current.push(unit);
    acc += words;
  }
  if (current.length) groups.push(current);
  if (groups.length > 1 && countWords(groups.at(-1)!.map(textOf).join('')) < TARGET_WORDS * 0.3) {
    const tail = groups.pop()!;
    groups.at(-1)!.push(...tail);
  }
  if (groups.length < 2) return [{ label, nodes, depth }];

  return groups.map((group, k) => {
    let inner: Node[] = group;
    for (let level = chain.length - 1; level >= 0; level--) {
      const wrapper = chain[level]!.cloneNode(false) as Element;
      wrapper.append(...inner);
      inner = [...(k === 0 ? before[level]! : []), wrapper, ...(k === groups.length - 1 ? after[level]! : [])];
    }
    const first = group.find((n) => textOf(n).trim());
    const heading = first && first.nodeType === Node.ELEMENT_NODE && HEADING.test(first.nodeName) ? textOf(first).replace(/\s+/g, ' ').trim() : '';
    return {
      label: k === 0 ? label : heading || `${label} (${k + 1}/${groups.length})`,
      nodes: inner,
      depth: k === 0 ? depth : depth + 1,
    };
  });
}

/** Morceaux d'un chapitre, ou null s'il n'y a rien à découper. */
function splitChapter(chapter: Chapter, singleDocument: LayoutSource | null): Piece[] | null {
  const frag = fragment(chapter.html);
  let pieces: Piece[] = [{ label: chapter.label, nodes: Array.from(frag.childNodes), depth: chapter.depth }];
  if (singleDocument) {
    if (/\.txt$/i.test(singleDocument.fileName)) promoteTxtHeadings(frag);
    pieces = sectionsByH2(frag, chapter.label) ?? [{ label: chapter.label, nodes: Array.from(frag.childNodes), depth: chapter.depth }];
  }
  const result: Piece[] = [];
  for (const piece of pieces) {
    if (countWords(piece.nodes.map(textOf).join('')) > MAX_WORDS) result.push(...splitBySize(piece.nodes, piece.label, piece.depth ?? 0));
    else result.push(piece);
  }
  return result.length > 1 ? result : null;
}

/** Les liens internes visent désormais le morceau qui contient leur cible. */
function retargetLinks(chapters: Chapter[], parts: LayoutPart[]): Chapter[] {
  const byBase = new Map<number, number[]>();
  parts.forEach((p, i) => byBase.set(p.base, [...(byBase.get(p.base) ?? []), i]));
  const ids = chapters.map((c) => new Set(c.html.includes('data-anchor-id') ? Array.from(fragment(c.html).querySelectorAll('[data-anchor-id]'), (el) => el.getAttribute('data-anchor-id') ?? '') : []));
  return chapters.map((chapter, i) => {
    if (!/data-(chapter|anchor)=/.test(chapter.html)) return chapter;
    const frag = fragment(chapter.html);
    let changed = false;
    for (const a of Array.from(frag.querySelectorAll('a[data-chapter], a[data-anchor]'))) {
      const target = a.hasAttribute('data-chapter') ? Number(a.getAttribute('data-chapter')) : parts[i]!.base;
      const candidates = byBase.get(target);
      if (!candidates) continue;
      const anchor = a.getAttribute('data-anchor');
      const found = anchor ? candidates.find((q) => ids[q]!.has(anchor)) : undefined;
      a.setAttribute('data-chapter', String(found ?? candidates[0]));
      changed = true;
    }
    return changed ? { ...chapter, html: serialize(Array.from(frag.childNodes)) } : chapter;
  });
}

/** Découpe les chapitres trop longs. Sans découpage, renvoie les chapitres tels quels. */
export function computeLayout(base: Chapter[], source: LayoutSource): ChapterLayout {
  const single = base.length === 1 && source.format === 'md' ? source : null;
  const chapters: Chapter[] = [];
  const parts: LayoutPart[] = [];
  base.forEach((chapter, b) => {
    const pieces = single || roughWords(chapter.html) > MAX_WORDS ? splitChapter(chapter, single) : null;
    if (pieces) {
      const htmls = pieces.map((p) => serialize(p.nodes));
      const texts = htmls.map(chapterText);
      if (texts.join('') === chapterText(chapter.html)) {
        let start = 0;
        pieces.forEach((p, k) => {
          chapters.push({ label: p.label, html: htmls[k]!, ...(p.depth ? { depth: p.depth } : {}) });
          parts.push({ base: b, start, length: texts[k]!.length });
          start += texts[k]!.length;
        });
        return;
      }
    }
    chapters.push(chapter);
    parts.push({ base: b, start: 0, length: -1 });
  });
  if (chapters.length === base.length) return { chapters: base, parts };
  return { chapters: retargetLinks(chapters, parts), parts };
}

/** Chapitres à afficher pour une version de découpage donnée (0 : ceux de l'analyseur). */
export function layoutChapters(base: Chapter[], source: LayoutSource, version: number): Chapter[] {
  return version >= 1 ? computeLayout(base, source).chapters : base;
}

// ---------- Conversion des positions ----------

export function partsOf(layout: ChapterLayout, base: number): number[] {
  const out: number[] = [];
  layout.parts.forEach((p, i) => {
    if (p.base === base) out.push(i);
  });
  return out;
}

/** Premier morceau d'un chapitre d'origine (là où s'affichent son aperçu et sa question). */
export function firstPartOf(layout: ChapterLayout, base: number): number {
  const parts = partsOf(layout, base);
  return parts[0] ?? Math.max(0, Math.min(base, layout.chapters.length - 1));
}

/** Position `offset` (en caractères) du chapitre d'origine → morceau et position dans celui-ci. */
export function mapOffset(layout: ChapterLayout, base: number, offset: number): { chapter: number; offset: number } {
  const parts = partsOf(layout, base);
  if (parts.length <= 1) return { chapter: parts[0] ?? firstPartOf(layout, base), offset };
  let chosen = parts[0]!;
  for (const q of parts) if (layout.parts[q]!.start <= offset) chosen = q;
  return { chapter: chosen, offset: offset - layout.parts[chosen]!.start };
}

/** Position relative (0 à 1) dans le chapitre d'origine → morceau et position relative dans celui-ci. */
export function mapFraction(layout: ChapterLayout, base: number, fraction: number): { chapter: number; fraction: number } {
  const parts = partsOf(layout, base);
  if (parts.length <= 1) return { chapter: parts[0] ?? firstPartOf(layout, base), fraction };
  const total = parts.reduce((n, q) => n + layout.parts[q]!.length, 0);
  const at = Math.min(1, Math.max(0, fraction)) * total;
  let chosen = parts[0]!;
  for (const q of parts) if (layout.parts[q]!.start <= at && layout.parts[q]!.length > 0) chosen = q;
  const part = layout.parts[chosen]!;
  return { chapter: chosen, fraction: part.length > 0 ? Math.min(1, Math.max(0, (at - part.start) / part.length)) : 0 };
}
