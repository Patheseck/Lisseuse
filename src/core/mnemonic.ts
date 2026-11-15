import type { CardKind, Mnemonic } from '../storage/cards';

// Aide-mémoire : la table de rappel (système majeur) donne une image à chaque numéro ; sur une
// fiche, on choisit un numéro et on imagine une action qui relie son image à l'idée. Les lieux
// (palais mental), personnages et sons ont été abandonnés : ces champs restent dans les données
// (fiches reprises de la V5) mais ne sont plus affichés, remplis ni importés.

export type MojorEntry = Partial<Pick<Mnemonic, 'word' | 'verb' | 'object' | 'color'>>;
/** Table de rappel : numéro → image (et, en option, action, objet, couleur). */
export type MojorTable = Map<number, MojorEntry>;

/** Champs utilisés. */
const FIELDS = ['word', 'verb', 'object', 'color'] as const;

export function emptyMnemonic(): Mnemonic {
  return { number: null, word: '', verb: '', person: '', place: '', object: '', color: '', sound: '' };
}

export function hasMnemonic(m: Mnemonic | undefined): m is Mnemonic {
  return !!m && (m.number !== null || FIELDS.some((f) => m[f].trim()));
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Une ligne de table. Image : `word` (format de Liseuse et de la V5), sinon `object` puis
 * `person` (ancienne table SECK, comme SECK 5D le fait lui-même) ; action : `verb` ou `action`.
 */
function entryFrom(row: Record<string, unknown>): MojorEntry {
  const entry: MojorEntry = {};
  const word = text(row.word) || text(row.object) || text(row.person);
  const verb = text(row.verb) || text(row.action);
  const object = text(row.word) ? text(row.object) : '';
  const color = text(row.color);
  if (word) entry.word = word;
  if (verb) entry.verb = verb;
  if (object) entry.object = object;
  if (color) entry.color = color;
  return entry;
}

const toNumber = (v: unknown) => (typeof v === 'number' ? v : Number.parseInt(String(v), 10));

/**
 * Table enregistrée ou importée : tableau [{ number, word, … }] (fichier d'origine, ancienne table
 * SECK) ou objet { "12": { … } } (format enregistré). Les lignes sans image ni action sont ignorées.
 */
export function normalizeMojorTable(raw: unknown): MojorTable {
  const table: MojorTable = new Map();
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ number: k, ...(v as object) })) : [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    const n = toNumber(row.number);
    if (!Number.isInteger(n) || n < 0) continue;
    const entry = entryFrom(row);
    if (Object.keys(entry).length) table.set(n, entry);
  }
  return table;
}

interface SeckTable {
  id?: unknown;
  name?: unknown;
  images?: unknown;
}

/**
 * Sauvegarde de SECK 5D : on prend la table active (sinon la plus remplie). Ses numéros sont du
 * texte (« 7 », « 07 », « 007 ») : « 7 » l'emporte sur « 07 », comme dans SECK 5D.
 */
function fromSeck(raw: { tables: unknown[]; activeId?: unknown }): { table: MojorTable; name: string } | null {
  const tables = raw.tables.filter((t): t is SeckTable => !!t && typeof t === 'object' && !!(t as SeckTable).images && typeof (t as SeckTable).images === 'object');
  const size = (t: SeckTable) => Object.values(t.images as object).filter((v) => text(v)).length;
  const active = tables.find((t) => t.id === raw.activeId && size(t) > 0);
  const chosen = active ?? [...tables].sort((a, b) => size(b) - size(a))[0];
  if (!chosen || !size(chosen)) return null;
  const table: MojorTable = new Map();
  const padded = (key: string) => key !== String(Number(key));
  // Numéros complétés de zéros d'abord, pour que « 7 » remplace ensuite « 07 ».
  const keys = Object.keys(chosen.images as object).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(padded(b)) - Number(padded(a)));
  for (const key of keys) {
    const word = text((chosen.images as Record<string, unknown>)[key]);
    if (word) table.set(Number(key), { word });
  }
  return { table, name: text(chosen.name) || 'Table' };
}

/**
 * Export de l'app Memoria : { tables: [{ title, associations: [{ number, value, name, … }] }] }.
 * Le numéro est dans `number`, ou dans `value` (texte) pour les grands numéros. On garde la table
 * la plus remplie (la table de rappel, pas celle des couleurs ni des personnages) ; les photos
 * (adresses Internet ou fichiers du téléphone) ne sont pas reprises.
 */
function fromMemoria(tables: unknown[]): MojorTable | null {
  let best: MojorTable | null = null;
  for (const t of tables) {
    const list = (t as { associations?: unknown } | null)?.associations;
    if (!Array.isArray(list)) continue;
    const table: MojorTable = new Map();
    for (const a of list as Record<string, unknown>[]) {
      if (!a || typeof a !== 'object') continue;
      const n = Number.isInteger(a.number) ? (a.number as number) : /^\d+$/.test(text(a.value)) ? Number(text(a.value)) : Number.NaN;
      const word = text(a.name);
      if (Number.isInteger(n) && n >= 0 && word && !table.has(n)) table.set(n, { word });
    }
    if (!best || table.size > best.size) best = table;
  }
  return best?.size ? best : null;
}

/**
 * Lit un fichier de table : export de Memoria, sauvegarde de SECK 5D, ancienne sauvegarde SECK
 * ({ table: […] }), tableau JSON ou format enregistré. `from` : d'où vient la table.
 */
export function importRecallTable(raw: unknown): { table: MojorTable; from?: string } {
  const r = raw as { tables?: unknown; table?: unknown; activeId?: unknown } | null;
  if (r && typeof r === 'object' && Array.isArray(r.tables)) {
    const memoria = fromMemoria(r.tables);
    if (memoria) return { table: memoria, from: 'Memoria' };
    const seck = fromSeck({ tables: r.tables, activeId: r.activeId });
    return seck ? { table: seck.table, from: `SECK 5D, « ${seck.name} »` } : { table: new Map() };
  }
  if (r && typeof r === 'object' && Array.isArray(r.table)) return { table: normalizeMojorTable(r.table) };
  return { table: normalizeMojorTable(raw) };
}

export function tableToJson(table: MojorTable): Record<string, MojorEntry> {
  return Object.fromEntries([...table].sort(([a], [b]) => a - b).map(([n, e]) => [String(n), e]));
}

/** Complétude : nombre d'images, plus grand numéro, et numéros sans image entre 0 et lui. */
export function tableCoverage(table: MojorTable): { count: number; max: number; missing: number[] } {
  const numbers = [...table].filter(([, e]) => e.word).map(([n]) => n);
  const max = numbers.length ? Math.max(...numbers) : -1;
  const have = new Set(numbers);
  const missing: number[] = [];
  for (let n = 0; n <= max; n++) if (!have.has(n)) missing.push(n);
  return { count: numbers.length, max, missing };
}

/**
 * Change le numéro d'un aide-mémoire : les champs vides, ou encore remplis par l'ancien numéro,
 * prennent les valeurs du nouveau ; ce que l'utilisateur a écrit lui-même reste.
 */
export function fillFromTable(m: Mnemonic, table: MojorTable, previous: number | null = null): Mnemonic {
  const entry = m.number === null ? undefined : table.get(m.number);
  const before = previous === null ? undefined : table.get(previous);
  const out = { ...m };
  for (const f of FIELDS) {
    const auto = !out[f].trim() || (!!before?.[f] && out[f] === before[f]);
    if (auto) out[f] = entry?.[f] ?? '';
  }
  return out;
}

/** Plus petit numéro libre parmi les fiches existantes (0 à 99). */
export function nextFreeNumber(used: (number | null | undefined)[]): number | null {
  const taken = new Set(used.filter((n): n is number => typeof n === 'number'));
  for (let n = 0; n < 100; n++) if (!taken.has(n)) return n;
  return null;
}

/** Conseils d'encodage : un numéro de la table, son image, une action vivante qui la relie à l'idée. */
export function coachTips(m: Mnemonic, kind: CardKind): string[] {
  const tips: string[] = [];
  if (m.number === null) tips.push('Choisis un numéro : son image dans ta table de rappel servira de crochet.');
  if (!m.word.trim()) tips.push(m.number === null ? 'Ou choisis une image concrète, facile à visualiser.' : 'Ce numéro n’a pas d’image dans ta table : écris celle que tu lui donnes.');
  if (!m.verb.trim()) {
    tips.push(kind === 'sequence'
      ? 'Imagine l’image du numéro accomplir les étapes l’une après l’autre, dans l’ordre, avec une action exagérée pour chacune.'
      : 'Ajoute une action vivante, exagérée ou absurde qui relie l’image à l’idée de la fiche : c’est elle qui fixe le souvenir.');
  }
  if (!tips.length) tips.push('Scène complète. Ferme les yeux quelques secondes et visualise-la en détail avant d’enregistrer.');
  return tips;
}

/** Indice affiché en révision : le numéro, son image, l'action. */
export function hintText(m: Mnemonic): string {
  return [m.number !== null ? `n° ${m.number}` : '', m.word, m.verb, m.object, m.color].filter(Boolean).join(' · ');
}
