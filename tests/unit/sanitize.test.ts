import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/book/sanitize';

describe('sanitizeHtml', () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<script'],
    ['<img src=x onerror="alert(1)">', 'onerror'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['<a href="  JaVaScRiPt:alert(1)">x</a>', 'alert'],
    ['<svg><script>alert(1)</script></svg>', 'alert'],
    ['<svg onload="alert(1)"></svg>', 'onload'],
    ['<iframe src="https://evil"></iframe>', 'iframe'],
    ['<style>body{display:none}</style>', 'display:none'],
    ['<p style="position:fixed">x</p>', 'position:fixed'],
    ['<form action="https://evil"><input name=a></form>', '<form'],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', 'javascript:'],
    ['<p id="app">collision</p>', 'id="app"'],
  ])('neutralise %s', (input, forbidden) => {
    expect(sanitizeHtml(input).toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it('conserve le contenu de lecture et les ressources internes', () => {
    const out = sanitizeHtml('<h1>T</h1><p><em>a</em></p><img data-res="OEBPS/x.png" alt="s"><a data-chapter="2">lien</a>');
    expect(out).toContain('<h1>T</h1>');
    expect(out).toContain('data-res="OEBPS/x.png"');
    expect(out).toContain('data-chapter="2"');
  });

  it('ouvre les liens externes hors de l’app', () => {
    const out = sanitizeHtml('<a href="https://example.org">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('accepte les URL blob: pour les images', () => {
    expect(sanitizeHtml('<img src="blob:https://localhost/abc">')).toContain('blob:https://localhost/abc');
  });
});
