import { createHash } from 'node:crypto';

// Petits PDF de test, écrits à la main : polices standard (sans incorporation), texte placé
// ligne par ligne comme le font les logiciels de mise en page, sommaire (signets), en-têtes
// courants, numéros de page, notes de bas de page, pages « scannées » (image seule), PDF
// protégé par mot de passe (chiffrement standard RC4 40 bits) ou par un DRM inconnu.

export type PdfFont = 'serif' | 'serif-bold' | 'serif-italic' | 'sans';
const FONTS: Record<PdfFont, [string, string]> = {
  serif: ['F1', 'Times-Roman'],
  'serif-bold': ['F2', 'Times-Bold'],
  'serif-italic': ['F3', 'Times-Italic'],
  sans: ['F4', 'Helvetica'],
};

export interface PdfRun { text: string; x: number; y: number; size: number; font?: PdfFont }
export interface PdfPage { runs: PdfRun[]; image?: boolean }
export interface PdfOutlineItem { title: string; page: number; y?: number; children?: PdfOutlineItem[] }
export interface PdfSpec {
  pages: PdfPage[];
  width?: number;
  height?: number;
  title?: string;
  author?: string;
  outline?: PdfOutlineItem[];
  /** Mot de passe d'ouverture (gestionnaire standard, RC4 40 bits). */
  userPassword?: string;
  /** Chiffrement par un gestionnaire propriétaire (DRM Adobe ADEPT simulé). */
  drm?: boolean;
}

// ---------- Encodage ----------

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function winAnsi(text: string): number[] {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    const b = WIN_ANSI_EXTRA[ch];
    if (b === undefined) throw new Error(`caractère non encodable en WinAnsi : ${ch}`);
    return b;
  });
}

function literal(bytes: number[]): string {
  return `(${bytes.map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 0x20 || b > 0x7e ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('')})`;
}

const hex = (bytes: Uint8Array | number[]) => `<${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}>`;

/** Chaîne de texte de document (titres, signets) : UTF-16BE avec marque d'ordre. */
function textString(text: string): number[] {
  const out = [0xfe, 0xff];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out.push(c >> 8, c & 0xff);
  }
  return out;
}

// ---------- Chiffrement standard (PDF 1.7, 7.6.3, révision 2) ----------

const PAD = [0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a];
const md5 = (...parts: (Uint8Array | number[])[]) => new Uint8Array(createHash('md5').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest());

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

const padded = (password: string) => [...Buffer.from(password, 'latin1'), ...PAD].slice(0, 32);

interface Crypt { o: Uint8Array; u: Uint8Array; key: Uint8Array }

function standardSecurity(user: string, owner: string, id: Uint8Array, p: number): Crypt {
  const o = rc4(md5(padded(owner)).slice(0, 5), Uint8Array.from(padded(user)));
  const pBytes = [p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff, (p >>> 24) & 0xff];
  const key = md5(padded(user), o, pBytes, id).slice(0, 5);
  return { o, u: rc4(key, Uint8Array.from(PAD)), key };
}

function objectKey(key: Uint8Array, num: number): Uint8Array {
  return md5(key, [num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, 0, 0]).slice(0, Math.min(key.length + 5, 16));
}

// ---------- Écriture ----------

export function makePdf(spec: PdfSpec): Uint8Array {
  const width = spec.width ?? 420;
  const height = spec.height ?? 595;
  const id = md5(Buffer.from(JSON.stringify(spec.pages.length) + (spec.title ?? '') + (spec.userPassword ?? '')));
  const crypt = spec.userPassword !== undefined ? standardSecurity(spec.userPassword, `${spec.userPassword}-proprietaire`, id, -4) : null;

  // Numéros des objets.
  let next = 1;
  const catalogNum = next++;
  const pagesNum = next++;
  const fontNums = Object.fromEntries(Object.keys(FONTS).map((f) => [f, next++])) as Record<PdfFont, number>;
  const imageNum = next++;
  const pageNums = spec.pages.map(() => [next++, next++] as const);
  const infoNum = next++;
  const flat: { item: PdfOutlineItem; num: number; parent: number; prev?: number; next?: number; first?: number; last?: number; count: number }[] = [];
  const outlineRoot = spec.outline?.length ? next++ : 0;
  const place = (items: PdfOutlineItem[], parent: number): number[] => {
    const nums = items.map(() => next++);
    items.forEach((item, i) => {
      const entry = { item, num: nums[i]!, parent, prev: nums[i - 1], next: nums[i + 1], count: 0 } as (typeof flat)[number];
      flat.push(entry);
      if (item.children?.length) {
        const kids = place(item.children, nums[i]!);
        entry.first = kids[0];
        entry.last = kids.at(-1);
        entry.count = kids.length;
      }
    });
    return nums;
  };
  const topNums = spec.outline?.length ? place(spec.outline, outlineRoot) : [];
  const encryptNum = crypt || spec.drm ? next++ : 0;

  const objects = new Map<number, Uint8Array>();
  const enc = (num: number, bytes: number[] | Uint8Array) => (crypt ? rc4(objectKey(crypt.key, num), Uint8Array.from(bytes)) : Uint8Array.from(bytes));
  const str = (num: number, bytes: number[]) => (crypt ? hex(enc(num, bytes)) : hex(bytes));
  const put = (num: number, body: string) => objects.set(num, Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1'));
  const putStream = (num: number, dict: string, data: Uint8Array) => {
    const payload = enc(num, data);
    objects.set(num, Buffer.concat([Buffer.from(`${num} 0 obj\n<< ${dict} /Length ${payload.length} >>\nstream\n`, 'latin1'), Buffer.from(payload), Buffer.from('\nendstream\nendobj\n', 'latin1')]));
  };

  put(catalogNum, `<< /Type /Catalog /Pages ${pagesNum} 0 R${outlineRoot ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''} >>`);
  put(pagesNum, `<< /Type /Pages /Kids [${pageNums.map(([p]) => `${p} 0 R`).join(' ')}] /Count ${spec.pages.length} >>`);
  for (const [font, [, base]] of Object.entries(FONTS) as [PdfFont, [string, string]][]) put(fontNums[font], `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  // Image 2 × 2 en niveaux de gris : la « photo » d'une page scannée.
  putStream(imageNum, '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8', Uint8Array.from([0x20, 0xe0, 0xe0, 0x20]));
  const fontRes = Object.entries(FONTS).map(([font, [name]]) => `/${name} ${fontNums[font as PdfFont]} 0 R`).join(' ');
  spec.pages.forEach((page, i) => {
    const [pageNum, contentNum] = pageNums[i]!;
    put(pageNum, `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << ${fontRes} >> /XObject << /Im1 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);
    const ops: string[] = [];
    if (page.image) ops.push(`q ${width - 60} 0 0 ${height - 60} 30 30 cm /Im1 Do Q`);
    for (const run of page.runs) ops.push(`BT /${FONTS[run.font ?? 'serif'][0]} ${run.size} Tf 1 0 0 1 ${run.x.toFixed(2)} ${run.y.toFixed(2)} Tm ${literal(winAnsi(run.text))} Tj ET`);
    putStream(contentNum, '', Buffer.from(ops.join('\n'), 'latin1'));
  });
  put(infoNum, `<< ${spec.title ? `/Title ${str(infoNum, textString(spec.title))} ` : ''}${spec.author ? `/Author ${str(infoNum, textString(spec.author))} ` : ''}/Producer ${str(infoNum, textString('Liseuse tests'))} >>`);
  if (outlineRoot) put(outlineRoot, `<< /Type /Outlines /First ${topNums[0]} 0 R /Last ${topNums.at(-1)} 0 R /Count ${topNums.length} >>`);
  for (const e of flat) {
    const dest = `[${pageNums[e.item.page]![0]} 0 R /XYZ 0 ${e.item.y ?? height} 0]`;
    put(e.num, `<< /Title ${str(e.num, textString(e.item.title))} /Parent ${e.parent} 0 R${e.prev ? ` /Prev ${e.prev} 0 R` : ''}${e.next ? ` /Next ${e.next} 0 R` : ''}${e.first ? ` /First ${e.first} 0 R /Last ${e.last} 0 R /Count ${e.count}` : ''} /Dest ${dest} >>`);
  }
  if (crypt) put(encryptNum, `<< /Filter /Standard /V 1 /R 2 /Length 40 /O ${hex(crypt.o)} /U ${hex(crypt.u)} /P -4 >>`);
  else if (spec.drm) put(encryptNum, '<< /Filter /EBX_HANDLER /SubFilter /ADBE_PKCS7 /V 4 /R 4 /Length 128 /ADEPT_LICENSE (licence-factice) >>');

  const chunks: Uint8Array[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let pos = chunks[0]!.length;
  for (let n = 1; n < next; n++) {
    const obj = objects.get(n)!;
    offsets[n] = pos;
    chunks.push(obj);
    pos += obj.length;
  }
  const xref = [`xref\n0 ${next}\n0000000000 65535 f \n`, ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  const trailer = `trailer\n<< /Size ${next} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R${encryptNum ? ` /Encrypt ${encryptNum} 0 R` : ''} /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

// ---------- Mise en page d'un livre ----------

export interface BookChapter {
  title: string;
  /** Paragraphe en une chaîne (coupé automatiquement), ou lignes imposées. */
  paragraphs: (string | string[])[];
  /** Note de bas de page appelée à la fin de la première ligne du chapitre qui finit par un mot entier. */
  footnote?: string;
}

export interface BookSpec {
  title: string;
  author: string;
  chapters: BookChapter[];
  /** Signets du PDF (sommaire). */
  outline?: boolean;
  /** En-tête courant (titre du livre) et numéro de page. */
  furniture?: boolean;
  /** Titres de chapitre plus grands que le texte (sinon même taille, en gras). */
  bigHeadings?: boolean;
  /** Sans page de titre ni titres de chapitre : le texte court de page en page. */
  plain?: boolean;
  /** Couverture illustrée (une image pleine page) en première page. */
  coverImage?: boolean;
  userPassword?: string;
}

const LEFT = 50;
const TEXT_WIDTH = 320;
const BODY = 11;
const LEADING = 14;
const INDENT = 15;
/** Largeur moyenne d'un caractère en Times (approximation suffisante pour couper les lignes). */
const charWidth = (size: number) => size * 0.46;

/** Coupe un paragraphe en lignes ; un mot long qui déborde est coupé avec un trait d'union. */
export function wrapText(text: string, firstIndent = INDENT): string[] {
  const lines: string[] = [];
  let line = '';
  let limit = Math.floor((TEXT_WIDTH - firstIndent) / charWidth(BODY));
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= limit) {
      line = candidate;
      continue;
    }
    const room = limit - line.length - 2;
    if (word.length >= 9 && room >= 4 && /^[\p{L}]+$/u.test(word.slice(0, room))) {
      lines.push(`${line} ${word.slice(0, room)}-`);
      line = word.slice(room);
    } else {
      lines.push(line);
      line = word;
    }
    limit = Math.floor(TEXT_WIDTH / charWidth(BODY));
  }
  if (line) lines.push(line);
  return lines;
}

export function typesetBook(spec: BookSpec): PdfSpec {
  const pages: PdfPage[] = [];
  const outline: PdfOutlineItem[] = [];
  const center = (text: string, size: number) => LEFT + (TEXT_WIDTH - text.length * charWidth(size)) / 2;
  if (spec.coverImage) pages.push({ runs: [], image: true });
  // Page de titre.
  if (!spec.plain) {
    pages.push({ runs: [
      { text: spec.title, x: center(spec.title, 22), y: 400, size: 22, font: 'serif-bold' },
      { text: spec.author, x: center(spec.author, 13), y: 360, size: 13 },
    ] });
  }
  let page: PdfPage;
  let y = 0;
  let first = true;
  const newPage = () => {
    page = { runs: [] };
    pages.push(page);
    y = 520;
    if (spec.furniture) {
      if (!first) page.runs.push({ text: spec.title, x: center(spec.title, 8), y: 560, size: 8, font: 'serif-italic' });
      const n = String(pages.length);
      page.runs.push({ text: n, x: center(n, 9), y: 35, size: 9 });
    }
    first = false;
  };
  for (const chapter of spec.chapters) {
    if (spec.plain) {
      if (!pages.length || spec.chapters.indexOf(chapter) === 0) newPage();
    } else {
      first = true;
      newPage();
      const headingSize = spec.bigHeadings === false ? BODY : 18;
      y = 470;
      page!.runs.push({ text: chapter.title, x: LEFT, y, size: headingSize, font: 'serif-bold' });
      outline.push({ title: chapter.title, page: pages.length - 1, y: y + headingSize });
      y -= headingSize * 2.2;
    }
    let noteDone = !chapter.footnote;
    for (const paragraph of chapter.paragraphs) {
      const lines = Array.isArray(paragraph) ? paragraph : wrapText(paragraph);
      lines.forEach((text, i) => {
        if (y < 85) newPage();
        const x = LEFT + (i === 0 ? INDENT : 0);
        page!.runs.push({ text, x, y, size: BODY });
        if (!noteDone && !/-$/.test(text)) {
          // Appel de note en exposant, puis la note en bas de la même page.
          page!.runs.push({ text: '1', x: x + text.length * charWidth(BODY) + 1, y: y + 4, size: 7 });
          page!.runs.push({ text: `1. ${chapter.footnote!}`, x: LEFT, y: 58, size: 8 });
          noteDone = true;
        }
        y -= LEADING;
      });
    }
  }
  return {
    pages,
    title: spec.title,
    author: spec.author,
    ...(spec.outline ? { outline } : {}),
    ...(spec.userPassword !== undefined ? { userPassword: spec.userPassword } : {}),
  };
}

/** Texte de remplissage déterministe (pour les longs livres). */
export function filler(words: number, seed = 1): string {
  const vocab = ['le', 'sommeil', 'consolide', 'la', 'mémoire', 'des', 'souvenirs', 'chaque', 'nuit', 'cerveau', 'trie', 'ce', 'qui', 'compte', 'et', 'oublie', 'reste', 'pendant', 'rêve', 'apprend', 'mieux', 'après', 'une', 'bonne', 'journée'];
  let s = seed;
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(vocab[s % vocab.length]!);
  }
  return `${out.join(' ')}.`;
}
