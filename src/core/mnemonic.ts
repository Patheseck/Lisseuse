import type { CardKind, Mnemonic } from '../storage/cards';

// Aide-mémoire : association image / lieu / action (méthode des lieux, table Mojor).

export type MojorEntry = Partial<Omit<Mnemonic, 'number'>>;
export type MojorTable = Map<number, MojorEntry>;

const FIELDS = ['word', 'verb', 'person', 'place', 'object', 'color', 'sound'] as const;

export function emptyMnemonic(): Mnemonic {
  return { number: null, word: '', verb: '', person: '', place: '', object: '', color: '', sound: '' };
}

export function hasMnemonic(m: Mnemonic | undefined): m is Mnemonic {
  return !!m && (m.number !== null || FIELDS.some((f) => m[f].trim()));
}

/**
 * Table Mojor importée : tableau [{ number, word, … }] (fichier d'origine)
 * ou objet { "12": { … } } (format enregistré par la V5).
 */
export function normalizeMojorTable(raw: unknown): MojorTable {
  const table: MojorTable = new Map();
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ number: k, ...(v as object) })) : [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    const n = typeof row.number === 'number' ? row.number : Number.parseInt(String(row.number), 10);
    if (!Number.isInteger(n) || n < 0) continue;
    const entry: MojorEntry = {};
    for (const f of FIELDS) if (typeof row[f] === 'string' && row[f]) entry[f] = row[f] as string;
    table.set(n, entry);
  }
  return table;
}

export function tableToJson(table: MojorTable): Record<string, MojorEntry> {
  return Object.fromEntries([...table].map(([n, e]) => [String(n), e]));
}

/** Complète les champs vides avec l'entrée de la table pour ce numéro. */
export function fillFromTable(m: Mnemonic, table: MojorTable): Mnemonic {
  const entry = m.number === null ? undefined : table.get(m.number);
  if (!entry) return m;
  const out = { ...m };
  for (const f of FIELDS) if (!out[f].trim() && entry[f]) out[f] = entry[f]!;
  return out;
}

/** Plus petit numéro libre parmi les fiches existantes (0 à 99). */
export function nextFreeNumber(used: (number | null | undefined)[]): number | null {
  const taken = new Set(used.filter((n): n is number => typeof n === 'number'));
  for (let n = 0; n < 100; n++) if (!taken.has(n)) return n;
  return null;
}

/** Conseils d'encodage, fondés sur la méthode des lieux : lieu précis, image concrète et animée, action. */
export function coachTips(m: Mnemonic, kind: CardKind): string[] {
  const tips: string[] = [];
  if (!m.place.trim()) tips.push(kind === 'sequence' ? 'Choisis un trajet familier : une étape par lieu, dans l’ordre du parcours.' : 'Place l’image dans un lieu précis que tu connais bien (pièce, rue, trajet).');
  if (!m.word.trim()) tips.push('Choisis une image concrète, facile à visualiser.');
  else if (!m.person.trim()) tips.push('Une image vivante (personne, animal) se retient mieux qu’un objet inerte.');
  if (!m.verb.trim()) tips.push('Ajoute une action forte, exagérée ou absurde : c’est elle qui fixe le souvenir.');
  if (!tips.length) tips.push('Scène complète. Ferme les yeux quelques secondes et visualise-la en détail avant d’enregistrer.');
  return tips;
}

/** Indice affiché en révision : le lieu d'abord (méthode des lieux), puis l'image. */
export function hintText(m: Mnemonic): string {
  return [m.place && `📍 ${m.place}`, m.number !== null ? `n° ${m.number}` : '', m.person, m.word, m.verb, m.object, m.color, m.sound].filter(Boolean).join(' · ');
}
