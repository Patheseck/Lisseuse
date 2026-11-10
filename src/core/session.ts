import { isNew, type SrsState } from './scheduler';

// Construction d'une séance de révision. Logique pure, sans stockage : testée unitairement.

export interface QueueCard {
  id: string;
  bookId: string;
  chapter: number;
  createdAt: number;
  srs: SrsState | null;
}

export interface QueueReview {
  cardId: string;
  at: number;
  stateBefore: SrsState['state'];
}

/** Une fiche dont la prochaine échéance tombe dans ce délai revient dans la même séance. */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Nombre de nouvelles fiches déjà introduites aujourd'hui. */
export function newIntroducedToday(reviews: QueueReview[], now: number): number {
  const since = startOfDay(now);
  return new Set(reviews.filter((r) => r.at >= since && r.stateBefore === 0).map((r) => r.cardId)).size;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Entrelacement : les fiches sont regroupées par livre et chapitre, puis piochées tour à tour
 * dans chaque groupe (ordre des groupes aléatoire), pour éviter d'enchaîner le même sujet.
 */
export function interleave<T extends QueueCard>(cards: T[], random: () => number, order: (a: T, b: T) => number): T[] {
  const groups = new Map<string, T[]>();
  for (const c of cards) {
    const key = `${c.bookId}#${c.chapter}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const queues = shuffle([...groups.values()], random).map((g) => g.sort(order));
  const out: T[] = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

export interface SessionPlan {
  queue: string[];
  dueCount: number;
  newCount: number;
  /** Prochaine échéance future (hors séance), pour l'afficher quand il n'y a rien à faire. */
  nextDue: number | null;
}

export function planSession(cards: QueueCard[], reviews: QueueReview[], opts: { now: number; newPerDay: number; random?: () => number }): SessionPlan {
  const { now } = opts;
  const random = opts.random ?? Math.random;
  const reviewable = cards.filter((c): c is QueueCard & { srs: SrsState } => c.srs !== null);
  const due = reviewable.filter((c) => !isNew(c.srs) && c.srs.due <= now);
  const allowed = Math.max(0, opts.newPerDay - newIntroducedToday(reviews, now));
  const fresh = reviewable.filter((c) => isNew(c.srs)).sort((a, b) => a.createdAt - b.createdAt).slice(0, allowed);

  const dueOrdered = interleave(due, random, (a, b) => a.srs.due - b.srs.due);
  const freshOrdered = interleave(fresh, random, (a, b) => a.createdAt - b.createdAt);

  // Les nouvelles fiches sont réparties régulièrement parmi les révisions.
  const queue: string[] = [];
  const every = freshOrdered.length ? Math.max(1, Math.floor(dueOrdered.length / freshOrdered.length)) : Infinity;
  let f = 0;
  dueOrdered.forEach((c, i) => {
    queue.push(c.id);
    if ((i + 1) % every === 0 && f < freshOrdered.length) queue.push(freshOrdered[f++]!.id);
  });
  while (f < freshOrdered.length) queue.push(freshOrdered[f++]!.id);

  const inQueue = new Set(queue);
  const future = reviewable.filter((c) => !inQueue.has(c.id) && !isNew(c.srs)).map((c) => c.srs.due);
  const waitingNew = reviewable.some((c) => isNew(c.srs) && !inQueue.has(c.id));
  const nextDue = future.length ? Math.min(...future) : waitingNew ? startOfDay(now) + 24 * 3600 * 1000 : null;

  return { queue, dueCount: dueOrdered.length, newCount: freshOrdered.length, nextDue };
}

/** Après une note : la fiche doit-elle revenir plus tard dans cette séance ? */
export function shouldRequeue(srs: SrsState, now: number): boolean {
  return srs.due - now <= LEARN_AHEAD_MS;
}
