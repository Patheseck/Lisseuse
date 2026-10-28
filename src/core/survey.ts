// Aperçu d'un chapitre avant lecture (balayage) : les repères visuels qui annoncent
// ses idées principales. Sert à formuler une question directrice.

export interface ChapterSurvey {
  headings: string[];
  bold: string[];
  italic: string[];
  lists: string[];
  figures: string[];
  /** Nombre d'images et de tableaux. */
  figureCount: number;
}

const MAX_ITEMS = 12;
const MAX_TERM = 80;

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[], max = MAX_ITEMS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v.length > MAX_TERM ? `${v.slice(0, MAX_TERM)}…` : v);
    if (out.length >= max) break;
  }
  return out;
}

export function surveyChapter(html: string): ChapterSurvey {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  const texts = (selector: string) => Array.from(root.querySelectorAll(selector), (el) => clean(el.textContent));
  // Le titre du chapitre (premier h1) est déjà affiché : on garde les intertitres.
  const headings = unique(texts('h2, h3, h4'));
  // Gras et italique : des termes, pas des paragraphes entiers mis en forme.
  const short = (v: string) => v.length >= 2 && v.split(' ').length <= 10;
  const bold = unique(texts('strong, b').filter(short));
  const boldSet = new Set(bold.map((b) => b.toLowerCase()));
  const italic = unique(texts('em, i').filter((v) => short(v) && !boldSet.has(v.toLowerCase())));
  const lists = unique(texts('li').filter((v) => v.length > 0), 8);
  const figures = unique([...texts('figcaption'), ...texts('caption'), ...Array.from(root.querySelectorAll('img[alt]'), (img) => clean(img.getAttribute('alt')))].filter((v) => v.length > 2), 6);
  const figureCount = root.querySelectorAll('img, table').length;
  return { headings, bold, italic, lists, figures, figureCount };
}

export function surveyIsEmpty(s: ChapterSurvey): boolean {
  return !s.headings.length && !s.bold.length && !s.italic.length && !s.lists.length && !s.figureCount;
}

