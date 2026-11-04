import { AUDIO_EXTENSIONS, DEFAULT_VOLUME, type ResumePoint } from '../core/ambiances';
import { promisify, tx } from './db';
import { getSetting, putSetting } from './settings';

// Morceaux importés pour les ambiances, et choix d'ambiance par livre. Les morceaux restent
// sur l'appareil ; ils ne sont pas inclus dans les sauvegardes (ce sont des fichiers à toi).

export interface AudioTrack {
  id: string;
  ambiance: string;
  /** Nom du fichier d'origine. */
  name: string;
  blob: Blob;
  /** Durée en secondes, si elle a pu être lue à l'import. */
  duration: number | null;
  addedAt: number;
}

export interface AmbiancePrefs {
  /** Volume de la musique, de 0 à 1. */
  volume: number;
}

export const ambianceKey = (bookId: string) => `ambiance:${bookId}`;
const RESUME_KEY = 'ambiance-resume';

export function isAudioFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

export async function listTracks(ambiance: string): Promise<AudioTrack[]> {
  const tracks = (await tx(['audio'], 'readonly', (t) => promisify(t.objectStore('audio').index('ambiance').getAll(ambiance)))) as AudioTrack[];
  return tracks.sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name));
}

/** Nombre de morceaux par ambiance (parcours des seules clés de l'index, sans lire les fichiers). */
export async function countTracks(): Promise<Map<string, number>> {
  return tx(['audio'], 'readonly', (t) => new Promise<Map<string, number>>((resolve, reject) => {
    const counts = new Map<string, number>();
    const req = t.objectStore('audio').index('ambiance').openKeyCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(counts);
      const key = String(cursor.key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function addTracks(tracks: Omit<AudioTrack, 'id' | 'addedAt'>[]): Promise<AudioTrack[]> {
  const now = Date.now();
  const records = tracks.map((t, i) => ({ ...t, id: crypto.randomUUID(), addedAt: now + i }));
  await tx(['audio'], 'readwrite', (t) => {
    records.forEach((r) => t.objectStore('audio').put(r));
  });
  return records;
}

export async function deleteTrack(id: string): Promise<void> {
  await tx(['audio'], 'readwrite', (t) => {
    t.objectStore('audio').delete(id);
  });
}

export async function loadAmbiancePrefs(): Promise<AmbiancePrefs> {
  const raw = (await getSetting('ambiance')) as Partial<AmbiancePrefs> | undefined;
  const volume = typeof raw?.volume === 'number' && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_VOLUME;
  return { volume };
}

export async function saveAmbiancePrefs(prefs: AmbiancePrefs): Promise<void> {
  await putSetting('ambiance', prefs);
}

/** Points de reprise de chaque ambiance (morceau et seconde où elle s'est arrêtée). */
export async function loadResumePoints(): Promise<Record<string, ResumePoint>> {
  const value = await getSetting(RESUME_KEY);
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, ResumePoint> = {};
  for (const [id, p] of Object.entries(value as Record<string, Partial<ResumePoint>>)) {
    if (p && typeof p.trackId === 'string' && typeof p.time === 'number' && Number.isFinite(p.time)) out[id] = { trackId: p.trackId, time: p.time, at: typeof p.at === 'number' ? p.at : 0 };
  }
  return out;
}

export async function saveResumePoints(points: Record<string, ResumePoint>): Promise<void> {
  await putSetting(RESUME_KEY, points);
}

/** Ambiance choisie pour un livre (null : silence). */
export async function getBookAmbiance(bookId: string): Promise<string | null> {
  const value = await getSetting(ambianceKey(bookId));
  return typeof value === 'string' ? value : null;
}

export async function setBookAmbiance(bookId: string, ambiance: string | null): Promise<void> {
  await putSetting(ambianceKey(bookId), ambiance);
}
