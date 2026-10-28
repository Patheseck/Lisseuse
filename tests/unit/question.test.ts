import { describe, expect, it } from 'vitest';
import { passageStart, questionWarning } from '../../src/core/question';

describe('questionWarning', () => {
  it('accepte une question précise', () => {
    expect(questionWarning('Pourquoi le sommeil profond aide-t-il à retenir ?', [])).toBeNull();
    expect(questionWarning('Quelles sont les étapes de la photosynthèse, dans l’ordre ?', [])).toBeNull();
  });

  it.each([
    'Quelle est l’idée principale de ce passage ?',
    'Quelle est l\'idée essentielle ?',
    'Que dit ce passage ?',
    'De quoi parle ce chapitre ?',
    'Résume le texte.',
    'Quelles sont les étapes, dans l’ordre ?',
    'Pourquoi ?',
  ])('signale une question vague : %s', (q) => {
    expect(questionWarning(q, [])).toMatch(/n’importe quel passage/);
  });

  it('signale une question trop courte, un « … » oublié, un doublon', () => {
    expect(questionWarning('Rôle du foie ?', [])).toMatch(/très courte/);
    expect(questionWarning('Quelles sont les étapes de …, dans l’ordre ?', [])).toMatch(/Remplace/);
    expect(questionWarning('Quel est le rôle du foie ?', ['quel est le RÔLE du foie'])).toMatch(/déjà exactement/);
  });
});

describe('passageStart', () => {
  it('montre quelques mots, jamais plus de la moitié', () => {
    expect(passageStart('La consolidation transforme un souvenir fragile en souvenir durable.')).toBe('La consolidation transforme un …');
    expect(passageStart('Encodage, stockage, récupération.')).toBe('Encodage, …');
    expect(passageStart('Mot')).toBe('Mot …');
  });
});
