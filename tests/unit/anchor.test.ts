import { describe, expect, it } from 'vitest';
import { anchorFromOffsets, anchorFromRange, expandToWords, locate, unwrap, wrapRange } from '../../src/reader/anchor';

function root(html: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
}

describe('anchorFromRange', () => {
  it('calcule les positions à travers plusieurs éléments et retire les espaces', () => {
    const el = root('<p>Un <strong>texte gras</strong> et <em>italique</em>.</p>');
    const range = document.createRange();
    range.setStart(el.querySelector('p')!.firstChild!, 2); // " " avant "texte"
    range.setEnd(el.querySelector('em')!.firstChild!, 4);
    const anchor = anchorFromRange(el, range)!;
    expect(anchor.quote).toBe('texte gras et italique'); // mot coupé complété
    expect(el.textContent!.slice(anchor.start, anchor.end)).toBe(anchor.quote);
    expect(anchor.prefix).toBe('Un ');
  });

  it('refuse une sélection hors du chapitre ou vide', () => {
    const el = root('<p>abc</p>');
    const outside = document.createElement('p');
    outside.textContent = 'dehors';
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(anchorFromRange(el, range)).toBeNull();
    const blank = document.createRange();
    blank.setStart(el.firstChild!.firstChild!, 1);
    blank.setEnd(el.firstChild!.firstChild!, 1);
    expect(anchorFromRange(el, blank)).toBeNull();
  });
});

describe('expandToWords', () => {
  const text = 'L’illusion de compétence, c’est-à-dire 42 fois.';
  it('complète les mots coupés aux deux bouts, sans déborder sur la ponctuation', () => {
    const r = expandToWords(text, text.indexOf('lusion'), text.indexOf('péten'));
    expect(text.slice(r.start, r.end)).toBe('L’illusion de compétence');
  });
  it('garde les traits d’union et les nombres, et laisse intacte une sélection propre', () => {
    const r = expandToWords(text, text.indexOf('est-à'), text.indexOf('2 fois') + 1);
    expect(text.slice(r.start, r.end)).toBe('c’est-à-dire 42');
    const clean = expandToWords(text, 0, 10);
    expect(text.slice(clean.start, clean.end)).toBe('L’illusion');
  });
});

describe('locate', () => {
  const text = 'Le chat dort. Le chien court. Le chat mange.';

  it('garde la position si le texte n’a pas changé', () => {
    const a = anchorFromOffsets(text, 30, 37);
    expect(locate(text, a)).toEqual({ start: 30, end: 37 });
  });

  it('retrouve un passage déplacé grâce au contexte', () => {
    const a = anchorFromOffsets(text, 30, 37); // second « Le chat »
    const changed = 'Préface ajoutée. ' + text;
    const found = locate(changed, a)!;
    expect(changed.slice(found.start, found.end)).toBe('Le chat');
    expect(found.start).toBe(30 + 'Préface ajoutée. '.length);
  });

  it('renvoie null si le passage a disparu', () => {
    expect(locate('autre texte', anchorFromOffsets(text, 3, 7))).toBeNull();
  });
});

describe('wrapRange / unwrap', () => {
  it('enveloppe un passage qui traverse gras, italique et paragraphes', () => {
    const el = root('<p>Un <strong>texte gras</strong> et</p>\n<p><em>italique</em> fin</p>');
    const text = el.textContent!;
    const start = text.indexOf('gras');
    const end = text.indexOf('ital') + 4;
    const marks = wrapRange(el, start, end, () => {
      const m = document.createElement('mark');
      m.className = 'hl';
      return m;
    });
    expect(marks.map((m) => m.textContent)).toEqual(['gras', ' et', 'ital']);
    expect(el.textContent).toBe(text);
    expect(el.querySelectorAll('p')).toHaveLength(2);

    unwrap(el, 'mark.hl');
    expect(el.querySelector('mark')).toBeNull();
    expect(el.innerHTML).toBe('<p>Un <strong>texte gras</strong> et</p>\n<p><em>italique</em> fin</p>');
  });

  it('les positions restent valables avec des marques existantes', () => {
    const el = root('<p>alpha beta gamma delta</p>');
    wrapRange(el, 6, 10, () => document.createElement('mark'));
    const text = el.textContent!;
    const marks = wrapRange(el, text.indexOf('gamma'), text.indexOf('gamma') + 5, () => document.createElement('mark'));
    expect(marks[0]!.textContent).toBe('gamma');
  });
});
