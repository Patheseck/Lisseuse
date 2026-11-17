// Recherche plein texte dans un livre, insensible à la casse et aux accents.

/**
 * Replie un texte pour la comparaison (minuscules, sans accents) en conservant
 * exactement sa longueur, afin que les positions trouvées restent valables dans l'original.
 */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    // Un caractère hors BMP compte pour 2 unités : on garde l'original pour préserver la longueur.
    out += base.length === ch.length ? base : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

/** Texte brut d'un chapitre, identique au textContent de son rendu dans le lecteur. */
export function htmlToText(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent ?? '';
}

export interface SearchHit {
  chapter: number;
  start: number;
  end: number;
  before: string;
  match: string;
  after: string;
}

const SNIPPET = 60;

export function searchChapters(texts: string[], query: string, limit = 200): SearchHit[] {
  const q = fold(query.trim().replace(/\s+/g, ' '));
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  texts.forEach((text, chapter) => {
    if (hits.length >= limit) return;
    const folded = fold(text.replace(/\s/g, ' '));
    for (let i = folded.indexOf(q); i !== -1 && hits.length < limit; i = folded.indexOf(q, i + q.length)) {
      const end = i + q.length;
      hits.push({
        chapter,
        start: i,
        end,
        before: (i > SNIPPET ? '…' : '') + text.slice(Math.max(0, i - SNIPPET), i).replace(/\s+/g, ' ').trimStart(),
        match: text.slice(i, end),
        after: text.slice(end, end + SNIPPET).replace(/\s+/g, ' ').trimEnd() + (end + SNIPPET < text.length ? '…' : ''),
      });
    }
  });
  return hits;
}
