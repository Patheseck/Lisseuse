import { afterEach, describe, expect, it } from 'vitest';
import { applyPrompt, cardTemplates, goalSummary, guidingExamples, normalizeGoal } from '../../src/core/goal';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { deleteBook, saveBook } from '../../src/storage/library';
import { loadGoal, saveGoal } from '../../src/storage/method';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('objectif du livre', () => {
  it('valide un objectif enregistré et retire « capable de » répété', () => {
    expect(normalizeGoal(null)).toBeNull();
    expect(normalizeGoal({ about: ' ', why: '' })).toBeNull();
    const g = normalizeGoal({ why: ' Pour mon travail ', kind: 'savoir-faire', capable: 'capable de construire un budget', at: 5 })!;
    expect(g).toMatchObject({ why: 'Pour mon travail', kind: 'savoir-faire', capable: 'construire un budget', about: '', known: '', at: 5 });
    expect(normalizeGoal({ why: 'x', kind: 'magie' })!.kind).toBeNull();
  });

  it('résume l’objectif en une ligne, avec l’élision', () => {
    const base = { about: '', why: '', kind: null, known: '', at: 0, updatedAt: 0 };
    expect(goalSummary({ ...base, capable: 'construire un budget' })).toBe('être capable de construire un budget');
    expect(goalSummary({ ...base, capable: 'appliquer la méthode' })).toBe('être capable d’appliquer la méthode');
    expect(goalSummary({ ...base, capable: '', why: 'Pour comprendre la crise' })).toBe('Pour comprendre la crise');
    expect(goalSummary({ ...base, capable: '', kind: 'competence' })).toBe('une compétence');
    expect(goalSummary(null)).toBeNull();
  });

  it('adapte modèles de fiches, exemples et question de restitution au type d’objectif', () => {
    expect(cardTemplates('savoir-faire').map((t) => t.label)).toContain('Comment faire… ?');
    expect(cardTemplates('competence').map((t) => t.label)).toContain('Que ferais-tu si… ?');
    expect(cardTemplates(null).map((t) => t.label)).toEqual(['Pourquoi… ?', 'Qu’est-ce que… ?', 'Quelle différence… ?', 'Comment… ?']);
    expect(guidingExamples('savoir-faire')).toContain('Comment faire');
    expect(applyPrompt('savoir-faire')?.label).toBe('Une action à essayer');
    expect(applyPrompt('savoir')?.label).toContain('t’apporte');
    expect(applyPrompt('plaisir')).toBeNull();
    expect(applyPrompt(null)).toBeNull();
  });

  it('est enregistré avec le livre et supprimé avec lui', async () => {
    await saveBook('b', { format: 'md', title: 'B', author: null, chapters: [{ label: 'A', html: '<p>a</p>' }], resources: {}, cover: null }, new Blob(['# A']), 'b.md');
    expect(await loadGoal('b')).toBeNull();
    await saveGoal('b', { about: 'La mémoire', why: 'Réviser mieux', kind: 'savoir', capable: 'expliquer l’oubli', known: '', at: 1, updatedAt: 2 });
    expect((await loadGoal('b'))?.capable).toBe('expliquer l’oubli');
    await deleteBook('b');
    expect(await loadGoal('b')).toBeNull();
  });
});
