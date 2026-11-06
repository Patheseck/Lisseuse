// Langue d'un livre : elle règle la césure des mots (hyphens: auto) et la voix de lecture.

/** Balise BCP 47 nettoyée (« EN_us » → « en-US »), ou null si la valeur n'en est pas une. */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/_/g, '-');
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value)) return null;
  const [lang, ...rest] = value.split('-');
  return [lang!.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p))].join('-');
}

// Mots très fréquents propres à chaque langue (les mots partagés départagent peu).
const STOPWORDS: Record<string, string[]> = {
  fr: ['le', 'les', 'des', 'est', 'et', 'une', 'du', 'qui', 'dans', 'pour', 'pas', 'sur', 'au', 'avec', 'ce', 'il', 'elle', 'sont', 'nous', 'vous', 'mais', 'aux', 'cette', 'été'],
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'it', 'for', 'with', 'as', 'was', 'on', 'are', 'be', 'this', 'by', 'not', 'you', 'have', 'from', 'which', 'they', 'we', 'his'],
  es: ['el', 'los', 'las', 'y', 'es', 'por', 'una', 'con', 'para', 'del', 'al', 'lo', 'se', 'su', 'más', 'como', 'pero', 'sus', 'le', 'ya', 'muy', 'también', 'fue', 'está'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'ein', 'eine', 'zu', 'den', 'von', 'sich', 'auf', 'für', 'dem', 'im', 'auch', 'es', 'ich', 'wir', 'sie', 'wird', 'oder'],
  it: ['il', 'che', 'di', 'per', 'non', 'una', 'sono', 'della', 'gli', 'con', 'è', 'anche', 'come', 'più', 'nel', 'alla', 'del', 'questo', 'ma', 'essere', 'ha', 'delle', 'dei', 'sul'],
  pt: ['o', 'os', 'não', 'uma', 'um', 'do', 'da', 'em', 'para', 'com', 'por', 'mais', 'como', 'dos', 'das', 'ao', 'se', 'na', 'no', 'mas', 'foi', 'ele', 'ela', 'são'],
};
const LOOKUP = new Map<string, string[]>();
for (const [lang, words] of Object.entries(STOPWORDS)) for (const w of words) LOOKUP.set(w, [...(LOOKUP.get(w) ?? []), lang]);

/** Devine la langue d'un texte (fr, en, es, de, it, pt), ou null si c'est incertain. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 30_000).toLowerCase();
  const scores = new Map<string, number>();
  let total = 0;
  for (const word of sample.match(/\p{L}+/gu) ?? []) {
    const langs = LOOKUP.get(word);
    if (!langs) continue;
    total++;
    for (const lang of langs) scores.set(lang, (scores.get(lang) ?? 0) + 1 / langs.length);
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || total < 8 || best[1] < (second?.[1] ?? 0) * 1.3) return null;
  return best[0];
}

const VOICES: Record<string, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };

/** Langue de la voix de lecture : la région par défaut si le livre n'en précise pas. */
export function speechLanguage(language: string | null | undefined): string {
  const lang = normalizeLanguage(language) ?? 'fr';
  return lang.includes('-') ? lang : (VOICES[lang] ?? lang);
}
