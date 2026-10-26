import type { CardRecord } from '../storage/cards';
import { add, clear, h } from './dom';
import { createSheet } from './sheet';

export const RECALL_SECONDS = 120;

export interface RecallResult {
  text: string;
  found: number;
  total: number;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Titres de section du chapitre, utilisés comme repères s'il n'a aucun passage marqué. */
export function chapterHeadings(html: string): string[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return Array.from(tpl.content.querySelectorAll('h2, h3, h4'), (el) => el.textContent?.trim() ?? '').filter(Boolean).slice(0, 12);
}

/**
 * Rappel libre de fin de chapitre : 2 minutes pour écrire ce dont on se souvient, sans regarder,
 * puis comparaison honnête avec ses propres passages. Résout avec le bilan, ou null si abandon.
 */
export function chapterRecall(options: {
  chapterLabel: string;
  passages: CardRecord[];
  headings: string[];
  onCreateCard: (card: CardRecord) => void;
}): Promise<RecallResult | null> {
  return new Promise((resolve) => {
    let result: RecallResult | null = null;
    let timer: number | undefined;
    let pendingCard: CardRecord | null = null;
    const sheet = createSheet({
      title: 'Rappel libre',
      kind: 'full',
      testId: 'recall-sheet',
      onClose: () => {
        window.clearInterval(timer);
        sheet.el.remove();
        resolve(result);
        if (pendingCard) options.onCreateCard(pendingCard);
      },
    });

    // ---------- Phase 1 : écrire sans regarder ----------
    let remaining = RECALL_SECONDS;
    const clock = h('span', { className: 'clock', role: 'timer', 'aria-live': 'off', 'data-testid': 'recall-clock' }, formatClock(remaining));
    const note = h('p', { className: 'hint', 'aria-live': 'polite' });
    const text = h('textarea', { className: 'input textarea recall-text', rows: 9, 'aria-label': 'Ce dont tu te souviens', 'data-testid': 'recall-text', placeholder: 'Idées, mots-clés, exemples, dans le désordre…' });
    const finish = h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'recall-finish', onclick: () => compare() }, 'J’ai fini');
    sheet.body.append(
      h('p', { className: 'recall-head' }, h('span', {}, `Chapitre : ${options.chapterLabel}`), clock),
      h('p', { className: 'hint' }, 'Sans regarder le texte, écris tout ce dont tu te souviens. Chercher dans sa mémoire, même difficilement, renforce le souvenir bien plus qu’une relecture.'),
      text,
      note,
      h('div', { className: 'sheet-actions' }, finish),
    );
    timer = window.setInterval(() => {
      remaining--;
      clock.textContent = formatClock(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        clock.classList.add('done');
        note.textContent = 'Temps écoulé : termine ta phrase, puis touche « J’ai fini ».';
      }
    }, 1000);

    // ---------- Phase 2 : comparer avec ses passages ----------
    function compare(): void {
      window.clearInterval(timer);
      const written = text.value.trim();
      clear(sheet.body);
      add(sheet.body,
        h('p', { className: 'hint' }, 'Compare honnêtement : coche chaque idée que tu avais retrouvée (même avec d’autres mots).'),
        written ? h('div', { className: 'review-block' }, h('span', { className: 'field-label' }, 'Ton rappel'), h('p', { className: 'review-attempt-text' }, written)) : null,
      );
      const items = options.passages.length
        ? options.passages.map((c) => ({ label: c.kind === 'highlight' ? c.anchor.quote : c.question, card: c }))
        : options.headings.map((label) => ({ label, card: null as CardRecord | null }));
      if (!items.length) {
        sheet.body.append(h('p', { className: 'muted' }, 'Ce chapitre n’a encore aucun passage marqué. Relis-le rapidement pour repérer ce que tu avais oublié, et surligne les idées importantes.'));
      }
      const boxes = items.map((item, i) => {
        const box = h('input', { type: 'checkbox', id: `recall-${i}`, 'data-testid': 'recall-check' });
        const row = h('li', { className: 'recall-item' },
          h('label', { className: 'check', for: `recall-${i}` }, box, h('span', {}, item.label.length > 200 ? `${item.label.slice(0, 200)}…` : item.label)),
          item.card?.kind === 'highlight'
            ? h('button', { type: 'button', className: 'link-btn', onclick: () => { pendingCard = item.card; sheet.close(); } }, 'Créer une fiche')
            : null,
        );
        return { box, row };
      });
      if (boxes.length) sheet.body.append(h('p', { className: 'field-label' }, options.passages.length ? 'Tes passages de ce chapitre' : 'Les sections du chapitre'), h('ul', { className: 'recall-list' }, ...boxes.map((b) => b.row)));
      const done = h('button', {
        type: 'button', className: 'btn btn-primary', 'data-testid': 'recall-done',
        onclick: () => {
          result = { text: written, found: boxes.filter((b) => b.box.checked).length, total: boxes.length };
          sheet.close();
        },
      }, 'Terminer');
      sheet.body.append(h('div', { className: 'sheet-actions' }, done));
    }

    sheet.open();
    text.focus();
  });
}

/**
 * Pré-questions avant de relire un chapitre : on tente de répondre, puis la réponse s'affiche
 * aussitôt (retour immédiat). Sans effet sur la planification des révisions.
 */
export function pretest(cards: CardRecord[]): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    let index = 0;
    const sheet = createSheet({
      title: 'Avant de relire',
      kind: 'full',
      testId: 'pretest-sheet',
      onClose: () => {
        sheet.el.remove();
        resolve(completed);
      },
    });

    function show(): void {
      const card = cards[index];
      clear(sheet.body);
      if (!card) {
        completed = true;
        sheet.body.append(
          h('section', { className: 'review-end', 'data-testid': 'pretest-done' },
            h('h2', {}, 'À toi de lire'),
            h('p', { className: 'muted' }, 'En relisant, guette les réponses à ces questions : ton attention sera mieux dirigée.'),
            h('button', { type: 'button', className: 'btn btn-primary', onclick: () => sheet.close() }, 'Commencer la lecture'),
          ),
        );
        return;
      }
      const attempt = h('textarea', { className: 'input textarea', rows: 3, 'aria-label': 'Ta réponse', 'data-testid': 'pretest-attempt', placeholder: 'Ta réponse, même approximative…' });
      const reveal = h('button', {
        type: 'button', className: 'btn btn-primary', 'data-testid': 'pretest-reveal',
        onclick: () => {
          reveal.replaceWith(
            h('div', { className: 'review-block review-block-answer', 'data-testid': 'pretest-answer' },
              h('span', { className: 'field-label' }, 'Réponse'),
              card.kind === 'sequence' ? h('ol', { className: 'review-answer' }, ...card.steps.map((s) => h('li', {}, s))) : h('div', { className: 'review-answer' }, card.answer),
            ),
            h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'pretest-next', onclick: () => { index++; show(); } }, index + 1 < cards.length ? 'Question suivante' : 'Terminer'),
          );
        },
      }, 'Voir la réponse');
      sheet.body.append(
        h('p', { className: 'muted review-progress' }, `Question ${index + 1} / ${cards.length}`),
        h('h2', { className: 'review-question' }, card.question),
        attempt,
        reveal,
      );
      attempt.focus();
    }

    sheet.open();
    show();
  });
}
