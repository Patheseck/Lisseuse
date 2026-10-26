import { newSrs } from '../core/scheduler';
import type { CardKind, CardRecord } from '../storage/cards';
import { h } from './dom';
import { createSheet } from './sheet';

// Modèles de questions favorisant l'élaboration (« pourquoi », « quelle différence »…).
const TEMPLATES: { label: string; text: string }[] = [
  { label: 'Pourquoi… ?', text: 'Pourquoi ' },
  { label: 'Qu’est-ce que… ?', text: 'Qu’est-ce que ' },
  { label: 'Quelle différence… ?', text: 'Quelle est la différence entre  et  ?' },
  { label: 'Comment… ?', text: 'Comment ' },
  { label: 'Idée principale', text: 'Quelle est l’idée principale de ce passage ?' },
];
const SEQUENCE_QUESTION = 'Quelles sont les étapes, dans l’ordre ?';

export interface CardEditorResult {
  action: 'save' | 'demote';
  card: CardRecord;
}

/** Découpe un passage en étapes : lignes de liste si présentes, sinon phrases. */
export function splitSteps(text: string): string[] {
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-•–*])\s*/, '').trim()).filter(Boolean);
  if (lines.length >= 2) return lines;
  return (text.match(/[^.!?;]+[.!?;]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Feuille de création / modification d'une fiche à partir d'un passage surligné.
 * Résout avec la fiche à enregistrer, ou null si l'utilisateur annule.
 */
export function editCard(source: CardRecord): Promise<CardEditorResult | null> {
  const isCard = source.kind !== 'highlight';
  let kind: Exclude<CardKind, 'highlight'> = source.kind === 'sequence' ? 'sequence' : 'qa';

  return new Promise((resolve) => {
    let result: CardEditorResult | null = null;
    const sheet = createSheet({
      title: isCard ? 'Modifier la fiche' : 'Nouvelle fiche',
      kind: 'bottom',
      testId: 'card-editor',
      onClose: () => {
        sheet.el.remove();
        resolve(result);
      },
    });

    const question = h('textarea', { className: 'input textarea', rows: 2, 'aria-label': 'Question', 'data-testid': 'card-question', placeholder: 'La question que l’app te posera…' });
    question.value = source.question || (kind === 'sequence' ? SEQUENCE_QUESTION : '');
    const answer = h('textarea', { className: 'input textarea', rows: 3, 'aria-label': 'Réponse', 'data-testid': 'card-answer', placeholder: 'La réponse, formulée avec tes mots…' });
    answer.value = source.answer;
    const steps = h('textarea', { className: 'input textarea', rows: 5, 'aria-label': 'Étapes, une par ligne', 'data-testid': 'card-steps', placeholder: 'Une étape par ligne' });
    steps.value = source.steps.join('\n');
    const error = h('p', { className: 'form-error', role: 'alert', hidden: true });

    const chips = h('div', { className: 'chips' });
    for (const t of TEMPLATES) {
      chips.append(h('button', {
        type: 'button', className: 'chip',
        onclick: () => {
          question.value = t.text;
          question.focus();
          const gap = t.text.indexOf('  ');
          const pos = gap >= 0 ? gap + 1 : t.text.length;
          question.setSelectionRange(pos, pos);
        },
      }, t.label));
    }
    const fromPassage = (target: 'answer' | 'steps') => h('button', {
      type: 'button', className: 'link-btn',
      onclick: () => {
        if (target === 'answer') answer.value = source.anchor.quote;
        else steps.value = splitSteps(source.anchor.quote).join('\n');
      },
    }, 'Reprendre le passage');

    const qaFields = h('div', { className: 'field-group' },
      h('div', { className: 'field' }, h('span', { className: 'field-label' }, 'Réponse'), answer, fromPassage('answer')),
    );
    const seqFields = h('div', { className: 'field-group' },
      h('div', { className: 'field' }, h('span', { className: 'field-label' }, 'Étapes, une par ligne'), steps, fromPassage('steps')),
    );

    const kindSwitch = h('div', { className: 'segmented', role: 'radiogroup', 'aria-label': 'Type de fiche' });
    const syncKind = () => {
      qaFields.hidden = kind !== 'qa';
      seqFields.hidden = kind !== 'sequence';
      chips.hidden = kind !== 'qa';
    };
    for (const [value, label] of [['qa', 'Question-réponse'], ['sequence', 'Étapes dans l’ordre']] as const) {
      const input = h('input', { type: 'radio', name: 'card-kind', id: `card-kind-${value}`, value, className: 'visually-hidden', checked: kind === value });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        kind = value;
        if (kind === 'sequence' && !question.value.trim()) question.value = SEQUENCE_QUESTION;
        if (kind === 'qa' && question.value === SEQUENCE_QUESTION) question.value = '';
        syncKind();
      });
      kindSwitch.append(input, h('label', { for: `card-kind-${value}` }, label));
    }
    syncKind();

    const save = () => {
      const q = question.value.trim();
      const a = answer.value.trim();
      const s = steps.value.split('\n').map((x) => x.trim()).filter(Boolean);
      const problem = !q ? 'Écris la question.' : kind === 'qa' && !a ? 'Écris la réponse.' : kind === 'sequence' && s.length < 2 ? 'Indique au moins deux étapes.' : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      const now = Date.now();
      result = {
        action: 'save',
        card: {
          ...source,
          kind,
          question: q,
          answer: kind === 'qa' ? a : '',
          steps: kind === 'sequence' ? s : [],
          srs: source.srs ?? newSrs(now),
          updatedAt: now,
        },
      };
      sheet.close();
    };

    sheet.body.append(
      h('blockquote', { className: 'passage' }, source.anchor.quote),
      kindSwitch,
      h('div', { className: 'field' }, h('span', { className: 'field-label' }, 'Question'), chips, question),
      qaFields,
      seqFields,
      h('p', { className: 'hint' }, 'Formuler toi-même la question et la réponse aide déjà à retenir.'),
      error,
      h('div', { className: 'sheet-actions' },
        isCard
          ? h('button', {
            type: 'button', className: 'btn btn-quiet', 'data-testid': 'card-demote',
            onclick: () => {
              result = { action: 'demote', card: { ...source, kind: 'highlight', question: '', answer: '', steps: [], srs: null, updatedAt: Date.now() } };
              sheet.close();
            },
          }, 'Supprimer la fiche')
          : null,
        h('button', { type: 'button', className: 'btn', onclick: () => sheet.close() }, 'Annuler'),
        h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'card-save', onclick: save }, 'Enregistrer'),
      ),
    );
    sheet.open();
    (kind === 'qa' && !question.value ? question : kind === 'sequence' ? steps : answer).focus();
  });
}
