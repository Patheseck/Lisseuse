import { chapterText, computeLayout, firstPartOf, LAYOUT_VERSION, mapFraction, mapOffset, partsOf, type ChapterLayout } from '../book/layout';
import { PARSER_VERSION, type Chapter } from '../book/types';
import { anchorFromOffsets, locate } from '../reader/anchor';
import type { CardRecord } from './cards';
import { promisify, tx } from './db';
import type { RecallRecord } from './learning';
import type { BookRecord, ChapterCache, ProgressRecord } from './library';
import type { Bookmark, ChapterGuide } from './method';

// Migration des données d'un livre quand ses chapitres sont redécoupés (voir book/layout.ts) :
// fiches, progression, signets, questions directrices, chapitres choisis, rappels et pré-tests
// passent des chapitres d'origine aux nouveaux morceaux, sans rien perdre.

/** Réglages propres à un livre qui désignent des chapitres (clé : `${type}:${idDuLivre}`). */
export const CHAPTER_SETTINGS = ['guide', 'focus', 'bookmarks', 'recall', 'pretest'] as const;
export type ChapterSetting = (typeof CHAPTER_SETTINGS)[number];

/** Type et livre d'une clé de réglage par livre, ou null pour un autre réglage. */
export function parseChapterSettingKey(key: string): { kind: ChapterSetting; bookId: string } | null {
  const i = key.indexOf(':');
  const kind = key.slice(0, i) as ChapterSetting;
  return i > 0 && CHAPTER_SETTINGS.includes(kind) ? { kind, bookId: key.slice(i + 1) } : null;
}

export interface Remapper {
  /** Nouveau chapitre d'un chapitre d'origine (son premier morceau). */
  chapter(base: number): number;
  card<T extends Pick<CardRecord, 'chapter' | 'anchor'>>(card: T): T;
  /** Position relative (progression, signet) : `offset` va de 0 à 1. */
  position<T extends { chapter: number; offset: number }>(record: T): T;
  setting(kind: ChapterSetting, value: unknown): unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createRemapper(base: Chapter[], layout: ChapterLayout): Remapper {
  const baseTexts = new Map<number, string>();
  const partTexts = new Map<number, string>();
  const baseText = (b: number) => {
    let t = baseTexts.get(b);
    if (t === undefined) baseTexts.set(b, (t = chapterText(base[b]?.html ?? '')));
    return t;
  };
  const partText = (q: number) => {
    let t = partTexts.get(q);
    if (t === undefined) partTexts.set(q, (t = chapterText(layout.chapters[q]?.html ?? '')));
    return t;
  };
  const chapter = (b: number) => firstPartOf(layout, b);
  const position = <T extends { chapter: number; offset: number }>(record: T): T => {
    const m = mapFraction(layout, record.chapter, record.offset);
    return { ...record, chapter: m.chapter, offset: m.fraction };
  };
  const keyed = <V>(value: Record<string, V>, merge: (a: V, b: V) => V = (_a, b) => b) => {
    const out: Record<string, V> = {};
    for (const [k, v] of Object.entries(value)) {
      const target = String(chapter(Number(k)));
      out[target] = target in out ? merge(out[target]!, v) : v;
    }
    return out;
  };

  return {
    chapter,
    position,
    card(card) {
      if (partsOf(layout, card.chapter).length <= 1) {
        const target = chapter(card.chapter);
        return target === card.chapter ? card : { ...card, chapter: target };
      }
      // Position réelle du passage dans le chapitre d'origine (corrige un éventuel décalage).
      const text = baseText(card.chapter);
      const found = locate(text, card.anchor) ?? { start: Math.min(card.anchor.start, text.length), end: Math.min(card.anchor.end, text.length) };
      const { chapter: target, offset } = mapOffset(layout, card.chapter, found.start);
      const part = partText(target);
      const start = Math.min(offset, part.length);
      // Un passage à cheval sur deux morceaux est raccourci à la fin du premier.
      const end = Math.max(start, Math.min(part.length, found.end - layout.parts[target]!.start));
      return { ...card, chapter: target, anchor: anchorFromOffsets(part, start, end) };
    },
    setting(kind, value) {
      switch (kind) {
        case 'guide':
          return isRecord(value) ? keyed(value as Record<string, ChapterGuide>) : value;
        case 'pretest':
          return isRecord(value) ? keyed(value as Record<string, number>, (a, b) => Math.max(a, b)) : value;
        case 'focus':
          return Array.isArray(value) ? [...new Set((value as number[]).flatMap((c) => partsOf(layout, c)))].sort((a, b) => a - b) : value;
        case 'bookmarks':
          return Array.isArray(value) ? (value as Bookmark[]).map((b) => (isRecord(b) && typeof b.chapter === 'number' ? position(b) : b)) : value;
        case 'recall':
          return Array.isArray(value) ? (value as RecallRecord[]).map((r) => (isRecord(r) && typeof r.chapter === 'number' ? { ...r, chapter: chapter(r.chapter) } : r)) : value;
      }
    },
  };
}

/**
 * Passe un livre au découpage actuel : nouveaux chapitres en cache, fiche du livre mise à jour,
 * et toutes ses données converties, dans une seule transaction (tout ou rien).
 */
export async function upgradeLayout(book: BookRecord, base: Chapter[], resources: Record<string, Blob>): Promise<{ book: BookRecord; chapters: Chapter[] }> {
  const layout = computeLayout(base, book);
  const next: BookRecord = { ...book, layout: LAYOUT_VERSION, chapterCount: layout.chapters.length, chapterLabels: layout.chapters.map((c) => c.label) };
  const remap = layout.chapters === base ? null : createRemapper(base, layout);
  await tx(['books', 'chapters', 'cards', 'progress', 'settings'], 'readwrite', async (t) => {
    if (remap) {
      const cards = (await promisify(t.objectStore('cards').index('bookId').getAll(book.id))) as CardRecord[];
      cards.forEach((c) => t.objectStore('cards').put(remap.card(c)));
      const progress = (await promisify(t.objectStore('progress').get(book.id))) as ProgressRecord | undefined;
      if (progress) t.objectStore('progress').put(remap.position(progress));
      for (const kind of CHAPTER_SETTINGS) {
        const key = `${kind}:${book.id}`;
        const row = (await promisify(t.objectStore('settings').get(key))) as { key: string; value: unknown } | undefined;
        if (row) t.objectStore('settings').put({ key, value: remap.setting(kind, row.value) });
      }
    }
    t.objectStore('chapters').put({ bookId: book.id, parserVersion: PARSER_VERSION, layout: LAYOUT_VERSION, chapters: layout.chapters, resources } satisfies ChapterCache);
    t.objectStore('books').put(next);
  });
  return { book: next, chapters: layout.chapters };
}
