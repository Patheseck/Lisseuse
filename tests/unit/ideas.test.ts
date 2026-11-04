import { describe, expect, it } from 'vitest';
import { chapterHasIdeas, ideaMapText, ideaPool, ideasAnswer, ideasQuestion, linkAnswer, linkQuestion, linkSentence, normalizeIdeas, normalizeLinks, otherIdeas, relationLabel, RELATIONS, sameLink, shortIdea, splitIdeas } from '../../src/core/ideas';

describe('idées centrales et liens', () => {
  it('lit les idées une par ligne, sans puces, sans doublons', () => {
    expect(splitIdeas('- Le sommeil consolide\n\n• La relecture trompe\n2) Se tester aide\nle sommeil consolide')).toEqual(['Le sommeil consolide', 'La relecture trompe', 'Se tester aide']);
    expect(splitIdeas('')).toEqual([]);
    expect(splitIdeas(Array.from({ length: 10 }, (_, i) => `idée ${i}`).join('\n'))).toHaveLength(6);
  });

  it('réunit l’idée principale et les idées centrales', () => {
    expect(ideaPool('Principale', ['Autre', 'principale'])).toEqual(['Principale', 'Autre']);
    expect(ideaPool('  ', ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('formule les liens et leurs fiches', () => {
    expect(RELATIONS).toHaveLength(8);
    expect(relationLabel('cause')).toBe('entraîne');
    const link = { from: 'Le manque de sommeil', relation: 'cause' as const, to: 'l’oubli rapide' };
    expect(linkSentence(link)).toBe('Le manque de sommeil → entraîne → l’oubli rapide');
    expect(linkQuestion(link)).toBe('Quel lien entre « Le manque de sommeil » et « l’oubli rapide » ?');
    expect(linkAnswer(link)).toBe(linkSentence(link));
    expect(sameLink(link, { ...link, from: 'LE MANQUE DE SOMMEIL' })).toBe(true);
    expect(sameLink(link, { ...link, relation: 'oppose' })).toBe(false);
    expect(shortIdea('x'.repeat(80), 10)).toHaveLength(10);
  });

  it('formule la fiche des idées centrales', () => {
    expect(ideasQuestion('La mémoire')).toBe('Quelles sont les idées centrales de « La mémoire » ?');
    expect(ideasAnswer(['A', 'B'])).toBe('• A\n• B');
  });
});

describe('liens et idées relus d’une sauvegarde', () => {
  it('ne garde que les liens complets, à la relation connue', () => {
    expect(normalizeLinks([
      { from: 'A', relation: 'cause', to: 'B', cardId: 'c1' },
      { from: 'A', relation: 'inconnue', to: 'B' },
      { from: '', relation: 'cause', to: 'B' },
      { from: 'A', relation: 'oppose', to: 3 },
      'texte',
      null,
      { from: 'C', relation: 'partie', to: 'D', cardId: 7 },
    ])).toEqual([{ from: 'A', relation: 'cause', to: 'B', cardId: 'c1' }, { from: 'C', relation: 'partie', to: 'D' }]);
    expect(normalizeLinks('pas une liste')).toEqual([]);
    expect(normalizeIdeas(['A', 2, ' ', 'B'])).toEqual(['A', 'B']);
    expect(normalizeIdeas({})).toEqual([]);
  });
});

describe('carte des idées', () => {
  const chapters = [
    { label: 'Le sommeil', question: 'Pourquoi dormir aide-t-il à retenir ?', main: 'Le sommeil consolide', ideas: ['Le sommeil consolide', 'Le cerveau rejoue la journée'], links: [{ from: 'Le cerveau rejoue la journée', relation: 'cause' as const, to: 'Le sommeil consolide' }], apply: { label: 'Une action à essayer', text: 'Réviser le soir' } },
    { label: 'Annexe', ideas: [], links: [] },
  ];

  it('ne retient que les chapitres où le lecteur a dégagé quelque chose', () => {
    expect(chapterHasIdeas(chapters[0]!)).toBe(true);
    expect(chapterHasIdeas(chapters[1]!)).toBe(false);
    expect(chapterHasIdeas({ label: 'X', apply: { label: 'Action', text: '' } })).toBe(false);
    expect(otherIdeas(chapters[0]!)).toEqual(['Le cerveau rejoue la journée']);
  });

  it('se partage en texte simple : le livre puis chaque chapitre', () => {
    const text = ideaMapText({
      title: 'La mémoire', goal: 'être capable d’expliquer le rôle du sommeil', hypothesis: 'Un livre sur les révisions',
      about: 'Le sommeil fait partie de l’apprentissage', ideas: ['Dormir consolide', 'Se tester aide'],
      links: [{ from: 'Dormir consolide', relation: 'condition', to: 'Se tester aide' }], reached: 'En partie', next: 'Dormir avant l’examen',
      chapters,
    });
    expect(text).toBe([
      'Carte des idées — « La mémoire »',
      'Objectif : être capable d’expliquer le rôle du sommeil',
      '',
      'LE LIVRE',
      'De quoi il parle : Le sommeil fait partie de l’apprentissage',
      'Avant de lire, je pensais : Un livre sur les révisions',
      'Idées centrales :',
      '• Dormir consolide',
      '• Se tester aide',
      'Liens :',
      '• Dormir consolide → est nécessaire à → Se tester aide',
      'Objectif atteint : en partie',
      'Et maintenant : Dormir avant l’examen',
      '',
      'CHAPITRE PAR CHAPITRE',
      '',
      '■ Le sommeil',
      'Question : Pourquoi dormir aide-t-il à retenir ?',
      'Idée principale : Le sommeil consolide',
      'Idées centrales :',
      '• Le cerveau rejoue la journée',
      'Liens :',
      '• Le cerveau rejoue la journée → entraîne → Le sommeil consolide',
      'Une action à essayer : Réviser le soir',
    ].join('\n'));
  });

  it('sans bilan ni restitution : juste le titre', () => {
    expect(ideaMapText({ title: 'Vide', goal: null, chapters: [{ label: 'Un' }] })).toBe('Carte des idées — « Vide »');
  });
});
