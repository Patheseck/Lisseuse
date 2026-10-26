import { errorMessage, logError } from '../core/errors';
import { hasMnemonic, hintText } from '../core/mnemonic';
import { formatInterval, GRADE_LABELS, GRADES, preview, rate, type Grade4 } from '../core/scheduler';
import { planSession, shouldRequeue } from '../core/session';
import { listAllCards, listReviews, recordReview, type CardRecord, type Confidence, type ReviewRecord } from '../storage/cards';
import { listBooks } from '../storage/library';
import { loadReviewSettings } from '../storage/settings';
import { add, clear, h } from './dom';
import { toast } from './feedback';
import { icon } from './icons';
import type { Navigate, Screen } from './screen';

const CONFIDENCE: { value: Confidence; label: string }[] = [
  { value: 1, label: 'Je ne sais pas' },
  { value: 2, label: 'J’hésite' },
  { value: 3, label: 'Je sais' },
];

interface Outcome {
  grade: Grade4;
  confidence: Confidence;
}

/** « aujourd'hui à 14 h », « demain », « dans 4 jours », « le 12 mars ». */
export function formatDue(due: number, now = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((day(due) - day(now)) / 86400000);
  if (days <= 0) return `aujourd’hui à ${new Date(Math.max(due, now)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'demain';
  if (days < 7) return `dans ${days} jours`;
  return `le ${new Date(due).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

export function reviewScreen(navigate: Navigate): Screen {
  let cards = new Map<string, CardRecord>();
  let titles = new Map<string, string>();
  let labels = new Map<string, string[]>();
  let queue: string[] = [];
  let done = 0;
  let total = 0;
  const outcomes: Outcome[] = [];
  let shownAt = 0;
  let hinted = false;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const progress = h('span', { className: 'muted review-progress', 'data-testid': 'review-progress' });
  const body = h('div', { className: 'review-column' });
  const el = h('div', { className: 'screen review' },
    h('header', { className: 'topbar' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Quitter la révision', 'data-testid': 'review-close', onclick: () => navigate({ name: 'library' }) }, icon('close')),
      h('h1', { className: 'topbar-title' }, 'Révision'),
      progress,
    ),
    h('main', { className: 'scroll' }, body),
    h('div'),
  );

  function setKeys(handler: ((e: KeyboardEvent) => void) | null): void {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = handler;
    if (handler) document.addEventListener('keydown', handler);
  }

  function context(card: CardRecord): HTMLElement {
    const chapter = labels.get(card.bookId)?.[card.chapter];
    return h('p', { className: 'review-context' },
      h('span', { className: 'pill' }, card.kind === 'sequence' ? 'Étapes' : 'Question'),
      card.origin === 'v5' ? h('span', { className: 'pill pill-muted', title: 'Question générée lors de la reprise de la V5 : modifie-la depuis le lecteur.' }, 'Reprise V5') : null,
      ` ${titles.get(card.bookId) ?? 'Livre'}${chapter ? ` · ${chapter}` : ''}`);
  }

  /** Indice tiré de l'aide-mémoire : le lieu et l'image, jamais la réponse. */
  function hintButton(card: CardRecord): HTMLElement | null {
    if (!hasMnemonic(card.mnemonic)) return null;
    const text = hintText(card.mnemonic);
    const box = h('p', { className: 'review-hint', 'data-testid': 'review-hint', hidden: true }, text);
    const button = h('button', {
      type: 'button', className: 'link-btn', 'data-testid': 'show-hint',
      onclick: () => {
        hinted = true;
        box.hidden = false;
        button.remove();
      },
    }, 'Bloqué ? Voir mon indice');
    return h('div', { className: 'review-hint-wrap' }, button, box);
  }

  function answerBlock(card: CardRecord): HTMLElement {
    return card.kind === 'sequence'
      ? h('ol', { className: 'review-answer', 'data-testid': 'review-answer' }, ...card.steps.map((s) => h('li', {}, s)))
      : h('div', { className: 'review-answer', 'data-testid': 'review-answer' }, card.answer);
  }

  function showCard(): void {
    const card = cards.get(queue[0] ?? '');
    if (!card || !card.srs) {
      finish();
      return;
    }
    progress.textContent = `${Math.min(done + 1, total)} / ${total}`;
    shownAt = Date.now();
    hinted = false;
    const attempt = h('textarea', {
      className: 'input textarea', rows: 4, 'aria-label': 'Ta réponse', 'data-testid': 'review-attempt',
      placeholder: card.kind === 'sequence' ? 'Écris les étapes dont tu te souviens, dans l’ordre…' : 'Écris ce dont tu te souviens avant de regarder…',
    });
    clear(body);
    add(body,
      context(card),
      h('h2', { className: 'review-question', 'data-testid': 'review-question' }, card.question),
      hintButton(card),
      attempt,
      h('p', { className: 'field-label review-ask' }, 'Avant de voir la réponse : quelle est ta confiance ?'),
      h('div', { className: 'confidence', role: 'group', 'aria-label': 'Confiance' },
        ...CONFIDENCE.map((c) => h('button', { type: 'button', className: 'btn', 'data-testid': `confidence-${c.value}`, onclick: () => reveal(card, attempt.value.trim(), c.value) }, c.label)),
      ),
    );
    setKeys(null);
    attempt.focus();
  }

  function reveal(card: CardRecord, attempt: string, confidence: Confidence): void {
    const srs = card.srs!;
    const now = Date.now();
    const next = preview(srs, now);
    clear(body);
    add(body,
      context(card),
      h('h2', { className: 'review-question' }, card.question),
      attempt ? h('div', { className: 'review-block' }, h('span', { className: 'field-label' }, 'Ta réponse'), h('p', { className: 'review-attempt-text' }, attempt)) : null,
      h('div', { className: 'review-block review-block-answer' }, h('span', { className: 'field-label' }, 'Réponse'), answerBlock(card)),
      h('details', { className: 'review-passage' }, h('summary', {}, 'Passage du livre'), h('blockquote', { className: 'passage' }, card.anchor.quote)),
      h('p', { className: 'field-label review-ask' }, 'Compare honnêtement avec la réponse : comment s’est passé ton rappel ?'),
      h('div', { className: 'grades', role: 'group', 'aria-label': 'Note' },
        ...GRADES.map((g) => h('button', { type: 'button', className: `btn grade grade-${g}`, 'data-testid': `grade-${g}`, onclick: () => void grade(card, attempt, confidence, g) },
          h('span', { className: 'grade-label' }, GRADE_LABELS[g]),
          h('span', { className: 'grade-interval' }, formatInterval(next[g] - now)),
        )),
      ),
    );
    setKeys((e) => {
      const g = Number(e.key);
      if (g >= 1 && g <= 4 && !(e.target as Element).closest?.('textarea, input')) void grade(card, attempt, confidence, g as Grade4);
    });
  }

  async function grade(card: CardRecord, attempt: string, confidence: Confidence, g: Grade4): Promise<void> {
    setKeys(null);
    const now = Date.now();
    const before = card.srs!;
    const after = rate(before, g, now);
    const updated: CardRecord = { ...card, srs: after, updatedAt: now };
    const review: ReviewRecord = {
      cardId: card.id, bookId: card.bookId, at: now, grade: g, confidence,
      durationMs: now - shownAt, answer: attempt, ...(hinted ? { hinted: true } : {}),
      stateBefore: before.state, stabilityBefore: before.stability, stabilityAfter: after.stability, dueAfter: after.due,
    };
    try {
      await recordReview(updated, review);
    } catch (err) {
      logError('révision', err);
      toast(`Révision non enregistrée : ${errorMessage(err)}`, 'error');
      return;
    }
    cards.set(card.id, updated);
    outcomes.push({ grade: g, confidence });
    queue.shift();
    // Réapprentissage dans la séance : une fiche ratée revient après les autres.
    if (shouldRequeue(after, now)) queue.push(card.id);
    else done++;

    if (g === 1 && confidence === 3) surprise(updated);
    else showCard();
  }

  /** Effet d'hypercorrection : une erreur commise avec assurance mérite une relecture attentive. */
  function surprise(card: CardRecord): void {
    clear(body);
    const next = h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'surprise-continue', onclick: showCard }, 'J’ai bien relu, continuer');
    body.append(
      h('div', { className: 'surprise', role: 'alert', 'data-testid': 'surprise' },
        h('h2', {}, 'Surprise !'),
        h('p', {}, 'Tu pensais savoir. Ces erreurs-là sont justement celles qu’on corrige le mieux : prends quelques secondes pour bien relire la bonne réponse.'),
      ),
      h('h3', { className: 'review-question' }, card.question),
      h('div', { className: 'review-block review-block-answer' }, answerBlock(card)),
      next,
    );
    next.focus();
  }

  function finish(): void {
    setKeys(null);
    progress.textContent = '';
    const now = Date.now();
    const future = [...cards.values()].filter((c) => c.srs).map((c) => c.srs!.due).filter((d) => d > now);
    const nextDue = future.length ? Math.min(...future) : null;
    clear(body);
    if (!outcomes.length) {
      body.append(h('section', { className: 'review-end', 'data-testid': 'review-empty' },
        h('h2', {}, 'Rien à réviser pour l’instant'),
        h('p', { className: 'muted' }, nextDue ? `Prochaine révision ${formatDue(nextDue, now)}.` : 'Crée des fiches pendant ta lecture : sélectionne un passage puis « Créer une fiche ».'),
        h('button', { type: 'button', className: 'btn btn-primary', onclick: () => navigate({ name: 'library' }) }, 'Retour à la bibliothèque'),
      ));
      return;
    }
    const success = outcomes.filter((o) => o.grade >= 3).length;
    const sure = outcomes.filter((o) => o.confidence === 3);
    const sureOk = sure.filter((o) => o.grade >= 3).length;
    body.append(h('section', { className: 'review-end', 'data-testid': 'review-done' },
      h('h2', {}, 'Séance terminée'),
      h('div', { className: 'stats' },
        h('div', { className: 'stat' }, h('strong', { 'data-testid': 'stat-count' }, String(outcomes.length)), h('span', {}, 'réponses')),
        h('div', { className: 'stat' }, h('strong', { 'data-testid': 'stat-success' }, `${Math.round((success / outcomes.length) * 100)} %`), h('span', {}, 'réussies')),
        sure.length ? h('div', { className: 'stat' }, h('strong', {}, `${Math.round((sureOk / sure.length) * 100)} %`), h('span', {}, 'justes quand tu disais « je sais »')) : null,
      ),
      h('p', { className: 'muted' }, nextDue ? `Prochaine révision ${formatDue(nextDue, now)}. Revenir au bon moment compte plus que réviser longtemps.` : ''),
      h('button', { type: 'button', className: 'btn btn-primary', onclick: () => navigate({ name: 'library' }) }, 'Retour à la bibliothèque'),
    ));
  }

  (async () => {
    const [all, reviews, settings, books] = await Promise.all([listAllCards(), listReviews(), loadReviewSettings(), listBooks()]);
    const known = new Set(books.map((b) => b.id));
    const reviewable = all.filter((c) => c.kind !== 'highlight' && c.srs && known.has(c.bookId));
    cards = new Map(reviewable.map((c) => [c.id, c]));
    titles = new Map(books.map((b) => [b.id, b.title]));
    labels = new Map(books.map((b) => [b.id, b.chapterLabels ?? []]));
    const plan = planSession(reviewable, reviews, { now: Date.now(), newPerDay: settings.newPerDay });
    queue = plan.queue;
    total = queue.length;
    showCard();
  })().catch((err: unknown) => {
    logError('révision', err);
    clear(body);
    body.append(h('p', { className: 'error-box' }, `La révision n’a pas pu démarrer : ${errorMessage(err)}`));
  });

  return { el, destroy: () => setKeys(null) };
}
