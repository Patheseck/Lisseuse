import { cardStatus } from '../core/card-filters';
import { errorMessage, logError } from '../core/errors';
import { cardTemplates } from '../core/goal';
import { hasMnemonic, hintText, nextFreeNumber } from '../core/mnemonic';
import { GRADE_LABELS, newSrs, retrievability } from '../core/scheduler';
import { deleteCard, demoteCard, putCard, type CardRecord, type ReviewRecord } from '../storage/cards';
import { loadGoal } from '../storage/method';
import { loadMojorTable } from '../storage/settings';
import { editCard } from './card-editor';
import { add, h } from './dom';
import { confirmDialog, toast } from './feedback';
import { icon } from './icons';
import { formatDue } from './review';
import type { Navigate } from './screen';
import { createSheet, type Sheet } from './sheet';

export interface CardDetailContext {
  bookTitle: string;
  chapterLabel: string;
  /** Le livre est dans la bibliothèque (sinon : pas d'accès au passage). */
  bookExists: boolean;
  reviews: ReviewRecord[];
  allCards: CardRecord[];
  navigate: Navigate;
  /** Fiche modifiée (ou null si supprimée) : la liste se met à jour. */
  onChange: (card: CardRecord | null) => void;
}

const dateFr = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Détail d'une fiche : contenu, historique, mémorisation estimée et actions. */
export function cardDetailSheet(initial: CardRecord, ctx: CardDetailContext): Sheet {
  let card = initial;
  const sheet = createSheet({ title: 'Fiche', kind: 'full', testId: 'card-detail' });

  async function save(next: CardRecord, message: string): Promise<void> {
    try {
      await putCard(next);
      card = next;
      ctx.onChange(next);
      render();
      toast(message);
    } catch (err) {
      logError('fiche', err);
      toast(`Enregistrement impossible : ${errorMessage(err)}`, 'error');
    }
  }

  async function edit(): Promise<void> {
    const [mojor, goal] = await Promise.all([loadMojorTable().catch(() => new Map()), loadGoal(card.bookId).catch(() => null)]);
    const edited = await editCard(card, {
      mojor,
      suggestedNumber: nextFreeNumber(ctx.allCards.filter((c) => c.bookId === card.bookId).map((c) => c.mnemonic?.number)),
      otherQuestions: ctx.allCards.filter((c) => c.kind !== 'highlight' && c.id !== card.id).map((c) => c.question),
      templates: cardTemplates(goal?.kind),
    });
    if (!edited) return;
    try {
      if (edited.action === 'demote') await demoteCard(edited.card);
      else await putCard(edited.card);
      card = edited.card;
      ctx.onChange(card);
      render();
    } catch (err) {
      logError('fiche', err);
      toast(`Enregistrement impossible : ${errorMessage(err)}`, 'error');
    }
  }

  async function reset(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Recommencer cette fiche à zéro ?',
      message: 'Elle redeviendra une nouvelle fiche, à réapprendre. Son historique de révisions est conservé.',
      confirmLabel: 'Recommencer',
    });
    if (ok) await save({ ...card, srs: newSrs(), updatedAt: Date.now() }, 'Fiche remise à zéro.');
  }

  async function remove(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Supprimer cette fiche ?',
      message: card.kind === 'highlight' ? 'Le surlignage sera retiré du livre.' : 'La fiche, son surlignage et son historique de révisions seront supprimés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCard(card.id);
      ctx.onChange(null);
      sheet.close();
      toast('Fiche supprimée.');
    } catch (err) {
      logError('fiche', err);
      toast(`Suppression impossible : ${errorMessage(err)}`, 'error');
    }
  }

  function history(): HTMLElement | null {
    const srs = card.srs;
    if (card.kind === 'highlight' || !srs) return null;
    const reviews = [...ctx.reviews].sort((a, b) => b.at - a.at);
    const success = reviews.filter((r) => r.grade >= 3).length;
    const now = Date.now();
    const memory = Math.round(retrievability(srs, now) * 100);
    return h('section', { className: 'data-section', 'data-testid': 'detail-history' },
      h('h3', {}, 'Historique'),
      h('dl', { className: 'detail-facts' },
        h('dt', {}, 'Révisions'), h('dd', {}, reviews.length ? `${reviews.length} (${success} réussie${success > 1 ? 's' : ''})` : 'aucune'),
        h('dt', {}, 'Oubliée'), h('dd', {}, `${srs.lapses} fois`),
        reviews[0] ? h('dt', {}, 'Dernière') : null, reviews[0] ? h('dd', {}, dateFr(reviews[0].at)) : null,
        h('dt', {}, 'Prochaine'), h('dd', { 'data-testid': 'detail-next' }, card.suspended ? 'en pause' : srs.reps === 0 && srs.state === 0 ? 'dès la prochaine séance (nouvelle)' : formatDue(srs.due, now)),
        srs.state !== 0 ? h('dt', {}, 'Mémorisation') : null,
        srs.state !== 0 ? h('dd', { 'data-testid': 'detail-memory' }, `${memory} % de chances de t’en souvenir aujourd’hui`) : null,
      ),
      reviews.length
        ? h('ol', { className: 'detail-log' }, ...reviews.slice(0, 6).map((r) => h('li', {}, `${dateFr(r.at)} — ${GRADE_LABELS[r.grade]}`)))
        : null,
    );
  }

  function render(): void {
    sheet.body.replaceChildren();
    const status = cardStatus(card, Date.now());
    const reviewable = card.kind !== 'highlight' && !!card.srs;
    add(sheet.body,
      h('p', { className: 'review-chapter', 'data-testid': 'detail-where' }, ctx.chapterLabel),
      h('p', { className: 'review-book' }, h('span', { className: `card-status tone-${status.tone}` }, status.label), ` ${ctx.bookTitle}`),
      card.kind === 'highlight'
        ? null
        : h('h2', { className: 'review-question', 'data-testid': 'detail-question' }, card.question),
      card.kind === 'qa' ? h('div', { className: 'review-block review-block-answer', 'data-testid': 'detail-answer' }, h('span', { className: 'field-label' }, 'Réponse'), h('div', { className: 'review-answer' }, card.answer)) : null,
      card.kind === 'sequence' ? h('div', { className: 'review-block review-block-answer', 'data-testid': 'detail-answer' }, h('span', { className: 'field-label' }, 'Étapes'), h('ol', { className: 'review-answer' }, ...card.steps.map((s) => h('li', {}, s)))) : null,
      card.origin === 'guide' || !card.anchor.quote ? null : h('blockquote', { className: 'passage', 'data-testid': 'detail-passage' }, card.anchor.quote),
      hasMnemonic(card.mnemonic) ? h('p', { className: 'review-hint' }, hintText(card.mnemonic)) : null,
      history(),
      h('div', { className: 'detail-actions' },
        h('button', { type: 'button', className: 'btn', 'data-testid': 'card-edit', onclick: () => void edit() }, icon('card'), card.kind === 'highlight' ? 'Créer une fiche' : 'Modifier'),
        reviewable
          ? h('button', {
              type: 'button', className: 'btn btn-primary', 'data-testid': 'card-review-now', disabled: !!card.suspended,
              onclick: () => { sheet.close(); ctx.navigate({ name: 'review', cardIds: [card.id], back: 'cards' }); },
            }, icon('review'), 'Réviser maintenant')
          : null,
        h('button', {
          type: 'button', className: 'btn', 'data-testid': 'card-goto', disabled: !ctx.bookExists,
          onclick: () => { sheet.close(); ctx.navigate({ name: 'reader', bookId: card.bookId, cardId: card.id }); },
        }, icon('toc'), 'Aller au passage'),
        reviewable
          ? h('button', {
              type: 'button', className: 'btn', 'data-testid': 'card-pause',
              onclick: () => void save({ ...card, suspended: !card.suspended, updatedAt: Date.now() }, card.suspended ? 'La fiche revient dans tes révisions.' : 'Fiche en pause : elle ne te sera plus proposée.'),
            }, icon(card.suspended ? 'play' : 'pause'), card.suspended ? 'Reprendre' : 'Mettre en pause')
          : null,
        reviewable ? h('button', { type: 'button', className: 'btn', 'data-testid': 'card-reset', onclick: () => void reset() }, icon('review'), 'Recommencer à zéro') : null,
        h('button', { type: 'button', className: 'btn btn-danger', 'data-testid': 'card-delete', onclick: () => void remove() }, icon('trash'), 'Supprimer'),
      ),
      ctx.bookExists ? null : h('p', { className: 'hint' }, 'Le livre de cette fiche n’est plus dans la bibliothèque : réimporte-le pour retrouver le passage.'),
    );
  }

  sheet.el.addEventListener('close', () => sheet.el.remove());
  render();
  return sheet;
}
