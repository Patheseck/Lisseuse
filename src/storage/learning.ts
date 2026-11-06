import { getSetting, putSetting } from './settings';


// Traces des exercices de chapitre (rappel libre, pré-questions), rangées dans les réglages.

export interface RecallRecord {
  chapter: number;
  at: number;
  text: string;
  found: number;
  total: number;
}

const MAX_RECALLS = 100;
const recallKey = (bookId: string) => `recall:${bookId}`;
const pretestKey = (bookId: string) => `pretest:${bookId}`;

export async function listRecalls(bookId: string): Promise<RecallRecord[]> {
  const value = await getSetting(recallKey(bookId));
  return Array.isArray(value) ? (value as RecallRecord[]) : [];
}

export async function addRecall(bookId: string, record: RecallRecord): Promise<void> {
  const all = await listRecalls(bookId);
  await putSetting(recallKey(bookId), [...all, record].slice(-MAX_RECALLS));
}

/** Date du dernier pré-test par chapitre. */
export async function pretestDates(bookId: string): Promise<Record<string, number>> {
  const value = await getSetting(pretestKey(bookId));
  return value && typeof value === 'object' ? (value as Record<string, number>) : {};
}

export async function markPretest(bookId: string, chapter: number, at = Date.now()): Promise<void> {
  await putSetting(pretestKey(bookId), { ...(await pretestDates(bookId)), [chapter]: at });
}

