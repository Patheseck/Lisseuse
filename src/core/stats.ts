import { startOfDay } from './session';
import type { SrsState } from './scheduler';

// Indicateurs du tableau de bord. Logique pure : testée unitairement.

const DAY_MS = 86400000;

export interface StatCard {
  kind: string;
  srs: SrsState | null;
}

export interface StatReview {
  at: number;
  grade: number;
  confidence: number | null;
  stateBefore: number;
}

/** Fiches à revoir par jour : index 0 = aujourd'hui (retards compris). Les fiches nouvelles ne comptent pas. */
export function forecast(cards: StatCard[], now: number, days = 7): number[] {
  const today = startOfDay(now);
  const out = new Array<number>(days).fill(0);
  for (const c of cards) {
    if (!c.srs || c.srs.state === 0) continue;
    const index = Math.max(0, Math.floor((startOfDay(c.srs.due) - today) / DAY_MS));
    if (index < days) out[index]!++;
  }
  return out;
}

/**
 * Rétention réelle : part des rappels réussis (Bien/Facile) parmi les révisions de fiches déjà
 * apprises (état « Review »), sur la période. C'est ce que FSRS vise (90 %).
 */
export function retention(reviews: StatReview[], now: number, windowDays = 30): { rate: number | null; count: number } {
  const since = now - windowDays * DAY_MS;
  const spaced = reviews.filter((r) => r.at >= since && r.stateBefore === 2);
  if (!spaced.length) return { rate: null, count: 0 };
  return { rate: spaced.filter((r) => r.grade >= 3).length / spaced.length, count: spaced.length };
}

export interface CalibrationRow {
  confidence: 1 | 2 | 3;
  count: number;
  /** Part de réponses réussies (Bien/Facile) ; null si aucune réponse. */
  rate: number | null;
}

/** Réussite réelle selon la confiance annoncée avant la correction. */
export function calibration(reviews: StatReview[]): CalibrationRow[] {
  return ([1, 2, 3] as const).map((confidence) => {
    const rows = reviews.filter((r) => r.confidence === confidence);
    return { confidence, count: rows.length, rate: rows.length ? rows.filter((r) => r.grade >= 3).length / rows.length : null };
  });
}

/** Jours avec au moins une révision, du plus ancien à aujourd'hui. */
export function activity(reviews: StatReview[], now: number, days = 30): { active: boolean[]; count: number } {
  const today = startOfDay(now);
  const active = new Array<boolean>(days).fill(false);
  for (const r of reviews) {
    const index = days - 1 - Math.round((today - startOfDay(r.at)) / DAY_MS);
    if (index >= 0 && index < days) active[index] = true;
  }
  return { active, count: active.filter(Boolean).length };
}
