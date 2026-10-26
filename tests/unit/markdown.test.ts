import { describe, expect, it } from 'vitest';
import { markdownToHtml, parseMarkdown } from '../../src/book/markdown';

describe('markdownToHtml', () => {
  it('convertit titres, paragraphes et emphase', () => {
    expect(markdownToHtml('## Titre\n\nUn **gras** et un *italique*.')).toBe('<h2>Titre</h2>\n<p>Un <strong>gras</strong> et un <em>italique</em>.</p>');
  });

  it('fusionne les lignes consécutives en un paragraphe', () => {
    expect(markdownToHtml('ligne un\nligne deux')).toBe('<p>ligne un ligne deux</p>');
  });

  it('gère listes à puces et numérotées', () => {
    expect(markdownToHtml('- a\n- b\n\n1. x\n2. y')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>x</li>\n<li>y</li>\n</ol>');
  });

  it('échappe le HTML brut et le code', () => {
    expect(markdownToHtml('<script>x</script> `a<b`')).toBe('<p>&lt;script&gt;x&lt;/script&gt; <code>a&lt;b</code></p>');
    expect(markdownToHtml('```\n<b>\n```')).toBe('<pre><code>&lt;b&gt;</code></pre>');
  });

  it('gère citations et règles horizontales', () => {
    expect(markdownToHtml('> cité\n\n---')).toBe('<blockquote><p>cité</p></blockquote>\n<hr>');
  });

  it('ne transforme pas les astérisques isolés', () => {
    expect(markdownToHtml('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  });
});

describe('parseMarkdown', () => {
  it('découpe en chapitres sur les titres de niveau 1', () => {
    const book = parseMarkdown('Intro\n\n# Un\n\ntexte\n\n# Deux\n\nautre', 'notes.md');
    expect(book.title).toBe('notes');
    expect(book.chapters.map((c) => c.label)).toEqual(['Section 1', 'Un', 'Deux']);
  });

  it('neutralise les liens javascript:', () => {
    const book = parseMarkdown('[piège](javascript:alert(1))', 'x.md');
    expect(book.chapters[0]!.html).not.toContain('javascript:');
  });

  it('produit au moins un chapitre pour un fichier vide', () => {
    expect(parseMarkdown('', 'vide.md').chapters).toHaveLength(1);
  });
});
