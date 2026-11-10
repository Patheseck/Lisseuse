import { describe, expect, it } from 'vitest';
import { detectLanguage, normalizeLanguage, speechLanguage } from '../../src/core/language';

describe('langue des livres', () => {
  it('normalise les balises de langue', () => {
    expect(normalizeLanguage('FR')).toBe('fr');
    expect(normalizeLanguage('en_us')).toBe('en-US');
    expect(normalizeLanguage(' pt-br ')).toBe('pt-BR');
    expect(normalizeLanguage('français')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
  });

  it('devine la langue d’un texte', () => {
    expect(detectLanguage('La mémoire est une faculté qui oublie. Nous lisons des livres pour apprendre, mais il faut aussi se tester sur ce qui a été lu dans le chapitre.')).toBe('fr');
    expect(detectLanguage('The memory is a faculty that forgets. We read books to learn, but it is also necessary to test ourselves on what was read in this chapter.')).toBe('en');
    expect(detectLanguage('La memoria es una facultad que olvida. Leemos los libros para aprender, pero también es necesario ponerse a prueba con lo que se ha leído en el capítulo.')).toBe('es');
    expect(detectLanguage('Das Gedächtnis ist eine Fähigkeit, die vergisst. Wir lesen Bücher, um zu lernen, aber es ist auch wichtig, sich mit dem zu prüfen, was man in dem Kapitel gelesen hat.')).toBe('de');
    expect(detectLanguage('42 3.14 !!!')).toBeNull();
  });

  it('choisit la voix de lecture', () => {
    expect(speechLanguage('en')).toBe('en-US');
    expect(speechLanguage('en-GB')).toBe('en-GB');
    expect(speechLanguage(null)).toBe('fr-FR');
    expect(speechLanguage('ja')).toBe('ja');
  });
});
