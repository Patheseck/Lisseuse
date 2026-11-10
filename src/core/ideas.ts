// Idées centrales d'un chapitre et liens entre elles. Construire soi-même les relations entre
// les idées (comme dans une carte de concepts) aide à retenir et à réutiliser ce qu'on a lu,
// mieux que relire un texte ou une liste (Nesbit & Adesope, 2006) ; le faire de mémoire, livre
// fermé, y ajoute l'effet du test (Blunt & Karpicke, 2014).

export type RelationId = 'cause' | 'consequence' | 'oppose' | 'exemple' | 'condition' | 'avant' | 'partie' | 'ressemble';

/** Relations proposées, formulées pour se lire « A [relation] B ». */
export const RELATIONS: readonly { id: RelationId; label: string; hint: string }[] = [
  { id: 'cause', label: 'entraîne', hint: 'cause' },
  { id: 'consequence', label: 'découle de', hint: 'conséquence' },
  { id: 'oppose', label: 's’oppose à', hint: 'opposition' },
  { id: 'exemple', label: 'est un exemple de', hint: 'exemple' },
  { id: 'condition', label: 'est nécessaire à', hint: 'condition' },
  { id: 'avant', label: 'précède', hint: 'étape' },
  { id: 'partie', label: 'fait partie de', hint: 'partie' },
  { id: 'ressemble', label: 'ressemble à', hint: 'ressemblance' },
];

export interface IdeaLink {
  from: string;
  relation: RelationId;
  to: string;
  /** Fiche créée pour ce lien, s'il y en a une. */
  cardId?: string;
}

const RELATION_IDS = new Set<string>(RELATIONS.map((r) => r.id));

/** Liens relus du stockage ou d'une sauvegarde : seuls les liens complets sont gardés. */
export function normalizeLinks(value: unknown): IdeaLink[] {
  if (!Array.isArray(value)) return [];
  const out: IdeaLink[] = [];
  for (const v of value as unknown[]) {
    if (!v || typeof v !== 'object') continue;
    const l = v as Record<string, unknown>;
    if (typeof l.from !== 'string' || typeof l.to !== 'string' || !l.from.trim() || !l.to.trim() || !RELATION_IDS.has(l.relation as string)) continue;
    out.push({ from: l.from, relation: l.relation as RelationId, to: l.to, ...(typeof l.cardId === 'string' ? { cardId: l.cardId } : {}) });
  }
  return out;
}

/** Idées relues du stockage : uniquement des textes non vides. */
export function normalizeIdeas(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((i): i is string => typeof i === 'string' && !!i.trim()) : [];
}

export function relationLabel(id: RelationId): string {
  return RELATIONS.find((r) => r.id === id)?.label ?? id;
}

/** « A → entraîne → B ». */
export function linkSentence(link: Pick<IdeaLink, 'from' | 'relation' | 'to'>): string {
  return `${link.from} → ${relationLabel(link.relation)} → ${link.to}`;
}

export function shortIdea(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Idées écrites une par ligne : puces et numéros retirés, lignes vides et doublons ignorés. */
export function splitIdeas(text: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const idea = line.replace(/^\s*(?:[-•–*·]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim();
    const key = idea.toLowerCase();
    if (!idea || seen.has(key)) continue;
    seen.add(key);
    out.push(idea);
    if (out.length >= max) break;
  }
  return out;
}

/** Idées disponibles pour les liens : l'idée principale d'abord, puis les autres. */
export function ideaPool(main: string, ideas: readonly string[]): string[] {
  const pool = main.trim() ? [main.trim()] : [];
  for (const idea of ideas) if (!pool.some((p) => p.toLowerCase() === idea.toLowerCase())) pool.push(idea);
  return pool;
}

// ---------- Fiches nées des idées ----------

export function ideasQuestion(subject: string): string {
  return `Quelles sont les idées centrales de « ${subject} » ?`;
}

export function ideasAnswer(ideas: readonly string[]): string {
  return ideas.map((i) => `• ${i}`).join('\n');
}

export function linkQuestion(link: Pick<IdeaLink, 'from' | 'to'>): string {
  return `Quel lien entre « ${shortIdea(link.from)} » et « ${shortIdea(link.to)} » ?`;
}

export function linkAnswer(link: Pick<IdeaLink, 'from' | 'relation' | 'to'>): string {
  return linkSentence(link);
}

/** Même lien (mêmes idées, même relation), pour ne pas créer deux fois sa fiche. */
export function sameLink(a: Pick<IdeaLink, 'from' | 'relation' | 'to'>, b: Pick<IdeaLink, 'from' | 'relation' | 'to'>): boolean {
  const k = (l: Pick<IdeaLink, 'from' | 'relation' | 'to'>) => `${l.from.toLowerCase()}|${l.relation}|${l.to.toLowerCase()}`;
  return k(a) === k(b);
}

// ---------- Carte des idées du livre ----------

export interface MapChapter {
  label: string;
  question?: string;
  main?: string;
  ideas?: readonly string[];
  links?: readonly IdeaLink[];
  /** Apport ou action pour l'objectif, avec son intitulé (« Une action à essayer »…). */
  apply?: { label: string; text: string };
}

export interface IdeaMap {
  title: string;
  goal: string | null;
  /** Hypothèse d'avant la lecture (« de quoi parle ce livre ? »). */
  hypothesis?: string;
  about?: string;
  ideas?: readonly string[];
  links?: readonly IdeaLink[];
  /** « Oui », « En partie », « Non ». */
  reached?: string;
  next?: string;
  chapters: readonly MapChapter[];
}

/** Un chapitre figure sur la carte dès qu'il a une question, une idée, un lien ou un apport. */
export function chapterHasIdeas(c: MapChapter): boolean {
  return !!(c.question || c.main || c.ideas?.length || c.links?.length || c.apply?.text);
}

/** Idées centrales d'un chapitre, sans répéter son idée principale. */
export function otherIdeas(c: Pick<MapChapter, 'main' | 'ideas'>): string[] {
  const main = c.main?.trim().toLowerCase();
  return (c.ideas ?? []).filter((i) => i.toLowerCase() !== main);
}

/** Carte en texte simple, pour la partager ou la garder dans ses notes. */
export function ideaMapText(map: IdeaMap): string {
  const lines: string[] = [`Carte des idées — « ${map.title} »`];
  const list = (label: string, items: readonly string[]) => {
    if (!items.length) return;
    lines.push(`${label} :`, ...items.map((i) => `• ${i}`));
  };
  if (map.goal) lines.push(`Objectif : ${map.goal}`);
  if (map.about || map.hypothesis || map.ideas?.length || map.links?.length || map.reached || map.next) {
    lines.push('', 'LE LIVRE');
    if (map.about) lines.push(`De quoi il parle : ${map.about}`);
    if (map.hypothesis) lines.push(`Avant de lire, je pensais : ${map.hypothesis}`);
    list('Idées centrales', map.ideas ?? []);
    list('Liens', (map.links ?? []).map(linkSentence));
    if (map.reached) lines.push(`Objectif atteint : ${map.reached.toLowerCase()}`);
    if (map.next) lines.push(`Et maintenant : ${map.next}`);
  }
  const chapters = map.chapters.filter(chapterHasIdeas);
  if (chapters.length) {
    lines.push('', 'CHAPITRE PAR CHAPITRE');
    for (const c of chapters) {
      lines.push('', `■ ${c.label}`);
      if (c.question) lines.push(`Question : ${c.question}`);
      if (c.main) lines.push(`Idée principale : ${c.main}`);
      list('Idées centrales', otherIdeas(c));
      list('Liens', (c.links ?? []).map(linkSentence));
      if (c.apply?.text) lines.push(`${c.apply.label} : ${c.apply.text}`);
    }
  }
  return lines.join('\n');
}
