// Qualité des questions : en révision, la question doit suffire à savoir de quoi on parle,
// même parmi des dizaines de fiches mélangées.

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9…]+/g, ' ')
    .trim();
}

// Formulations qui pourraient s'appliquer à n'importe quel passage.
const GENERIC: RegExp[] = [
  /\bidee (principale|essentielle|centrale|importante)\b/,
  /\b(que|qu) (dit|raconte|signifie|explique|affirme) ce (passage|texte|paragraphe|chapitre|extrait)\b/,
  /\bde quoi parle\b/,
  /\bresume(r)?\b/,
  /\b(ce|cet) (passage|texte|paragraphe|extrait)\b/,
  /^quelles sont les etapes( dans l ordre)?$/,
  /^(c est quoi|qu est ce que c est|pourquoi|comment|quoi)$/,
];

const MIN_WORDS = 4;

/**
 * Avertissement à afficher avant d'enregistrer, ou null si la question est assez précise.
 * `others` : les questions des autres fiches.
 */
export function questionWarning(question: string, others: string[]): string | null {
  const q = normalizeQuestion(question);
  if (q.includes('…')) return 'Remplace « … » par le sujet précis de la question.';
  if (GENERIC.some((re) => re.test(q))) return 'Cette question pourrait correspondre à n’importe quel passage : nomme le sujet précis (par exemple « Pourquoi le sommeil aide-t-il à retenir ? »).';
  if (q.split(' ').filter(Boolean).length < MIN_WORDS) return 'Question très courte : ajoute de quoi la reconnaître sans le texte (sujet, personnage, notion).';
  if (others.some((o) => normalizeQuestion(o) === q)) return 'Une autre fiche pose déjà exactement cette question : précise ce qui distingue celle-ci.';
  return null;
}

/** Début du passage, donné comme indice : quelques mots, jamais plus de la moitié. */
export function passageStart(quote: string, maxWords = 6): string {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  const n = Math.min(maxWords, Math.max(1, Math.floor(words.length / 2)));
  return `${words.slice(0, n).join(' ')} …`;
}
