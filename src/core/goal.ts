// Objectif de lecture d'un livre : pourquoi on le lit et ce qu'on veut en retirer.
// Lire avec un but précis oriente l'attention et la mémoire vers ce qui s'y rapporte
// (McCrudden & Schraw, 2007) ; écrire l'utilité personnelle de ce qu'on apprend renforce
// l'intérêt (Hulleman & Harackiewicz, 2009) ; « ce que je sais / ce que je veux savoir »
// reprend la méthode K-W-L (Ogle, 1986).

export type GoalKind = 'savoir' | 'savoir-faire' | 'competence' | 'plaisir';

export interface BookGoal {
  /** « De quoi parle ce livre ? » : hypothèse avant la lecture, comparée au bilan. */
  about: string;
  /** « Pourquoi je le lis ? À quoi va-t-il me servir ? » */
  why: string;
  kind: GoalKind | null;
  /** « À la fin, je serai capable de… » (sans ces mots). */
  capable: string;
  /** « Ce que je sais déjà sur le sujet. » */
  known: string;
  at: number;
  updatedAt: number;
}

export interface GoalKindInfo {
  id: GoalKind;
  label: string;
  detail: string;
  /** Verbes d'action proposés pour « je serai capable de… ». */
  verbs: string[];
}

export const GOAL_KINDS: readonly GoalKindInfo[] = [
  { id: 'savoir', label: 'Un savoir', detail: 'Comprendre un sujet, des idées, des faits', verbs: ['expliquer', 'comparer', 'définir', 'résumer'] },
  { id: 'savoir-faire', label: 'Un savoir-faire', detail: 'Savoir faire quelque chose : une méthode, une technique', verbs: ['réaliser', 'appliquer', 'construire', 'utiliser'] },
  { id: 'competence', label: 'Une compétence', detail: 'Agir dans des situations réelles : décider, réagir', verbs: ['décider', 'gérer', 'négocier', 'résoudre'] },
  { id: 'plaisir', label: 'Le plaisir', detail: 'Lire pour le plaisir : la méthode se fait discrète', verbs: [] },
];

const KINDS = GOAL_KINDS.map((k) => k.id);
const MAX = 600;
const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX) : '');

/** Objectif enregistré (stockage, sauvegarde), ou null s'il est absent ou vide. */
export function normalizeGoal(raw: unknown): BookGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const goal: BookGoal = {
    about: text(r.about),
    why: text(r.why),
    kind: KINDS.includes(r.kind as GoalKind) ? (r.kind as GoalKind) : null,
    capable: text(r.capable).replace(/^(je serai )?capable de\s+/i, ''),
    known: text(r.known),
    at: typeof r.at === 'number' ? r.at : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
  return isGoalEmpty(goal) ? null : goal;
}

export function isGoalEmpty(goal: Pick<BookGoal, 'about' | 'why' | 'capable' | 'known' | 'kind'>): boolean {
  return !goal.about && !goal.why && !goal.capable && !goal.known && !goal.kind;
}

/** Résumé d'une ligne : « être capable de … », sinon la raison de la lecture. */
export function goalSummary(goal: BookGoal | null): string | null {
  if (!goal) return null;
  if (goal.capable) return `être capable ${/^[aeiouyàâäéèêëîïôöùûü]/i.test(goal.capable) ? 'd’' : 'de '}${goal.capable}`;
  if (goal.why) return goal.why;
  if (goal.kind) return GOAL_KINDS.find((k) => k.id === goal.kind)!.label.toLowerCase();
  return goal.about || null;
}

/** Modèles de questions de fiches, selon ce qu'on veut retirer du livre. */
export function cardTemplates(kind: GoalKind | null | undefined): { label: string; text: string }[] {
  if (kind === 'savoir-faire') {
    return [
      { label: 'Comment faire… ?', text: 'Comment faire pour ' },
      { label: 'Quelle erreur éviter… ?', text: 'Quelle erreur éviter quand ' },
      { label: 'Que faire si… ?', text: 'Que faire si ' },
      { label: 'Pourquoi… ?', text: 'Pourquoi ' },
    ];
  }
  if (kind === 'competence') {
    return [
      { label: 'Que ferais-tu si… ?', text: 'Que ferais-tu si ' },
      { label: 'Dans quelle situation… ?', text: 'Dans quelle situation faut-il ' },
      { label: 'Comment appliquer… ?', text: 'Comment appliquer  à  ?' },
      { label: 'Pourquoi… ?', text: 'Pourquoi ' },
    ];
  }
  return [
    { label: 'Pourquoi… ?', text: 'Pourquoi ' },
    { label: 'Qu’est-ce que… ?', text: 'Qu’est-ce que ' },
    { label: 'Quelle différence… ?', text: 'Quelle est la différence entre  et  ?' },
    { label: 'Comment… ?', text: 'Comment ' },
  ];
}

/** Exemples de question directrice, selon l'objectif. */
export function guidingExamples(kind: GoalKind | null | undefined): string {
  if (kind === 'savoir-faire') return 'Ex. : Comment faire pour… ? Quelles étapes pour… ?';
  if (kind === 'competence') return 'Ex. : Que faire quand… ? Comment réagir si… ?';
  return 'Ex. : Pourquoi… ? Qu’est-ce qui explique… ?';
}

/**
 * Champ ajouté à la restitution pour relier le chapitre à l'objectif. Pour un savoir-faire,
 * une action précise (quoi, quand, où) : prévoir le moment et le lieu rend le passage à l'acte
 * bien plus probable (intentions de mise en œuvre, Gollwitzer, 1999).
 */
export function applyPrompt(kind: GoalKind | null | undefined): { label: string; hint: string; placeholder: string } | null {
  if (kind === 'savoir') return { label: 'Ce que ce chapitre t’apporte pour ton objectif', hint: 'Ce que tu comprends mieux maintenant, en lien avec ce que tu cherches.', placeholder: 'Je comprends mieux…' };
  if (kind === 'savoir-faire') return { label: 'Une action à essayer', hint: 'Quoi, quand et où ? Plus elle est précise, plus tu la feras.', placeholder: 'Demain matin, à mon bureau, j’essaie…' };
  if (kind === 'competence') return { label: 'Une situation où l’appliquer', hint: 'Une situation réelle et ce que tu y feras.', placeholder: 'La prochaine fois que…, je…' };
  return null;
}
