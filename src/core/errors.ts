const LOG_KEY = 'liseuse:v6:errors';
const MAX_ENTRIES = 50;

export interface ErrorEntry {
  at: string;
  context: string;
  message: string;
}

export function errorMessage(err: unknown): string {
  // Stockage plein : IndexedDB refuse l'écriture (QuotaExceededError).
  if ((err as { name?: string } | null)?.name === 'QuotaExceededError') return 'Espace de stockage insuffisant sur l’appareil : libère de la place (ou supprime des livres), puis réessaie.';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Erreur inconnue';
}

/** Journal local des erreurs, consultable dans les réglages (jamais envoyé ailleurs). */
export function logError(context: string, err: unknown): void {
  console.error(`[Liseuse] ${context}`, err);
  try {
    const entries = readErrors();
    entries.push({ at: new Date().toISOString(), context, message: errorMessage(err) });
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // stockage indisponible : le journal reste en console
  }
}

export function readErrors(): ErrorEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}
