// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { newSrs, rate } from '../../src/core/scheduler';
import { demoteCard, deleteCard, listAllCards, listCards, listReviews, newCard, normalizeCard, putCard, recordReview, type CardRecord, type ReviewRecord } from '../../src/storage/cards';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { anchorFromOffsets } from '../../src/reader/anchor';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const anchor = anchorFromOffsets('Le chat dort sur le tapis.', 3, 12);

function qa(bookId = 'b'): CardRecord {
  return { ...newCard(bookId, 0, anchor), kind: 'qa', question: 'Q ?', answer: 'R.', srs: newSrs() };
}

function review(card: CardRecord, grade: 1 | 3): { updated: CardRecord; log: ReviewRecord } {
  const after = rate(card.srs!, grade);
  return {
    updated: { ...card, srs: after },
    log: { cardId: card.id, bookId: card.bookId, at: Date.now(), grade, confidence: 2, durationMs: 1000, answer: '', stateBefore: card.srs!.state, stabilityBefore: card.srs!.stability, stabilityAfter: after.stability, dueAfter: after.due },
  };
}

describe('fiches', () => {
  it('complète les surlignages enregistrés avant l’étape 3', () => {
    const legacy = normalizeCard({ id: 'x', bookId: 'b', chapter: 2, anchor } as never);
    expect(legacy).toMatchObject({ kind: 'highlight', question: '', answer: '', steps: [], srs: null, schemaVersion: 1 });
  });

  it('enregistre la révision et la nouvelle planification ensemble', async () => {
    const card = qa();
    await putCard(card);
    const { updated, log } = review(card, 3);
    await recordReview(updated, log);
    expect((await listCards('b'))[0]!.srs!.reps).toBe(1);
    expect(await listReviews()).toHaveLength(1);
  });

  it('redevenir un surlignage efface l’historique de cette fiche seulement', async () => {
    const a = qa();
    const b = qa();
    await putCard(a);
    await putCard(b);
    await recordReview(review(a, 3).updated, review(a, 3).log);
    await recordReview(review(b, 1).updated, review(b, 1).log);
    await demoteCard({ ...a, kind: 'highlight', question: '', answer: '', srs: null });
    const reviews = await listReviews();
    expect(reviews.map((r) => r.cardId)).toEqual([b.id]);
    expect((await listAllCards()).find((c) => c.id === a.id)?.kind).toBe('highlight');
  });

  it('supprimer une fiche supprime ses révisions', async () => {
    const a = qa();
    await putCard(a);
    await recordReview(review(a, 3).updated, review(a, 3).log);
    await deleteCard(a.id);
    expect(await listAllCards()).toEqual([]);
    expect(await listReviews()).toEqual([]);
  });
});
