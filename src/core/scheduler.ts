import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

// Planification FSRS-6 via ts-fsrs (bibliothèque officielle open-spaced-repetition).
// L'état est stocké en nombres (millisecondes) pour rester simple à sauvegarder en JSON.

export type Grade4 = 1 | 2 | 3 | 4;
export const GRADES: readonly Grade4[] = [1, 2, 3, 4];
export const GRADE_LABELS: Record<Grade4, string> = { 1: 'Encore', 2: 'Difficile', 3: 'Bien', 4: 'Facile' };

export interface SrsState {
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: number | null;
}

export const TARGET_RETENTION = 0.9;

const scheduler = fsrs(
  generatorParameters({
    request_retention: TARGET_RETENTION,
    maximum_interval: 36500,
    // Étale légèrement les échéances pour éviter les journées surchargées.
    enable_fuzz: true,
    enable_short_term: true,
    // Réapprentissage dans la séance : une fiche ratée revient après quelques minutes.
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  }),
);

function toCard(s: SrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    ...(s.lastReview !== null ? { last_review: new Date(s.lastReview) } : {}),
  };
}

function fromCard(c: Card): SrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

export function newSrs(now = Date.now()): SrsState {
  return fromCard(createEmptyCard(new Date(now)));
}

export function rate(state: SrsState, grade: Grade4, now = Date.now()): SrsState {
  return fromCard(scheduler.next(toCard(state), new Date(now), grade as Grade).card);
}

/** Échéance prévue pour chaque note, pour l'afficher sur les boutons. */
export function preview(state: SrsState, now = Date.now()): Record<Grade4, number> {
  const p = scheduler.repeat(toCard(state), new Date(now));
  return {
    1: p[Rating.Again].card.due.getTime(),
    2: p[Rating.Hard].card.due.getTime(),
    3: p[Rating.Good].card.due.getTime(),
    4: p[Rating.Easy].card.due.getTime(),
  };
}

/** Probabilité actuelle de se souvenir (0 à 1). */
export function retrievability(state: SrsState, now = Date.now()): number {
  if (state.state === State.New) return 0;
  return scheduler.get_retrievability(toCard(state), new Date(now), false);
}

export function isNew(state: SrsState): boolean {
  return state.state === State.New;
}

/** « 10 min », « 3 h », « 4 j », « 2 mois », « 1,5 an ». */
export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} j`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} mois`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${String(years).replace('.', ',')} an${years >= 2 ? 's' : ''}`;
}
