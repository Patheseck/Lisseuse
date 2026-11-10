import { describe, expect, it } from 'vitest';
import { luminance, regionHasInk } from '../../src/ui/pdf-reader';

/** Zone RGBA de `n` pixels d'une couleur, avec quelques pixels d'une autre (lettres). */
function region(n: number, bg: [number, number, number], ink?: { color: [number, number, number]; count: number }): Uint8ClampedArray {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = ink && i % Math.max(1, Math.floor(n / ink.count)) === 0 ? ink.color : bg;
    data.set([r, g, b, 255], i * 4);
  }
  return data;
}

describe('vérification du dessin des pages d’un PDF', () => {
  it('une ligne de texte dessinée a de l’encre, quels que soient les couleurs et le lissage', () => {
    expect(regionHasInk(region(400, [255, 255, 255], { color: [0, 0, 0], count: 20 }))).toBe(true);
    // Lettres lissées (gris) sur fond blanc.
    expect(regionHasInk(region(400, [255, 255, 255], { color: [200, 200, 200], count: 5 }))).toBe(true);
    // Thème nuit : lettres claires sur fond sombre.
    expect(regionHasInk(region(400, [23, 22, 27], { color: [233, 227, 211], count: 20 }))).toBe(true);
  });

  it('une zone uniforme (texte non dessiné) n’en a pas', () => {
    expect(regionHasInk(region(400, [255, 255, 255]))).toBe(false);
    expect(regionHasInk(region(400, [23, 22, 27]))).toBe(false);
    // Canevas vide (transparent) ou à peine nuancé.
    expect(regionHasInk(new Uint8ClampedArray(1600))).toBe(false);
    expect(regionHasInk(region(400, [250, 250, 250], { color: [240, 240, 240], count: 20 }))).toBe(false);
    expect(regionHasInk([])).toBe(false);
  });

  it('luminance des couleurs du thème', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000')).toBe(0);
    expect(luminance('rgb(23, 22, 27)')).toBeLessThan(0.1);
    expect(luminance('bleu')).toBeNull();
  });
});
