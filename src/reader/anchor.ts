// Ancrage des surlignages dans le texte d'un chapitre.
// Les positions sont des index de caractères dans le textContent du chapitre, complétés par
// la citation exacte et un peu de contexte : si le texte change (nouvelle version de l'analyseur),
// on retrouve le passage par la citation plutôt que de le perdre.

export interface TextAnchor {
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 32;

/** Index de début d'un point (conteneur, décalage) dans le texte de `root`. */
function textOffset(root: Node, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return range.toString().length;
}

export function anchorFromOffsets(text: string, start: number, end: number): TextAnchor {
  return {
    start,
    end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

/** Crée une ancre depuis une sélection, sans les espaces de début et de fin. Null si la sélection est hors de `root` ou vide. */
export function anchorFromRange(root: Element, range: Range): TextAnchor | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = root.textContent ?? '';
  let start = textOffset(root, range.startContainer, range.startOffset);
  let end = textOffset(root, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end <= start) return null;
  ({ start, end } = expandToWords(text, start, end));
  return anchorFromOffsets(text, start, end);
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’-]/u;

/**
 * Étend une sélection aux mots entiers : au doigt, on coupe souvent la première ou la
 * dernière lettre. Un mot partiellement sélectionné est inclus en entier.
 */
export function expandToWords(text: string, start: number, end: number): { start: number; end: number } {
  const isWord = (i: number) => i >= 0 && i < text.length && WORD_CHAR.test(text[i]!);
  while (isWord(start - 1) && isWord(start)) start--;
  while (isWord(end) && isWord(end - 1)) end++;
  return { start, end };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Recherche tolérante aux espaces : une citation copiée depuis une sélection peut contenir
 * des retours à la ligne là où le texte a des espaces (ou l'inverse). Sert aux données V5.
 */
export function locateLoose(text: string, quote: string, from = 0): { start: number; end: number } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Retrouve la position actuelle d'une ancre dans `text`, ou null si le passage a disparu. */
export function locate(text: string, anchor: TextAnchor): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  if (text.slice(anchor.start, anchor.end) === anchor.quote) return { start: anchor.start, end: anchor.end };
  if (!text.includes(anchor.quote)) return locateLoose(text, anchor.quote);
  let best: { start: number; score: number } | null = null;
  for (let i = text.indexOf(anchor.quote); i !== -1; i = text.indexOf(anchor.quote, i + 1)) {
    const context =
      commonSuffixLength(text.slice(Math.max(0, i - CONTEXT), i), anchor.prefix) +
      commonPrefixLength(text.slice(i + anchor.quote.length, i + anchor.quote.length + CONTEXT), anchor.suffix);
    const score = context * 1000 - Math.abs(i - anchor.start) / 1000;
    if (!best || score > best.score) best = { start: i, score };
  }
  return best ? { start: best.start, end: best.start + anchor.quote.length } : null;
}

/**
 * Enveloppe les caractères [start, end[ de `root` dans des éléments créés par `make`.
 * Fonctionne à travers plusieurs nœuds (gras, italique, paragraphes) : un élément par
 * morceau de texte. Les nœuds ne contenant que des espaces sont ignorés.
 */
export function wrapRange(root: Element, start: number, end: number, make: () => HTMLElement): HTMLElement[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;
    const from = Math.max(start, pos) - pos;
    const to = Math.min(end, pos + len) - pos;
    if (to > from && /\S/.test(node.data.slice(from, to))) targets.push({ node, from, to });
    pos += len;
    if (pos >= end) break;
  }
  return targets.map(({ node, from, to }) => {
    const middle = from > 0 ? node.splitText(from) : node;
    if (to - from < middle.data.length) middle.splitText(to - from);
    const el = make();
    middle.replaceWith(el);
    el.append(middle);
    return el;
  });
}

/** Retire les éléments d'enveloppe correspondant à `selector` en conservant leur texte. */
export function unwrap(root: Element, selector: string): void {
  root.querySelectorAll(selector).forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes));
  });
  root.normalize();
}
