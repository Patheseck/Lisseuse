import { questionWarning } from '../core/question';
import { surveyChapter, surveyIsEmpty } from '../core/survey';
import type { CardRecord } from '../storage/cards';
import type { Answered, GapItem, GapLevel } from '../storage/method';
import { add, clear, h } from './dom';
import { createSheet } from './sheet';

export const RECALL_SECONDS = 180;

export interface RecallResult {
  /** Arguments et souvenirs en vrac (champ principal du rappel). */
  text: string;
  found: number;
  total: number;
  answered?: Answered;
  main: string;
  explain: string;
  gaps: GapItem[];
  /** Créer (ou mettre à jour) la fiche « question directrice → idée principale ». */
  makeGuideCard: boolean;
  /** Passages surlignés à transformer en fiches (revenus en relisant ou mal compris). */
  cardsToCreate: CardRecord[];
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

function radios<T extends string>(name: string, label: string, options: [T, string][], onChange: (v: T) => void, value?: T): HTMLElement {
  const group = h('div', { className: 'segmented', role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of options) {
    const input = h('input', { type: 'radio', name, value: v, id: `${name}-${v}`, className: 'visually-hidden', checked: v === value });
    input.addEventListener('change', () => input.checked && onChange(v));
    group.append(input, h('label', { for: `${name}-${v}`, 'data-testid': `${name.replace(/-\d+$/, '')}-${v}` }, text));
  }
  return group;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { className: 'field' }, h('span', { className: 'field-label' }, label), hint ? h('span', { className: 'hint' }, hint) : null, control);
}

const list = (title: string, items: string[], testId: string) =>
  items.length ? h('section', { className: 'survey-group', 'data-testid': testId }, h('h3', {}, title), h('ul', {}, ...items.map((t) => h('li', {}, t)))) : null;

/**
 * Étape « Lire » : aperçu du chapitre (intertitres, gras, italique, listes, figures),
 * puis question directrice. Résout avec la question, ou null si fermé sans l'écrire.
 */
export function chapterSurveySheet(options: { chapterLabel: string; html: string; question: string; otherQuestions: string[] }): Promise<string | null> {
  return new Promise((resolve) => {
    let saved: string | null = null;
    const sheet = createSheet({
      title: 'Aperçu du chapitre',
      kind: 'full',
      testId: 'survey-sheet',
      onClose: () => {
        sheet.el.remove();
        resolve(saved);
      },
    });
    const s = surveyChapter(options.html);
    const input = h('textarea', { className: 'input textarea', rows: 2, 'data-testid': 'guide-question', placeholder: 'Ex. : Pourquoi relire donne-t-il l’illusion de savoir ?', value: options.question });
    input.value = options.question;
    const warning = h('p', { className: 'form-warning', role: 'status', 'data-testid': 'guide-warning', hidden: true });
    const start = h('button', {
      type: 'button', className: 'btn btn-primary', 'data-testid': 'guide-save',
      onclick: () => {
        const q = input.value.trim();
        if (!q) {
          warning.hidden = false;
          warning.textContent = 'Écris une question, même provisoire : c’est elle qui rend la lecture active.';
          input.focus();
          return;
        }
        saved = q;
        sheet.close();
      },
    }, 'Commencer la lecture');
    input.addEventListener('input', () => {
      const w = input.value.trim() ? questionWarning(input.value, options.otherQuestions) : null;
      warning.hidden = !w;
      warning.textContent = w ?? '';
    });
    add(sheet.body,
      h('p', { className: 'recall-head' }, h('span', {}, `Chapitre : ${options.chapterLabel}`)),
      h('p', { className: 'hint' }, 'Balaye d’abord le chapitre sans le lire : ces repères annoncent ses idées principales.'),
      list('Intertitres', s.headings, 'survey-headings'),
      list('Mots en gras', s.bold, 'survey-bold'),
      list('En italique', s.italic, 'survey-italic'),
      list('Listes', s.lists, 'survey-lists'),
      s.figureCount ? h('section', { className: 'survey-group', 'data-testid': 'survey-figures' }, h('h3', {}, `Figures et tableaux : ${s.figureCount}`), s.figures.length ? h('ul', {}, ...s.figures.map((t) => h('li', {}, t))) : null) : null,
      surveyIsEmpty(s) ? h('p', { className: 'muted', 'data-testid': 'survey-empty' }, 'Ce chapitre n’a pas de repères visuels : parcours rapidement son premier et son dernier paragraphe.') : null,
      field('Ta question directrice', input, 'Transforme ce qui semble être l’idée centrale en une question à laquelle le chapitre devrait répondre. Garde-la en tête en lisant.'),
      warning,
      h('div', { className: 'sheet-actions' }, start),
    );
    sheet.open();
    input.focus();
  });
}

/**
 * Étapes « Poser » et « Récupérer » : restitution sans regarder (réponse à la question, idée
 * principale, arguments, explication avec ses mots), puis tri honnête des idées en 3 niveaux.
 * Résout avec le bilan, ou null si abandon.
 */
export function chapterRecall(options: {
  chapterLabel: string;
  question: string;
  hasGuideCard: boolean;
  passages: CardRecord[];
  headings: string[];
}): Promise<RecallResult | null> {
  return new Promise((resolve) => {
    let result: RecallResult | null = null;
    let timer: number | undefined;
    let answered: Answered | undefined;
    const sheet = createSheet({
      title: 'Restituer le chapitre',
      kind: 'full',
      testId: 'recall-sheet',
      onClose: () => {
        window.clearInterval(timer);
        sheet.el.remove();
        resolve(result);
      },
    });

    // ---------- Phase 1 : restituer sans regarder ----------
    let remaining = RECALL_SECONDS;
    const clock = h('span', { className: 'clock', role: 'timer', 'aria-live': 'off', 'data-testid': 'recall-clock' }, formatClock(remaining));
    const note = h('p', { className: 'hint', 'aria-live': 'polite' });
    const main = h('textarea', { className: 'input textarea', rows: 2, 'data-testid': 'recall-main', placeholder: 'Ce chapitre montre que…' });
    const text = h('textarea', { className: 'input textarea recall-text', rows: 5, 'data-testid': 'recall-text', placeholder: 'Arguments, exemples, mots-clés, dans le désordre…' });
    const explain = h('textarea', { className: 'input textarea', rows: 4, 'data-testid': 'recall-explain', placeholder: 'Imagine que tu l’expliques à un ami, simplement…' });
    const finish = h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'recall-finish', onclick: () => compare() }, 'J’ai fini');
    add(sheet.body,
      h('p', { className: 'recall-head' }, h('span', {}, `Chapitre : ${options.chapterLabel}`), clock),
      h('p', { className: 'hint' }, 'Livre fermé : écris de mémoire. Chercher, même difficilement, renforce le souvenir bien plus qu’une relecture — et révèle ce qui t’a échappé.'),
      options.question
        ? h('div', { className: 'review-block' },
            h('span', { className: 'field-label' }, 'Ta question directrice'),
            h('p', { className: 'guide-question-text' }, options.question),
            h('span', { className: 'hint' }, 'As-tu trouvé la réponse ?'),
            radios<Answered>('recall-answered', 'As-tu trouvé la réponse ?', [['yes', 'Oui'], ['partly', 'En partie'], ['no', 'Non']], (v) => (answered = v)))
        : null,
      field('1. L’idée principale, en une phrase', main),
      field('2. Les arguments qui l’appuient', text),
      field('3. Explique-le avec tes mots', explain, 'Comme si tu l’enseignais à quelqu’un : là où tu bloques se trouvent tes trous.'),
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

    // ---------- Phase 2 : comparer et trier ----------
    function compare(): void {
      window.clearInterval(timer);
      const written = { main: main.value.trim(), text: text.value.trim(), explain: explain.value.trim() };
      clear(sheet.body);
      const yours = [['Idée principale', written.main], ['Arguments', written.text], ['Avec tes mots', written.explain]].filter(([, v]) => v);
      add(sheet.body,
        h('p', { className: 'hint' }, 'Rouvre le livre et rebalaye le chapitre. Pour chaque idée, sois honnête : l’avais-tu retrouvée ?'),
        yours.length ? h('div', { className: 'review-block' }, h('span', { className: 'field-label' }, 'Ta restitution'), ...yours.map(([k, v]) => h('p', { className: 'review-attempt-text' }, h('strong', {}, `${k} : `), v!))) : null,
      );
      const items = options.passages.filter((c) => c.origin !== 'guide').length
        ? options.passages.filter((c) => c.origin !== 'guide').map((c) => ({ label: c.kind === 'highlight' ? c.anchor.quote : c.question, card: c as CardRecord | null }))
        : options.headings.map((label) => ({ label, card: null as CardRecord | null }));
      if (!items.length) {
        sheet.body.append(h('p', { className: 'muted' }, 'Ce chapitre n’a encore aucun passage marqué. Relis-le rapidement pour repérer ce que tu avais oublié, et surligne les idées importantes.'));
      }
      const rows = items.map((item, i) => {
        const state: { level?: GapLevel; makeCard: HTMLInputElement | null } = { makeCard: null };
        const makeCard = item.card?.kind === 'highlight' ? h('input', { type: 'checkbox', checked: true, 'data-testid': 'recall-make-card' }) : null;
        state.makeCard = makeCard;
        const extra = makeCard ? h('label', { className: 'check recall-extra', hidden: true }, makeCard, h('span', {}, 'En faire une fiche')) : null;
        const row = h('li', { className: 'recall-item', 'data-testid': 'recall-item' },
          h('p', { className: 'recall-label' }, item.label.length > 200 ? `${item.label.slice(0, 200)}…` : item.label),
          radios<GapLevel>(`recall-level-${i}`, 'Niveau', [['easy', 'Retrouvé'], ['reread', 'Revenu en relisant'], ['hard', 'Mal compris']], (v) => {
            state.level = v;
            if (extra) extra.hidden = v === 'easy';
          }),
          extra,
        );
        return { item, state, row };
      });
      if (rows.length) sheet.body.append(h('p', { className: 'field-label' }, options.passages.length ? 'Tes passages de ce chapitre' : 'Les sections du chapitre'), h('ul', { className: 'recall-list' }, ...rows.map((r) => r.row)));
      const guideBox = options.question && written.main ? h('input', { type: 'checkbox', checked: true, 'data-testid': 'recall-guide-card' }) : null;
      if (guideBox) {
        sheet.body.append(h('label', { className: 'check recall-guide' }, guideBox,
          h('span', {}, options.hasGuideCard ? 'Mettre à jour la fiche de ta question directrice avec cette idée principale' : 'Créer une fiche : ta question directrice → ton idée principale')));
      }
      const done = h('button', {
        type: 'button', className: 'btn btn-primary', 'data-testid': 'recall-done',
        onclick: () => {
          result = {
            ...written,
            answered,
            found: rows.filter((r) => r.state.level === 'easy').length,
            total: rows.length,
            gaps: rows.filter((r) => r.state.level && r.state.level !== 'easy').map((r) => ({ label: r.item.label, level: r.state.level!, ...(r.item.card ? { cardId: r.item.card.id } : {}) })),
            makeGuideCard: !!guideBox?.checked,
            cardsToCreate: rows.filter((r) => r.item.card && r.state.level && r.state.level !== 'easy' && r.state.makeCard?.checked).map((r) => r.item.card!),
          };
          sheet.close();
        },
      }, 'Terminer');
      sheet.body.append(h('div', { className: 'sheet-actions' }, done));
    }

    sheet.open();
    main.focus();
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
