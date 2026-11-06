import { countWords } from './layout';
import { escapeHtml } from './markdown';
import type { Chapter } from './types';

// Conversion du texte d'un PDF en chapitres HTML.
//
// Un PDF ne contient pas de paragraphes : seulement des morceaux de texte posés à des
// coordonnées. On reconstruit donc les lignes (même ligne de base), on retire ce qui n'est pas
// le texte du livre (en-têtes courants, numéros de page), on sort les notes de bas de page du
// fil du texte, on recolle les lignes en paragraphes (espace, alinéa, dernière ligne courte),
// on répare les mots coupés en fin de ligne, puis on découpe en chapitres : d'après les signets
// du PDF, sinon d'après les titres (plus grands que le texte), sinon par tranches de pages.
//
// Livre scanné (texte reconnu par OCR, invisible sur l'image des pages) : les tailles de texte
// varient d'un mot à l'autre et des lignes de bruit viennent des illustrations ; la conversion
// est alors plus tolérante sur les tailles, plus exigeante sur les titres, et retire ce bruit.
//
// Ce module ne dépend pas de pdf.js : il reçoit les morceaux de texte déjà extraits, ce qui
// permet de le tester avec des pages construites à la main.

export interface PdfItem {
  str: string;
  /** Position de la ligne de base (repère PDF : origine en bas à gauche). */
  x: number;
  y: number;
  width: number;
  /** Corps du texte, en points. */
  size: number;
  font: string;
}

export interface PdfPageText {
  width: number;
  height: number;
  items: PdfItem[];
}

export interface PdfOutlineEntry {
  title: string;
  /** 0 pour le premier niveau du sommaire. */
  level: number;
  page: number;
  /** Haut de la destination dans la page, ou null (début de page). */
  y: number | null;
}

/** Taille visée d'une tranche de pages quand le PDF n'a ni signets ni titres. */
export interface ConvertOptions {
  /** Livre scanné dont le texte vient d'une reconnaissance de caractères (OCR). */
  ocr?: boolean;
}

/**
 * Version de la conversion : un texte adapté plus ancien est refait à l'ouverture, si aucune
 * donnée (fiche, signet, question…) n'y est encore posée. 2 (6.9.2) : livres scannés (OCR),
 * grandes lettres seules (« I », « V »), vers et retours à la ligne.
 */
export const PDF_TEXT_VERSION = 2;

export const PDF_CHUNK_WORDS = 5_000;
/** Libellé du texte placé avant le premier chapitre (page de titre, préface sans signet…). */
export const FRONT_LABEL = 'Début du livre';

interface Span {
  text: string;
  sup?: boolean;
  /** Retour à la ligne gardé (vers d'un poème, d'une fable). */
  br?: boolean;
}

interface Line {
  page: number;
  spans: Span[];
  x: number;
  right: number;
  y: number;
  size: number;
  font: string;
  /** Lettrine : grande initiale à recoller au mot qui suit. */
  dropCap?: boolean;
}

interface Block {
  kind: 'p' | 'h';
  page: number;
  y: number;
  size: number;
  spans: Span[];
  /** Niveau de titre (2 à 4) une fois les tailles classées. */
  level?: number;
  /** Titre reconnu à sa formulation (« Chapitre 3 »), sans être plus grand que le texte. */
  pattern?: boolean;
}

interface Note {
  page: number;
  text: string;
}

const round = (n: number, step = 0.5) => Math.round(n / step) * step;
const lineText = (spans: Span[]) => spans.map((s) => s.text).join('');
const words = countWords;

const ROMAN = 'm{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';
/** « 12 », « - 12 - », « Page 12 », « 12 / 300 », « xiv ». */
const PAGE_NUMBER = new RegExp(`^[\\s\\-–—·.|\\[\\]()]*(?:p(?:age|\\.)?\\s*)?(?:\\d{1,4}|(?=[ivxlcdm])${ROMAN})(?:\\s*(?:/|sur|of|de)\\s*\\d{1,4})?[\\s\\-–—·.|\\[\\]()]*$`, 'i');
/** Début d'une note : « 1. », « (1) », « * », ou le numéro collé au texte (« 1Selon », traitements de texte). */
const NOTE_START = /^(?:\(?\d{1,3}[.)]?\s|\d{1,3}(?=\p{Lu})|[*†‡§]+\s?)/u;
const BULLET = /^(?:[•·▪◦‣●○■□–—-]|\d{1,3}[.)])\s/;
const SCENE_BREAK = /^[\s*•·◆◇❦⁂~#–—-]{1,12}$/;
const SENTENCE_END = /[.!?:;…»"”’)\]]$/;
/** Ligne de table des matières : points de conduite ou grand blanc, puis un numéro de page. */
const TOC_LINE = /(?:(?:\.\s?){3,}|…{2,}|\s{3,})\s*\d{1,4}$/;
const CHAPTER_WORD = /^(?:chapitre|chapter|cap[ií]tulo|capitolo|kapitel|partie|part|livre|book|tome|prologue|[ée]pilogue|pr[ée]face|avant-propos|introduction|conclusion|annexe|appendix|postface)\b/i;
/** Seconds éléments de mots composés (« peut-être », « c'est-à-dire », « a-t-il ») : le trait d'union reste. */
const COMPOUND_TAILS = new Set(['être', 'ce', 'ci', 'là', 'même', 'mêmes', 'il', 'ils', 'elle', 'elles', 'on', 'je', 'tu', 'nous', 'vous', 'dire', 'uns', 'unes']);
const HYPHEN_END = /([\p{L}’'-]*?)([\p{L}]+)[-\u00AD\u2010\u2011]$/u;

// ---------- Bruit de reconnaissance (OCR) ----------

/** Mots d'une ou deux lettres courants (français, anglais, langues voisines) : pas du bruit. */
const SHORT_WORDS = new Set(('à a y ô o ah oh eh hé ha ho de le la du un il je tu on en et ou où si ne se ce me te sa ma ta ni eu lu vu dû su bu né ai as au es nu va vs ' +
  'i an at be by do go he if in is it me my no of ok or so to up us we ' +
  'el lo al da di yo mi tu su es ja zu im am um er es du wo').split(' '));
/** Signes que l'OCR tire des illustrations, rares dans un texte. */
const JUNK_SIGNS = /[\^{}|\\~*<>_=+#@[\]¤¦§¬]/;
const VOWEL = /[aeiouyàâäéèêëîïôöùûüÿœæ]/i;
const ROMAN_NUMBER = new RegExp(`^(?=.)${ROMAN}$`, 'i');
/** Ligne d'ornements entre deux scènes (« * * * », « ⁂ ») : gardée. */
const ORNAMENT = /^\s*(?:[*•·◆◇❦⁂]\s*){1,5}$/;

/** Mot reconnu suspect : signes parasites, lettres et chiffres mêlés, casse incohérente, mot court inconnu. */
function suspiciousToken(token: string): boolean {
  if (JUNK_SIGNS.test(token)) return true;
  const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!word) return false; // ponctuation seule (« ? », « — ») : neutre
  if (/^\d+([.,]\d+)?$/.test(word)) return false;
  if (/\p{L}/u.test(word) && /\d/.test(word)) return true;
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  if (/\p{Ll}\p{Lu}/u.test(word) || /\p{Lu}{2,}\p{Ll}/u.test(word)) return true;
  // Chiffre romain en capitales (« IV », « XII ») : pas du bruit.
  if (/^[IVXLCDM]+$/.test(letters) && ROMAN_NUMBER.test(letters)) return false;
  if (letters.length <= 2) return !SHORT_WORDS.has(letters.toLowerCase());
  // Sans voyelle (« Rss », « sl ») : du bruit, sauf sigle en capitales.
  return !VOWEL.test(letters) && letters !== letters.toUpperCase();
}

/**
 * Ligne de bruit d'un livre scanné (illustration, cachet, code-barres lus comme du texte) :
 * presque pas de lettres, ou surtout des « mots » suspects.
 */
export function isOcrJunk(text: string): boolean {
  const chars = text.replace(/\s+/g, '');
  const letters = (chars.match(/\p{L}/gu) ?? []).length;
  if (letters < 2) return !ORNAMENT.test(text);
  if ((letters + (chars.match(/\d/g) ?? []).length) / chars.length < 0.5) return true;
  const tokens = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t) || JUNK_SIGNS.test(t));
  if (!tokens.length) return true;
  const suspicious = tokens.filter(suspiciousToken).length / tokens.length;
  return suspicious >= (tokens.length <= 6 ? 0.5 : 0.4);
}

/** Signes parasites en début ou fin de ligne (« | J'espère », « #1 Dans… ») : retirés. */
const stripJunkEdges = (text: string) => text.replace(/^(?:[\^{}|\\~*<>_=+#@[\]¤¦¬]+\d*\s+)+/, '').replace(/(?:\s+[\^{}|\\~*<>_=+#@[\]¤¦¬]+)+$/, '');

/** Titre plausible : ni adresse web, ni réplique de dialogue ; pour un scan, de vrais mots. */
function plausibleHeading(text: string, ocr: boolean): boolean {
  const t = text.trim();
  if (/https?:\/\/|www\.|@/.test(t) || /^(?:[—–]|-\s)/.test(t)) return false;
  if (!ocr) return true;
  if (isOcrJunk(t) || words(t) > 12 || /[,;]$/.test(t)) return false;
  // Un seul mot sans majuscule (« iwfn ») : du bruit plutôt qu'un titre.
  if (!/\s/.test(t) && !/^[\p{Lu}\d]/u.test(t)) return false;
  const chars = t.replace(/\s+/g, '');
  if ((chars.match(/\p{L}/gu) ?? []).length / chars.length < 0.6) return false;
  return /\p{L}{4,}/u.test(t) || ROMAN_NUMBER.test(t.replace(/[.)]$/, '')) || CHAPTER_WORD.test(t);
}

// ---------- 1. Lignes ----------

function buildLines(page: PdfPageText, index: number, ocr = false): Line[] {
  const lines: Line[] = [];
  let cur: (Line & { space: boolean; last: PdfItem; sizeSum: number; sizeWeight: number }) | null = null;
  const finish = () => {
    if (!cur) return;
    const { space: _s, last: _l, sizeSum, sizeWeight, ...line } = cur;
    // Scan : chaque mot reconnu a sa propre taille ; la ligne prend leur moyenne.
    if (ocr && sizeWeight) line.size = sizeSum / sizeWeight;
    if (lineText(line.spans).trim()) lines.push(line);
    cur = null;
  };
  for (const item of page.items) {
    if (!item.str) continue;
    if (!item.str.trim()) {
      if (cur) cur.space = true;
      continue;
    }
    if (cur) {
      // Texte doublé pour simuler le gras : même chaîne, presque au même endroit.
      if (item.str === cur.last.str && Math.abs(item.x - cur.last.x) < 1.5 && Math.abs(item.y - cur.last.y) < 1.5) continue;
      const dy = item.y - cur.y;
      const tolerance = 0.35 * Math.max(item.size, cur.size);
      const sameLine = Math.abs(dy) <= tolerance;
      const sup = !ocr && !sameLine && item.size < cur.size * 0.8 && dy > 0 && dy < cur.size * 0.8 && item.x >= cur.right - cur.size;
      // Grand écart horizontal : une autre colonne sur la même ligne de base.
      const gutter = item.x - cur.right > Math.max(cur.size, item.size) * 3;
      if ((sameLine || sup) && !gutter && item.x >= cur.x - cur.size) {
        const prev = cur.spans.at(-1)!;
        const dropCapJoin = cur.spans.length === 1 && !!cur.dropCap && cur.size >= item.size * 1.8;
        const isSup = !ocr && !dropCapJoin && (sup || (item.size < cur.size * 0.75 && dy > cur.size * 0.2));
        const gap = item.x - cur.right;
        const needSpace = !isSup && !dropCapJoin && (cur.space || gap > 0.2 * Math.min(item.size, cur.size)) && !/\s$/.test(prev.text) && !/^\s/.test(item.str);
        if (isSup) cur.spans.push({ text: item.str.trim(), sup: true });
        else if (prev.sup) cur.spans.push({ text: needSpace ? ` ${item.str}` : item.str });
        else prev.text += needSpace ? ` ${item.str}` : item.str;
        if (!isSup && (item.size > cur.size || dropCapJoin)) {
          // Lettrine suivie du texte : la ligne prend la taille du texte.
          if (dropCapJoin) {
            cur.size = item.size;
            cur.y = item.y;
            cur.font = item.font;
            cur.dropCap = false;
          } else if (item.str.trim().length > lineText(cur.spans).length / 2) {
            cur.size = item.size;
            cur.font = item.font;
          }
        }
        cur.right = Math.max(cur.right, item.x + item.width);
        cur.space = false;
        cur.last = item;
        if (!isSup) {
          cur.sizeSum += item.size * item.str.trim().length;
          cur.sizeWeight += item.str.trim().length;
        }
        continue;
      }
      finish();
    }
    const single = item.str.trim();
    cur = {
      page: index, spans: [{ text: item.str }], x: item.x, right: item.x + item.width, y: item.y, size: item.size, font: item.font,
      space: false, last: item, sizeSum: item.size * single.length, sizeWeight: single.length,
      ...(single.length === 1 && /\p{Lu}/u.test(single) ? { dropCap: true } : {}),
    };
  }
  finish();
  return lines.map((l) => ({ ...l, spans: l.spans.map((s, i) => (i === 0 ? { ...s, text: s.text.replace(/^\s+/, '') } : s)) }));
}

/** Pages d'une colonne : ordre de haut en bas (les logiciels écrivent parfois les blocs dans le désordre). */
function orderLines(lines: Line[], width: number): Line[] {
  const right = lines.filter((l) => l.x > width * 0.45);
  const left = lines.filter((l) => l.right < width * 0.55);
  const overlap = right.some((r) => left.some((l) => Math.abs(l.y - r.y) < l.size));
  if (right.length >= 3 && left.length >= 3 && overlap) return lines; // plusieurs colonnes : ordre du fichier
  return lines.map((l, i) => ({ l, i })).sort((a, b) => b.l.y - a.l.y || a.i - b.i).map((e) => e.l);
}

/** Scan : lignes de bruit retirées, signes parasites ôtés en début et en fin de ligne. */
function cleanOcrLines(lines: Line[]): Line[] {
  return lines.flatMap((l) => {
    const spans = l.spans.map((sp, i) => {
      let text = sp.text;
      if (i === 0) text = stripJunkEdges(text);
      if (i === l.spans.length - 1) text = stripJunkEdges(text);
      return { ...sp, text };
    });
    const text = lineText(spans).trim();
    // Une majuscule seule (lettrine, numéro de chapitre « V ») est jugée plus loin, d'après sa taille.
    return text && (l.dropCap || !isOcrJunk(text)) ? [{ ...l, spans }] : [];
  });
}

// ---------- 2. Mesures du texte courant ----------

interface Metrics {
  body: number;
  gap: number;
  left: Map<number, number>;
  right: Map<number, number>;
}

function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  let best: number | undefined;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === undefined || n > counts.get(best)! || (n === counts.get(best)! && v < best)) best = v;
  }
  return best;
}

function measure(pages: Line[][], ocr = false): Metrics {
  const weight = new Map<number, number>();
  for (const l of pages.flat()) {
    const k = round(l.size);
    weight.set(k, (weight.get(k) ?? 0) + lineText(l.spans).length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
  const isBody = (l: Line) => Math.abs(l.size - body) <= Math.max(0.6, body * (ocr ? 0.15 : 0.06));
  const gaps: number[] = [];
  const left = new Map<number, number>();
  const right = new Map<number, number>();
  pages.forEach((lines, p) => {
    const bodyLines = lines.filter(isBody);
    for (let i = 1; i < bodyLines.length; i++) {
      const d = bodyLines[i - 1]!.y - bodyLines[i]!.y;
      if (d > body * 0.6 && d < body * 3) gaps.push(round(d, 0.25));
    }
    const xs = bodyLines.map((l) => Math.round(l.x));
    const m = mode(xs);
    if (m !== undefined) left.set(p, xs.filter((x) => x === m).length >= 2 ? m : Math.min(...xs));
    const rights = bodyLines.map((l) => l.right).sort((a, b) => a - b);
    if (rights.length) right.set(p, rights[Math.floor(rights.length * 0.9)] ?? rights.at(-1)!);
  });
  gaps.sort((a, b) => a - b);
  return { body, gap: gaps[Math.floor(gaps.length / 2)] ?? body * 1.25, left, right };
}

// ---------- 3. En-têtes, pieds de page, notes ----------

const furnitureKey = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

function removeFurniture(pages: Line[][], m: Metrics): Line[][] {
  const edges = (lines: Line[]) => {
    const byY = [...lines].sort((a, b) => b.y - a.y);
    return [...byY.slice(0, 2), ...byY.slice(-2)].filter((l, i, all) => all.indexOf(l) === i);
  };
  /** Ligne isolée dans la marge : nettement séparée du texte voisin. */
  const separated = (lines: Line[], l: Line) => {
    const byY = [...lines].sort((a, b) => b.y - a.y);
    const i = byY.indexOf(l);
    const near = [byY[i - 1], byY[i + 1]].filter((n): n is Line => !!n).map((n) => Math.abs(n.y - l.y));
    return !near.length || Math.min(...near) > m.gap * 1.3;
  };
  const seen = new Map<string, Set<number>>();
  pages.forEach((lines, p) => {
    for (const l of edges(lines)) {
      const key = furnitureKey(lineText(l.spans));
      if (key.length > 120) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(p);
    }
  });
  const minRepeat = pages.length <= 6 ? 2 : 3;
  return pages.map((lines) => {
    const candidates = new Set(edges(lines));
    return lines.filter((l) => {
      if (!candidates.has(l) || l.size > m.body * 1.15) return true;
      const text = lineText(l.spans).trim();
      const apart = separated(lines, l);
      // Un nombre seul collé au texte (« 1918. » en fin de phrase) n'est pas un numéro de page.
      if (PAGE_NUMBER.test(text) && apart) return false;
      // Texte répété en haut ou en bas des pages : isolé dans la marge, ou présent sur la moitié des pages.
      // Une note qui se répète (« 3. Ibid. ») n'est un pied de page que si elle revient sur la moitié des pages.
      const repeats = seen.get(furnitureKey(text))?.size ?? 0;
      const half = Math.max(3, pages.length / 2);
      const noteLike = NOTE_START.test(text) && l.size <= m.body * 0.9;
      return !(repeats >= (noteLike ? half : minRepeat) && (apart || repeats >= half));
    });
  });
}

/** Notes de bas de page : petit corps, sous le texte courant, ouvertes par un appel (1, *, †). */
function extractNotes(pages: Line[][], m: Metrics): { pages: Line[][]; notes: Note[] } {
  const notes: Note[] = [];
  const out = pages.map((lines, p) => {
    const body = lines.filter((l) => l.size >= m.body * 0.9);
    if (!body.length) return lines;
    const floor = Math.min(...body.map((l) => l.y));
    const small = lines.filter((l) => l.size <= m.body * 0.85 && l.y < floor);
    const sorted = [...small].sort((a, b) => b.y - a.y);
    if (!sorted.length || !NOTE_START.test(lineText(sorted[0]!.spans).trim())) return lines;
    let current: Note | null = null;
    for (const l of sorted) {
      const text = lineText(l.spans).trim();
      if (NOTE_START.test(text) || !current) {
        current = { page: p, text: text.replace(/^(\d{1,3})(?=\p{Lu})/u, '$1. ') };
        notes.push(current);
      } else current.text = joinText(current.text, text, null);
    }
    const moved = new Set(sorted);
    return lines.filter((l) => !moved.has(l));
  });
  return { pages: out, notes };
}

// ---------- 4. Mots coupés et paragraphes ----------

interface Lexicon {
  plain: Map<string, number>;
  hyphenated: Map<string, number>;
}

function lexicon(pages: Line[][]): Lexicon {
  const plain = new Map<string, number>();
  const hyphenated = new Map<string, number>();
  for (const l of pages.flat()) {
    const text = lineText(l.spans).replace(/[-\u00AD\u2010\u2011]\s*$/, ' ');
    for (const token of text.toLowerCase().match(/[\p{L}]+(?:[-\u2010\u2011][\p{L}]+)*/gu) ?? []) {
      if (/[-\u2010\u2011]/.test(token)) {
        const parts = token.split(/[-\u2010\u2011]/);
        for (let i = 1; i < parts.length; i++) {
          const pair = `${parts[i - 1]}-${parts[i]}`;
          hyphenated.set(pair, (hyphenated.get(pair) ?? 0) + 1);
        }
      } else plain.set(token, (plain.get(token) ?? 0) + 1);
    }
  }
  return { plain, hyphenated };
}

/** Recolle deux lignes d'un même paragraphe, en réparant un mot coupé en fin de ligne. */
function joinText(prev: string, next: string, lex: Lexicon | null): string {
  const a = prev.replace(/\s+$/, '');
  const b = next.replace(/^\s+/, '');
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith('\u00AD')) return a.slice(0, -1) + b;
  if (/[\p{L}\p{N}][-\u2010\u2011]$/u.test(a)) {
    const m = a.match(HYPHEN_END);
    const w2 = b.match(/^[\p{L}]+/u)?.[0];
    // Majuscule ou chiffre après le trait d'union (Jean-Paul, 1914-1918) : il reste, sans espace.
    if (!m || !w2 || !/^\p{Ll}/u.test(b)) return a + b;
    const w1 = m[2]!;
    const compound = /[-\u2010\u2011]/.test(m[1] ?? '');
    const joined = lex?.plain.get(`${w1}${w2}`.toLowerCase()) ?? 0;
    const kept = lex?.hyphenated.get(`${w1}-${w2}`.toLowerCase()) ?? 0;
    const keep = compound || kept > joined || (!joined && !kept && COMPOUND_TAILS.has(w2.toLowerCase()));
    return keep ? a + b : a.slice(0, -1) + b;
  }
  if (/[-–—]$/.test(a) && /^[-–—]/.test(b)) return a + b;
  return `${a} ${b}`;
}

function joinSpans(prev: Span[], next: Span[], lex: Lexicon): Span[] {
  const out = prev.map((s) => ({ ...s }));
  const last = out.at(-1)!;
  const [first, ...rest] = next;
  if (!first) return out;
  if (last.sup || first.sup) {
    if (!/\s$/.test(last.text) && !/^\s/.test(first.text)) out.push({ text: ' ' });
    return [...out, { ...first }, ...rest.map((s) => ({ ...s }))];
  }
  last.text = joinText(last.text, first.text, lex);
  return [...out, ...rest.map((s) => ({ ...s }))];
}

/** Titre reconnu à sa formulation (« Chapitre 3 », « Épilogue »), seul sur sa ligne. */
function chapterPattern(text: string): boolean {
  return text.length <= 70 && CHAPTER_WORD.test(text) && !TOC_LINE.test(text) && !/\s\d{1,4}$/.test(text.replace(/^\S+\s+\S+/, '')) && !SENTENCE_END.test(text.replace(/[.»"”’)\]]$/, '')) && words(text) <= 10;
}

/** Ligne centrée (titre, citation, astérisques) : autant de blanc des deux côtés, bien plus qu'un alinéa. */
function isCentered(l: Line, m: Metrics, width: number): boolean {
  const left = m.left.get(l.page) ?? 0;
  const right = m.right.get(l.page) ?? width - left;
  const leftGap = l.x - left;
  const rightGap = right - l.right;
  return leftGap > m.body * 2 && rightGap > m.body * 2 && Math.abs(leftGap - rightGap) < Math.max(m.body, (right - left) * 0.08);
}

function startsParagraph(a: Line, b: Line, m: Metrics, width: number, ocr = false, verse = false): boolean {
  // Un appel de note en fin de ligne ne compte pas : « …consolide.¹ » finit bien une phrase.
  const textA = lineText(a.spans.filter((s) => !s.sup)).trim();
  const textB = lineText(b.spans).trim();
  // Mot coupé en fin de ligne et suite en minuscule : le paragraphe continue. Sur un scan (lignes
  // un peu penchées, marges et écarts irréguliers), une ligne qui commence en minuscule aussi.
  const cut = /\p{L}[-\u00AD\u2010\u2011]$/u.test(textA) && /^\p{Ll}/u.test(textB);
  if (cut || (ocr && /^\p{Ll}/u.test(textB))) return false;
  // Changement de corps ; sur un scan, la taille reconnue varie d'une ligne à l'autre : seul un net écart compte.
  if (ocr ? Math.abs(a.size - b.size) > 0.25 * Math.min(a.size, b.size) : Math.abs(round(a.size) - round(b.size)) >= 1) return true;
  if (a.page === b.page && a.y > b.y && a.y - b.y > m.gap * 1.45) return true;
  if (BULLET.test(textB) || SCENE_BREAK.test(textB) || SCENE_BREAK.test(textA) || TOC_LINE.test(textA)) return true;
  if (isCentered(a, m, width) || isCentered(b, m, width)) return true;
  const indent = m.body * 0.6;
  const indentA = a.x - (m.left.get(a.page) ?? a.x) > indent;
  const indentB = b.x - (m.left.get(b.page) ?? b.x) > indent;
  // Dans un poème, des vers en retrait (rimes, refrains) ne commencent pas un paragraphe ; une
  // phrase finie ferme la strophe (les vers ont tous à peu près la même longueur).
  if (indentB && !indentA && !verse) return true;
  const left = m.left.get(a.page) ?? a.x;
  const right = m.right.get(a.page) ?? a.right;
  const short = a.right < right - (right - left) * 0.12;
  // Ligne courte qui a la forme d'un titre (« Chapitre premier ») : le texte suivant n'en fait pas partie.
  if ((short || verse) && chapterPattern(textA)) return true;
  if (verse) return SENTENCE_END.test(textA);
  return short && SENTENCE_END.test(textA);
}

/**
 * Page en vers (poèmes, fables, pièces en vers) : des lignes courtes qui, presque toutes,
 * commencent par une majuscule. Leurs retours à la ligne sont gardés.
 */
function isVersePage(lines: Line[], m: Metrics): boolean {
  const kept = lines.filter((l) => (lineText(l.spans).match(/\p{L}/gu) ?? []).length >= 3);
  if (kept.length < 8) return false;
  const texts = kept.map((l) => lineText(l.spans).trim());
  const capital = texts.filter((t) => /^[«"“—–-]?\s*\p{Lu}/u.test(t)).length;
  const lengths = texts.map((t) => t.length).sort((x, y) => x - y);
  // Des fins de ligne irrégulières : la prose justifiée, elle, finit au même bord.
  const right = m.right.get(kept[0]!.page);
  const aligned = right === undefined ? 0 : kept.filter((l) => Math.abs(l.right - right) < m.body * 0.5).length / kept.length;
  return capital / texts.length >= 0.8 && (lengths[Math.floor(lengths.length / 2)] ?? Infinity) <= 60 && aligned < 0.4;
}

// ---------- 5. Blocs : titres et paragraphes ----------

/**
 * Garde-fou : sans aucun indice de paragraphe (texte sans alinéa ni espace), on coupe après une
 * phrase au-delà de 300 mots, et coûte que coûte au-delà de 1 500 : un chapitre doit rester découpable.
 */
function tooLong(block: Block, prev: Line): boolean {
  const n = words(lineText(block.spans));
  return n > 1500 || (n > 300 && SENTENCE_END.test(lineText(prev.spans).trim()));
}

function buildBlocks(pages: Line[][], m: Metrics, widths: number[], lex: Lexicon, ocr = false): Block[] {
  const blocks: Block[] = [];
  const verse = new Set(pages.flatMap((lines, p) => (isVersePage(lines, m) ? [p] : [])));
  let prev: Line | null = null;
  let dropCap: Line | null = null;
  const place = (line: Line) => {
    const text = lineText(line.spans).trim();
    const heading = line.size >= m.body * (ocr ? 1.25 : 1.15) && text.length <= 200 && plausibleHeading(text, ocr);
    const last = blocks.at(-1);
    if (heading) {
      // Titre sur plusieurs lignes : même corps, lignes rapprochées.
      const sameSize = Math.abs((last?.size ?? 0) - line.size) < (ocr ? line.size * 0.15 : 0.6);
      if (last?.kind === 'h' && prev && last.page === line.page && sameSize && prev.y - line.y <= line.size * 1.9) {
        last.spans = joinSpans(last.spans, line.spans, lex);
      } else blocks.push({ kind: 'h', page: line.page, y: line.y, size: line.size, spans: line.spans.map((s) => ({ ...s })) });
    } else if (last?.kind === 'p' && prev && !startsParagraph(prev, line, m, widths[line.page] ?? 0, ocr, verse.has(prev.page) && verse.has(line.page)) && !tooLong(last, prev)) {
      // Vers suivant (majuscule en tête) : retour à la ligne gardé ; sinon la ligne continue la phrase.
      const newVerse = verse.has(prev.page) && verse.has(line.page) && /^[«"“—–-]?\s*\p{Lu}/u.test(text) && !/[-\u00AD\u2010\u2011]$/.test(lineText(prev.spans).trim());
      last.spans = newVerse ? [...last.spans, { text: ' ', br: true }, ...line.spans.map((sp) => ({ ...sp }))] : joinSpans(last.spans, line.spans, lex);
    } else {
      blocks.push({ kind: 'p', page: line.page, y: line.y, size: line.size, spans: line.spans.map((s) => ({ ...s })) });
    }
    prev = line;
  };
  for (const lines of pages) {
    for (const line of lines) {
      const text = lineText(line.spans).trim();
      // Scan : une lettre seule de taille ordinaire est du bruit.
      if (ocr && text.length === 1 && line.size < m.body * 1.8) continue;
      if (line.dropCap && text.length === 1 && line.size >= m.body * 1.8) {
        if (dropCap && (!ocr || plausibleHeading(lineText(dropCap.spans), true))) place(dropCap);
        dropCap = line;
        continue;
      }
      if (dropCap) {
        // Lettrine : le reste du mot suit à sa droite, à sa hauteur. Sinon, c'est une grande lettre
        // seule (numéro de chapitre « I », « V »…), qui reste un titre.
        const dc = dropCap;
        dropCap = null;
        const besides = line.page === dc.page && line.x >= dc.right - dc.size * 0.3 && line.y <= dc.y + dc.size * 1.1 && line.y >= dc.y - dc.size * 0.6;
        if (besides) line.spans[0] = { ...line.spans[0]!, text: lineText(dc.spans).trim() + line.spans[0]!.text.replace(/^\s+/, '') };
        else if (!ocr || plausibleHeading(lineText(dc.spans), true)) place(dc);
      }
      place(line);
    }
  }
  if (dropCap && (!ocr || plausibleHeading(lineText(dropCap.spans), true))) place(dropCap);
  // Titres reconnus à leur formulation : « Chapitre 3 », « Prologue »… seuls sur leur ligne.
  for (const b of blocks) {
    if (b.kind === 'p' && chapterPattern(lineText(b.spans).trim())) {
      b.kind = 'h';
      b.pattern = true;
    }
  }
  return blocks;
}

/**
 * Scan : la taille reconnue d'un même style de titre varie d'un titre à l'autre (14,4 ; 15,3 ;
 * 16,9…). Les tailles sont réunies de proche en proche (moins de 20 % d'écart avec la précédente),
 * pour que les chapitres se reconnaissent à leur style commun ; un style bien plus grand reste à part.
 */
function clusterHeadingSizes(blocks: Block[]): void {
  const heads = blocks.filter((b) => b.kind === 'h' && !b.pattern).sort((a, b) => a.size - b.size);
  let group: Block[] = [];
  const close = () => {
    const sizes = group.map((b) => b.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    for (const b of group) b.size = median;
    group = [];
  };
  for (const b of heads) {
    if (group.length && b.size > group.at(-1)!.size * 1.2) close();
    group.push(b);
  }
  if (group.length) close();
}

interface HeadingPlan {
  /** Taille des titres qui ouvrent les chapitres (null : aucune). */
  chapterSize: number | null;
  /** Tailles « de structure » : des titres différents, sur plusieurs pages. */
  structural: Set<number>;
}

/**
 * Tailles de titres classées. Une taille compte pour la structure si elle porte, sur plusieurs
 * pages, au moins deux titres qui ne se répètent pas (le titre du livre répété sur la couverture
 * et la page de titre n'en est pas une). Comme pour les signets, on descend d'une taille tant que
 * les titres retenus sont moins de trois (deux parties, puis leurs chapitres).
 */
function rankHeadings(blocks: Block[], bookTitle = ''): HeadingPlan {
  // Pages du début sans aucun texte courant (couverture, page de titre, faux-titre), et le titre
  // du livre lui-même : ils ne disent rien de la structure du livre.
  const front = blocks.find((b) => b.kind === 'p')?.page ?? 0;
  const sized = blocks.filter((b) => b.kind === 'h' && !b.pattern && b.page >= front && !isBookTitle(b, bookTitle));
  const sizes = [...new Set(sized.map((b) => round(b.size)))].sort((a, b) => b - a);
  const structural = new Set(sizes.filter((size) => {
    const at = sized.filter((b) => round(b.size) === size);
    // Des titres qui ne se répètent pas : le titre du livre (couverture, page de titre, faux-titre)
    // et le nom de l'auteur à côté ne font pas une structure.
    const counts = new Map<string, number>();
    for (const b of at) counts.set(normalizeTitle(lineText(b.spans)), (counts.get(normalizeTitle(lineText(b.spans))) ?? 0) + 1);
    const unique = at.filter((b) => counts.get(normalizeTitle(lineText(b.spans))) === 1);
    return new Set(unique.map((b) => b.page)).size >= 2 && unique.length >= 2;
  }));
  let chapterSize: number | null = null;
  let count = 0;
  for (const size of sizes) {
    if (!structural.has(size)) continue;
    count += sized.filter((b) => round(b.size) === size).length;
    chapterSize = size;
    if (count >= 3) break;
  }
  const below = sizes.filter((s) => chapterSize === null || s < chapterSize);
  for (const b of blocks) {
    if (b.kind !== 'h') continue;
    if (b.pattern) b.level = chapterSize === null ? 2 : 3;
    else if (chapterSize !== null && round(b.size) >= chapterSize) b.level = 2;
    else b.level = Math.min(4, 3 + Math.max(0, below.indexOf(round(b.size))));
  }
  return { chapterSize, structural };
}

// ---------- 6. Chapitres ----------

const normalizeTitle = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, '');
/** Le titre du livre (page de titre, couverture) : jamais un chapitre. */
const isBookTitle = (b: Block, bookTitle: string) => !!bookTitle && normalizeTitle(lineText(b.spans)) === normalizeTitle(bookTitle);

function blockHtml(b: Block): string {
  // Après un retour à la ligne, une espace (invisible en début de ligne) sépare les mots du texte
  // lu par la recherche, les surlignages et la voix.
  const inner = b.spans.map((s) => (s.br ? '<br>' : s.sup ? `<sup>${escapeHtml(s.text)}</sup>` : escapeHtml(s.text))).join('').replace(/\s+/g, ' ').replace(/ ?<br> ?/g, '<br> ').trim();
  if (!inner) return '';
  if (b.kind === 'h') return `<h${b.level ?? 3}>${inner}</h${b.level ?? 3}>`;
  return `<p>${inner}</p>`;
}

interface Section {
  label: string;
  start: number;
  depth?: number;
}

function outlineSections(blocks: Block[], outline: PdfOutlineEntry[]): Section[] | null {
  const usable = outline.filter((e) => e.title.trim() && e.page >= 0);
  if (usable.length < 2) return null;
  const maxLevel = Math.max(...usable.map((e) => e.level));
  let level = 0;
  while (level < maxLevel && usable.filter((e) => e.level <= level).length < 3) level++;
  const chosen = usable.filter((e) => e.level <= level);
  const sections: (Section & { level: number })[] = [];
  let floor = 0;
  for (const e of chosen) {
    let start = blocks.findIndex((b) => b.page > e.page || (b.page === e.page && (e.y === null || b.y <= e.y + 1)));
    if (start < 0) start = blocks.length;
    // La destination tombe parfois juste à côté du titre : on se cale sur le titre voisin qui
    // correspond le mieux (identique de préférence ; « Chapitre 1 » ne vaut pas « Chapitre 10 »),
    // sans jamais reculer sur la section précédente.
    const title = normalizeTitle(e.title);
    const lowest = sections.length ? floor + 1 : 0;
    let best = -1;
    let bestScore = 0;
    for (let k = Math.max(lowest, start - 2); k <= Math.min(blocks.length - 1, start + 2); k++) {
      const b = blocks[k]!;
      const t = normalizeTitle(lineText(b.spans));
      if (b.kind !== 'h' || !t) continue;
      const prefix = (long: string, short: string) => long.startsWith(short) && !/^\d/.test(long.slice(short.length));
      const score = t === title ? 2 : prefix(title, t) || prefix(t, title) ? 1 : 0;
      if (score > bestScore || (score && score === bestScore && Math.abs(k - start) < Math.abs(best - start))) {
        best = k;
        bestScore = score;
      }
    }
    if (best >= 0) start = best;
    start = Math.max(start, floor);
    floor = start;
    sections.push({ label: e.title.replace(/\s+/g, ' ').trim().slice(0, 120), start, level: e.level });
  }
  // Une section sans texte (signet de partie posé au même endroit que son premier chapitre) disparaît.
  const kept = sections.filter((s, i) => (sections[i + 1]?.start ?? blocks.length) > s.start);
  const lower = kept.some((s) => s.level < level);
  return kept.map((s) => ({ label: s.label, start: s.start, ...(lower && s.level === level && level > 0 ? { depth: 1 } : {}) }));
}

function headingSections(blocks: Block[], plan: HeadingPlan, ocr = false, bookTitle = ''): Section[] | null {
  const { chapterSize, structural } = plan;
  // Scan : un titre de chapitre dont la taille reconnue s'écarte (jusqu'à un quart de plus) reste un chapitre.
  const sameLevel = (b: Block) => chapterSize !== null && (ocr ? b.size <= chapterSize * 1.25 : round(b.size) === chapterSize);
  const starts = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.kind === 'h' && !isBookTitle(b, bookTitle) && (chapterSize !== null ? !b.pattern && round(b.size) >= chapterSize && (structural.has(round(b.size)) || (ocr && sameLevel(b))) : b.pattern));
  if (starts.length < 2) return null;
  // Des parties (titres plus grands) : leurs chapitres sont décalés dans le sommaire.
  const parts = chapterSize !== null && starts.some(({ b }) => round(b.size) > chapterSize && !sameLevel(b));
  const sections = starts.map(({ b, i }) => ({
    label: lineText(b.spans).replace(/\s+/g, ' ').trim().slice(0, 120),
    start: i,
    ...(parts && sameLevel(b) ? { depth: 1 } : {}),
  }));
  // Trop de « chapitres » minuscules (diapositives, fiches) : le découpage par pages vaut mieux.
  const total = blocks.reduce((n, b) => n + words(lineText(b.spans)), 0);
  if (sections.length > 20 && total / sections.length < 120) return null;
  return sections;
}

/** Sans signets ni titres : des tranches d'environ PDF_CHUNK_WORDS mots, coupées entre deux pages. */
function pageSections(blocks: Block[], title: string): Section[] {
  const total = blocks.reduce((n, b) => n + words(lineText(b.spans)), 0);
  if (total <= PDF_CHUNK_WORDS * 1.5) return [{ label: title, start: 0 }];
  const sections: Section[] = [];
  let acc = 0;
  blocks.forEach((b, i) => {
    if (!sections.length || (acc >= PDF_CHUNK_WORDS && b.page > blocks[i - 1]!.page)) {
      sections.push({ label: '', start: i });
      acc = 0;
    }
    acc += words(lineText(b.spans));
  });
  return sections.map((s, k) => {
    const first = blocks[s.start]!.page + 1;
    const last = blocks[(sections[k + 1]?.start ?? blocks.length) - 1]!.page + 1;
    return { ...s, label: first === last ? `Page ${first}` : `Pages ${first} à ${last}` };
  });
}

export interface PdfConversion {
  chapters: Chapter[];
  /** Nombre de mots du texte retenu (0 : PDF sans texte, par exemple scanné). */
  words: number;
  /** Comment les chapitres ont été trouvés. */
  structure: 'outline' | 'headings' | 'pages';
}

export function convertPdfText(pages: PdfPageText[], outline: PdfOutlineEntry[], title: string, options: ConvertOptions = {}): PdfConversion {
  const ocr = options.ocr === true;
  const raw = pages.map((p, i) => {
    const lines = orderLines(buildLines(p, i, ocr), p.width);
    return ocr ? cleanOcrLines(lines) : lines;
  });
  const metrics = measure(raw, ocr);
  const cleaned = removeFurniture(raw, metrics);
  const { pages: flow, notes } = extractNotes(cleaned, metrics);
  const lex = lexicon(flow);
  const blocks = buildBlocks(flow, metrics, pages.map((p) => p.width), lex, ocr).filter((b) => lineText(b.spans).trim());
  if (ocr) clusterHeadingSizes(blocks);
  const plan = rankHeadings(blocks, title);
  const total = blocks.reduce((n, b) => n + words(lineText(b.spans)), 0);
  if (!blocks.length) return { chapters: [], words: 0, structure: 'pages' };

  let structure: PdfConversion['structure'] = 'outline';
  let sections = outlineSections(blocks, outline);
  if (!sections) {
    structure = 'headings';
    sections = headingSections(blocks, plan, ocr, title);
  }
  if (!sections) {
    structure = 'pages';
    sections = pageSections(blocks, title);
  }
  if (sections[0]!.start > 0) sections.unshift({ label: FRONT_LABEL, start: 0 });

  // Chaque note rejoint le chapitre où se trouve la page qui l'appelle.
  const chapterOfPage = (page: number) => {
    let found = 0;
    sections!.forEach((s, k) => {
      const b = blocks[s.start];
      if (b && b.page <= page) found = k;
    });
    return found;
  };
  const notesBy = new Map<number, Note[]>();
  for (const n of notes) {
    const k = chapterOfPage(n.page);
    notesBy.set(k, [...(notesBy.get(k) ?? []), n]);
  }

  const chapters: Chapter[] = [];
  sections.forEach((s, k) => {
    const end = sections![k + 1]?.start ?? blocks.length;
    const html = blocks.slice(s.start, end).map(blockHtml).filter(Boolean).join('\n');
    const chapterNotes = notesBy.get(k) ?? [];
    const notesHtml = chapterNotes.length ? `\n<section role="doc-endnotes" aria-label="Notes">${chapterNotes.map((n) => `<p>${escapeHtml(n.text.replace(/\s+/g, ' ').trim())}</p>`).join('')}</section>` : '';
    if (!html && !notesHtml) return;
    chapters.push({ label: s.label || title, html: html + notesHtml, ...(s.depth ? { depth: s.depth } : {}) });
  });
  return { chapters, words: total, structure };
}

/** Part de caractères illisibles (zone privée Unicode, caractères de contrôle) : polices sans table de correspondance. */
export function unreadableRatio(text: string): number {
  let bad = 0;
  let all = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    all++;
    const c = ch.codePointAt(0)!;
    if ((c >= 0xe000 && c <= 0xf8ff) || c === 0xfffd || c < 0x20) bad++;
  }
  return all ? bad / all : 0;
}
