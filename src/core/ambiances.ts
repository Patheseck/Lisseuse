// Ambiances musicales de lecture. Chacune nomme une tradition précise (et non une région
// vague) : « Moyen-Orient » recouvre des musiques arabes, persanes et turques bien distinctes.
// Les identifiants sont enregistrés avec les livres : ne jamais les renommer.

export type AmbianceGroup = 'Afrique' | 'Moyen-Orient' | 'Asie' | 'Europe' | 'Amériques' | 'Sans frontière';

export interface Ambiance {
  id: string;
  name: string;
  /** Région ou tradition, affichée sous le nom. */
  region: string;
  group: AmbianceGroup;
  /** Recherche proposée dans les applis de musique (vide : pas de recherche). */
  search: string;
}

export const AMBIANCES: readonly Ambiance[] = [
  { id: 'kora', name: 'Kora', region: 'Afrique de l’Ouest, tradition mandingue', group: 'Afrique', search: 'kora instrumental' },
  { id: 'krar', name: 'Krar et masenqo', region: 'Corne de l’Afrique, Éthiopie', group: 'Afrique', search: 'ethiopian krar instrumental' },
  { id: 'mbira', name: 'Mbira', region: 'Afrique australe, Zimbabwe', group: 'Afrique', search: 'mbira instrumental' },
  { id: 'oud', name: 'Oud et qanun', region: 'Monde arabe', group: 'Moyen-Orient', search: 'oud qanun taqsim instrumental' },
  { id: 'santour', name: 'Santour et ney', region: 'Perse, Iran', group: 'Moyen-Orient', search: 'persian santur ney instrumental' },
  { id: 'ney-turc', name: 'Ney et saz', region: 'Turquie, Empire ottoman', group: 'Moyen-Orient', search: 'turkish ney taksim instrumental' },
  { id: 'sitar', name: 'Sitar et tabla', region: 'Inde', group: 'Asie', search: 'sitar raga instrumental' },
  { id: 'guzheng', name: 'Guzheng et erhu', region: 'Chine', group: 'Asie', search: 'guzheng erhu instrumental' },
  { id: 'koto', name: 'Koto et shakuhachi', region: 'Japon', group: 'Asie', search: 'koto shakuhachi instrumental' },
  { id: 'flamenco', name: 'Guitare flamenca', region: 'Espagne, Andalousie', group: 'Europe', search: 'flamenco guitar instrumental' },
  { id: 'celtique', name: 'Harpe celtique', region: 'Irlande, Écosse, Bretagne', group: 'Europe', search: 'celtic harp instrumental' },
  { id: 'piano', name: 'Piano classique', region: 'Europe, répertoire romantique', group: 'Europe', search: 'calm classical piano' },
  { id: 'andes', name: 'Flûte des Andes', region: 'Pérou, Bolivie', group: 'Amériques', search: 'andean flute quena instrumental' },
  { id: 'jazz', name: 'Jazz calme', region: 'États-Unis', group: 'Amériques', search: 'calm jazz instrumental' },
  { id: 'pluie', name: 'Pluie et nature', region: 'Sons naturels, sans musique', group: 'Sans frontière', search: 'rain sounds' },
  { id: 'perso', name: 'Ma sélection', region: 'Tes morceaux préférés, sans thème', group: 'Sans frontière', search: '' },
];

export const AMBIANCE_GROUPS: readonly AmbianceGroup[] = ['Afrique', 'Moyen-Orient', 'Asie', 'Europe', 'Amériques', 'Sans frontière'];

export function findAmbiance(id: string | null | undefined): Ambiance | null {
  return AMBIANCES.find((a) => a.id === id) ?? null;
}

/** Applis de musique où ouvrir une recherche (elles s'ouvrent hors de Liseuse, qui reste sans Internet). */
export const MUSIC_APPS = [
  { name: 'Spotify', url: (q: string) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  { name: 'YouTube Music', url: (q: string) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Deezer', url: (q: string) => `https://www.deezer.com/search/${encodeURIComponent(q)}` },
] as const;

/** Formats audio acceptés à l'import (le navigateur du téléphone sait les lire). */
export const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

/**
 * Volume effectif d'une piste : volume choisi × fondu en cours × atténuation (1 normalement,
 * DUCK_FACTOR quand la lecture à voix haute parle).
 */
export function effectiveVolume(master: number, fade: number, duck: number): number {
  return Math.min(1, Math.max(0, master * fade * duck));
}
export const DUCK_FACTOR = 0.25;
export const DEFAULT_VOLUME = 0.35;

/** Ordre de lecture mélangé (Fisher–Yates), différent à chaque séance. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Durée du fondu entre deux morceaux, raccourcie pour les morceaux très courts. */
export function crossfadeFor(duration: number, preferred = 4): number {
  if (!Number.isFinite(duration) || duration <= 0) return preferred;
  return Math.max(0.3, Math.min(preferred, duration / 3));
}
