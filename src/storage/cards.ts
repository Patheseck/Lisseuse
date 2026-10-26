import type { TextAnchor } from '../reader/anchor';
import { promisify, tx } from './db';

/**
 * Passage marqué dans un livre. À l'étape 2 c'est un simple surlignage ;
 * l'étape 3 y ajoute question, réponse et état de révision.
 */
export interface CardRecord {
  schemaVersion: 1;
  id: string;
  bookId: string;
  chapter: number;
  anchor: TextAnchor;
  createdAt: number;
  updatedAt: number;
}

export function newCard(bookId: string, chapter: number, anchor: TextAnchor): CardRecord {
  const now = Date.now();
  return { schemaVersion: 1, id: crypto.randomUUID(), bookId, chapter, anchor, createdAt: now, updatedAt: now };
}

export async function listCards(bookId: string): Promise<CardRecord[]> {
  const cards = (await tx(['cards'], 'readonly', (t) => promisify(t.objectStore('cards').index('bookId').getAll(bookId)))) as CardRecord[];
  return cards.sort((a, b) => a.chapter - b.chapter || a.anchor.start - b.anchor.start);
}

export async function putCard(card: CardRecord): Promise<void> {
  await tx(['cards'], 'readwrite', (t) => {
    t.objectStore('cards').put(card);
  });
}

export async function deleteCard(id: string): Promise<void> {
  await tx(['cards', 'reviews'], 'readwrite', async (t) => {
    t.objectStore('cards').delete(id);
    const reviewKeys = await promisify(t.objectStore('reviews').index('cardId').getAllKeys(id));
    reviewKeys.forEach((key) => t.objectStore('reviews').delete(key));
  });
}
