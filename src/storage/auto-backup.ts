// Sauvegarde automatique dans un fichier choisi une fois (Google Drive, via le sélecteur
// d'Android). Elle est refaite quand on quitte l'app, si les données ont changé : rien ne
// s'écrit pour rien. Elle garde ce qui ne se retrouve pas ailleurs (fiches, révisions,
// progression, notes, réglages, liste des livres) mais pas les fichiers des livres : une
// bibliothèque de plusieurs centaines de Mo, envoyée en arrière-plan à chaque fois, épuiserait la
// mémoire du téléphone et ses données mobiles. Le réglage (emplacement, mot de passe) est propre
// à l'appareil : il ne part jamais dans une sauvegarde.

import { errorMessage } from '../core/errors';
import { collectBackup, encrypt } from './backup';
import { getSetting, putSetting } from './settings';

export const AUTO_BACKUP_KEY = 'auto-backup';
/** Écart minimal entre deux sauvegardes automatiques (allers-retours rapides entre applis). */
export const AUTO_GAP_MS = 2 * 60_000;

export interface AutoBackup {
  /** Fichier choisi (adresse donnée par le sélecteur d'Android). */
  uri: string;
  name: string;
  provider: string;
  /** Sauvegarde automatique en quittant l'app ; sinon seulement « Sauvegarder maintenant ». */
  auto: boolean;
  /** Mot de passe de chiffrement, gardé sur l'appareil seulement. */
  password?: string;
  lastAt?: number;
  lastSize?: number;
  /** Empreinte des données de la dernière sauvegarde : inchangées, rien à écrire. */
  lastHash?: string;
  lastError?: string;
  /** La dernière erreur vient du fichier (supprimé, déplacé, droits retirés) : à choisir de nouveau. */
  lost?: boolean;
}

export type AutoBackupResult = 'written' | 'unchanged' | 'too-soon' | 'off';

export interface AutoBackupDeps {
  /** Écrit le texte dans le fichier choisi ; renvoie les octets écrits. */
  write(uri: string, text: string): Promise<{ written?: number }>;
  /** Erreur due au fichier lui-même (il faut le choisir de nouveau). */
  lost?(err: unknown): boolean;
  now?(): number;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normalizeAutoBackup(raw: unknown): AutoBackup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const uri = str(r.uri);
  if (!uri) return null;
  const out: AutoBackup = { uri, name: str(r.name) ?? 'Sauvegarde', provider: str(r.provider) ?? '', auto: r.auto !== false };
  const optional = { password: str(r.password) || undefined, lastAt: num(r.lastAt), lastSize: num(r.lastSize), lastHash: str(r.lastHash), lastError: str(r.lastError), lost: r.lost === true || undefined };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

export async function loadAutoBackup(): Promise<AutoBackup | null> {
  return normalizeAutoBackup(await getSetting(AUTO_BACKUP_KEY));
}

export async function saveAutoBackup(config: AutoBackup | null): Promise<void> {
  await putSetting(AUTO_BACKUP_KEY, config);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let queue: Promise<unknown> = Promise.resolve();

/** Attend la fin des sauvegardes en cours (avant de rendre le droit sur leur fichier). */
export function autoBackupIdle(): Promise<void> {
  return queue.then(() => undefined, () => undefined);
}

/**
 * Note le résultat d'une sauvegarde dans le réglage tel qu'il est maintenant : l'emplacement a pu
 * changer (ou la sauvegarde être arrêtée) pendant l'écriture ; il n'est alors pas touché.
 */
async function record(uri: string, patch: Partial<AutoBackup>, drop: (keyof AutoBackup)[] = []): Promise<void> {
  const current = await loadAutoBackup();
  if (!current || current.uri !== uri) return;
  const next: AutoBackup = { ...current, ...patch };
  for (const key of drop) delete next[key];
  await saveAutoBackup(next);
}

/**
 * Sauvegarde dans le fichier choisi. `auto` (en quittant l'app) : seulement si les données ont
 * changé depuis la dernière fois, et pas plus d'une fois toutes les deux minutes ; `now` : tout de
 * suite. Les sauvegardes passent l'une après l'autre.
 */
export function runAutoBackup(reason: 'auto' | 'now', deps: AutoBackupDeps): Promise<AutoBackupResult> {
  const result = queue.catch(() => undefined).then(() => run(reason, deps));
  queue = result;
  return result;
}

async function run(reason: 'auto' | 'now', deps: AutoBackupDeps): Promise<AutoBackupResult> {
  const config = await loadAutoBackup();
  if (!config || (reason === 'auto' && (!config.auto || config.lost))) return 'off';
  const now = deps.now?.() ?? Date.now();
  // Empreinte des données (sans la date de l'export) : inchangées, rien à écrire.
  const data = await collectBackup(false);
  const hash = await sha256(JSON.stringify({ ...data, exportedAt: '', encrypted: !!config.password }));
  if (reason === 'auto') {
    if (hash === config.lastHash) return 'unchanged';
    if (config.lastAt !== undefined && now - config.lastAt < AUTO_GAP_MS) return 'too-soon';
  }
  const json = JSON.stringify({ ...data, exportedAt: new Date(now).toISOString() });
  const body = config.password ? JSON.stringify(await encrypt(json, config.password)) : json;
  let written: number | undefined;
  try {
    ({ written } = await deps.write(config.uri, body));
  } catch (err) {
    await record(config.uri, { lastError: errorMessage(err), ...(deps.lost?.(err) ? { lost: true } : {}) });
    throw err;
  }
  await record(config.uri, { lastAt: now, lastSize: written ?? new TextEncoder().encode(body).length, lastHash: hash }, ['lastError', 'lost']);
  return 'written';
}
