import { GOAL_KINDS, isGoalEmpty, type BookGoal, type GoalKind } from '../core/goal';
import type { Chapter } from '../book/types';
import { add, clear, h } from './dom';
import { createSheet } from './sheet';

export interface GoalSheetResult {
  goal: BookGoal;
  /** Chapitres utiles à l'objectif (vide : tout le livre). */
  focus: number[];
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { className: 'field' }, h('span', { className: 'field-label' }, label), hint ? h('span', { className: 'hint' }, hint) : null, control);
}

/**
 * « Mon objectif pour ce livre » : cinq questions avant de lire, toutes facultatives, puis les
 * chapitres utiles. Résout avec l'objectif, ou null si le panneau est fermé sans enregistrer.
 */
export function goalSheet(options: { bookTitle: string; goal: BookGoal | null; chapters: Pick<Chapter, 'label' | 'depth'>[]; focus: number[] }): Promise<GoalSheetResult | null> {
  return new Promise((resolve) => {
    let result: GoalSheetResult | null = null;
    let kind: GoalKind | null = options.goal?.kind ?? null;
    const sheet = createSheet({
      title: 'Mon objectif pour ce livre',
      kind: 'full',
      testId: 'goal-sheet',
      onClose: () => {
        sheet.el.remove();
        resolve(result);
      },
    });
    const g = options.goal;
    const area = (testId: string, value: string, placeholder: string, rows = 2) => {
      const el = h('textarea', { className: 'input textarea', rows, 'data-testid': testId, placeholder });
      el.value = value;
      return el;
    };
    const about = area('goal-about', g?.about ?? '', 'Je pense que ce livre explique…');
    const why = area('goal-why', g?.why ?? '', 'Pour…');
    const capable = h('input', { type: 'text', className: 'input', 'data-testid': 'goal-capable', placeholder: 'expliquer…, réaliser…, décider…' });
    capable.value = g?.capable ?? '';
    const known = area('goal-known', g?.known ?? '', 'Quelques idées, des mots-clés, ou « rien du tout ».');
    const verbs = h('div', { className: 'chips', 'aria-label': 'Verbes d’action' });
    const error = h('p', { className: 'form-error', role: 'alert', hidden: true });

    function renderVerbs(): void {
      clear(verbs);
      for (const verb of GOAL_KINDS.find((k) => k.id === kind)?.verbs ?? []) {
        verbs.append(h('button', {
          type: 'button', className: 'chip', 'data-testid': 'goal-verb',
          onclick: () => {
            // Remplace le verbe déjà choisi s'il y en a un, sinon commence la phrase.
            const rest = capable.value.replace(/^\s*\S+/, (w) => (GOAL_KINDS.some((k) => k.verbs.includes(w.toLowerCase())) ? '' : w)).trimStart();
            capable.value = `${verb} ${rest}`.trimEnd() + (rest ? '' : ' ');
            capable.focus();
            capable.setSelectionRange(capable.value.length, capable.value.length);
          },
        }, verb));
      }
      verbs.hidden = !verbs.childElementCount;
    }

    const kinds = h('div', { className: 'goal-kinds', role: 'radiogroup', 'aria-label': 'Ce que je veux en retirer' });
    for (const k of GOAL_KINDS) {
      const input = h('input', { type: 'radio', name: 'goal-kind', id: `goal-kind-${k.id}`, value: k.id, className: 'visually-hidden', checked: kind === k.id });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        kind = k.id;
        renderVerbs();
      });
      kinds.append(input, h('label', { for: `goal-kind-${k.id}`, className: 'ambiance-option', 'data-testid': `goal-kind-${k.id}` }, h('strong', {}, k.label), h('small', {}, k.detail)));
    }

    const chosen = new Set(options.focus);
    const chapterChecks = options.chapters.map((c, i) => {
      const box = h('input', { type: 'checkbox', checked: chosen.has(i), 'data-testid': 'goal-chapter' });
      return { box, row: h('label', { className: `check${c.depth ? ' goal-sub' : ''}` }, box, h('span', {}, c.label)) };
    });

    const save = h('button', {
      type: 'button', className: 'btn btn-primary', 'data-testid': 'goal-save',
      onclick: () => {
        const now = Date.now();
        const goal: BookGoal = {
          about: about.value.trim(), why: why.value.trim(), kind, capable: capable.value.trim().replace(/^(je serai )?capable de\s+/i, ''), known: known.value.trim(),
          at: g?.at ?? now, updatedAt: now,
        };
        if (isGoalEmpty(goal)) {
          error.hidden = false;
          error.textContent = 'Réponds au moins à une question, ou ferme ce panneau.';
          return;
        }
        result = { goal, focus: chapterChecks.flatMap((c, i) => (c.box.checked ? [i] : [])) };
        sheet.close();
      },
    }, 'Enregistrer mon objectif');

    renderVerbs();
    add(sheet.body,
      h('p', { className: 'hint' }, `Cinq questions pour lire « ${options.bookTitle} » avec un but. Aucune n’est obligatoire, et tu pourras tout modifier depuis le sommaire.`),
      field('1. De quoi parle ce livre, d’après toi ?', about, 'Regarde le titre, le sommaire, l’introduction et fais une hypothèse : tu la compareras à la fin.'),
      field('2. Pourquoi je le lis ? À quoi va-t-il me servir ?', why, 'Dans ta vie, ton travail, tes études…'),
      h('div', { className: 'field' }, h('span', { className: 'field-label' }, '3. Ce que je veux en retirer'), kinds),
      h('div', { className: 'field' },
        h('label', { className: 'field-label', for: 'goal-capable-input' }, '4. À la fin, je serai capable de…'),
        verbs,
        capable,
      ),
      field('5. Ce que je sais déjà sur le sujet', known, 'Faire le point sur ce qu’on sait prépare le cerveau à relier le nouveau à l’ancien.'),
      options.chapters.length > 1
        ? h('details', { className: 'data-section', 'data-testid': 'goal-chapters' },
            h('summary', {}, 'Chapitres utiles à cet objectif (facultatif)'),
            h('p', { className: 'hint' }, 'Tu n’es pas obligé de tout lire. Aucun chapitre coché : tout le livre compte.'),
            h('div', { className: 'goal-chapter-list' }, ...chapterChecks.map((c) => c.row)),
          )
        : null,
      error,
      h('div', { className: 'sheet-actions' }, save),
    );
    capable.id = 'goal-capable-input';
    sheet.open();
    (g ? save : about).focus();
  });
}
