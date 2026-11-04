import { cardStatus, filterCards, sortCards, summarize, type CardFilters, type CardSort, type CardStateFilter, type CardType } from '../core/card-filters';
import { errorMessage, logError } from '../core/errors';
import { listAllCards, listReviews, type CardRecord, type ReviewRecord } from '../storage/cards';
import { listBooks, type BookRecord } from '../storage/library';
import { cardDetailSheet } from './card-detail';
import { add, clear, h } from './dom';
import { icon } from './icons';
import type { Navigate, Screen } from './screen';

const PAGE = 60;

const TYPES: [CardType, string][] = [['all', 'Tous les types'], ['qa', 'Questions'], ['sequence', 'Étapes'], ['guide', 'Questions directrices'], ['highlight', 'Passages surlignés']];
const STATES: [CardStateFilter, string][] = [['all', 'Toutes'], ['due', 'À revoir'], ['new', 'Nouvelles'], ['difficult', 'Difficiles'], ['mastered', 'Maîtrisées'], ['paused', 'En pause']];
const SORTS: [CardSort, string][] = [['book', 'Ordre du livre'], ['recent', 'Plus récentes'], ['due', 'Prochaine révision'], ['difficult', 'Plus difficiles']];

/**
 * « Mes fiches » : toutes les fiches de tous les livres, sans ouvrir de livre. Recherche,
 * filtres (livre, type, état), tris ; chaque fiche s'ouvre en détail avec ses actions.
 */
export function cardsScreen(navigate: Navigate, presetBook?: string): Screen {
  let cards: CardRecord[] = [];
  let reviews: ReviewRecord[] = [];
  let books: BookRecord[] = [];
  const filters: CardFilters = { book: presetBook ?? 'all', type: 'all', state: 'all', query: '' };
  let sort: CardSort = 'book';
  let shown = PAGE;
  let detail: ReturnType<typeof cardDetailSheet> | null = null;

  const summary = h('p', { className: 'muted cards-summary', 'data-testid': 'cards-summary' }, 'Chargement…');
  const search = h('input', { type: 'search', className: 'input', placeholder: 'Rechercher dans les questions, réponses, passages…', 'aria-label': 'Rechercher dans mes fiches', 'data-testid': 'cards-search' });
  const bookSelect = h('select', { className: 'input', 'aria-label': 'Livre', 'data-testid': 'filter-book' });
  const typeSelect = h('select', { className: 'input', 'aria-label': 'Type de fiche', 'data-testid': 'filter-type' }, ...TYPES.map(([v, l]) => h('option', { value: v }, l)));
  const sortSelect = h('select', { className: 'input', 'aria-label': 'Trier', 'data-testid': 'cards-sort' }, ...SORTS.map(([v, l]) => h('option', { value: v }, l)));
  const states = h('div', { className: 'cards-states', role: 'radiogroup', 'aria-label': 'État des fiches' });
  const list = h('ul', { className: 'cards-list', 'data-testid': 'cards-list' });
  const more = h('button', { type: 'button', className: 'btn wide-btn', 'data-testid': 'cards-more', hidden: true, onclick: () => { shown += PAGE; renderList(); } });
  const body = h('div', { className: 'cards-body' },
    summary,
    search,
    h('div', { className: 'cards-filters' }, bookSelect, typeSelect, sortSelect),
    states,
    list,
    more,
  );
  const el = h('div', { className: 'screen cards' },
    h('header', { className: 'topbar' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'cards-back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('h1', { className: 'topbar-title' }, 'Mes fiches'),
    ),
    h('main', { className: 'scroll' }, body),
  );

  let searchTimer: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      filters.query = search.value;
      shown = PAGE;
      renderList();
    }, 150);
  });
  bookSelect.addEventListener('change', () => { filters.book = bookSelect.value; shown = PAGE; renderStates(); renderList(); });
  typeSelect.addEventListener('change', () => { filters.type = typeSelect.value as CardType; shown = PAGE; renderStates(); renderList(); });
  sortSelect.addEventListener('change', () => { sort = sortSelect.value as CardSort; shown = PAGE; renderList(); });

  const titleOf = (bookId: string) => books.find((b) => b.id === bookId)?.title ?? 'Livre absent de la bibliothèque';
  const chapterOf = (card: CardRecord) => books.find((b) => b.id === card.bookId)?.chapterLabels?.[card.chapter] ?? `Chapitre ${card.chapter + 1}`;

  function renderStates(): void {
    const now = Date.now();
    const base = { ...filters, state: 'all' as CardStateFilter };
    clear(states);
    for (const [value, label] of STATES) {
      const count = filterCards(cards, { ...base, state: value }, now).length;
      const input = h('input', { type: 'radio', name: 'cards-state', id: `cards-state-${value}`, value, className: 'visually-hidden', checked: filters.state === value });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        filters.state = value;
        shown = PAGE;
        renderList();
      });
      states.append(input, h('label', { for: `cards-state-${value}`, className: 'chip', 'data-testid': `cards-state-${value}` }, label, h('small', {}, ` ${count}`)));
    }
  }

  function row(card: CardRecord, grouped: boolean, now: number): HTMLElement {
    const status = cardStatus(card, now);
    const highlight = card.kind === 'highlight';
    const text = highlight ? card.anchor.quote : card.question;
    return h('li', { className: 'card-row', 'data-testid': 'card-row' },
      h('button', { type: 'button', className: 'card-open', onclick: () => openDetail(card) },
        h('span', { className: `card-row-text${highlight ? ' is-quote' : ''}` }, text.length > 180 ? `${text.slice(0, 180)}…` : text),
        h('span', { className: 'card-row-meta' },
          grouped ? null : h('span', { className: 'card-row-where' }, `${titleOf(card.bookId)} · ${chapterOf(card)}`),
          h('span', { className: `card-status tone-${status.tone}`, 'data-testid': 'card-status' }, status.label),
        ),
      ),
    );
  }

  function renderList(): void {
    const now = Date.now();
    const order = books.map((b) => b.id);
    const result = sortCards(filterCards(cards, filters, now), sort, order);
    clear(list);
    if (!cards.length) {
      list.append(h('li', { className: 'cards-empty', 'data-testid': 'cards-empty' },
        h('strong', {}, 'Aucune fiche pour l’instant.'),
        h('span', { className: 'muted' }, 'Dans un livre, sélectionne un passage puis « Fiche » : tes fiches se retrouvent toutes ici.'),
      ));
      more.hidden = true;
      return;
    }
    if (!result.length) list.append(h('li', { className: 'muted cards-empty', 'data-testid': 'cards-empty' }, 'Aucune fiche ne correspond.'));
    const grouped = sort === 'book';
    let lastGroup = '';
    for (const card of result.slice(0, shown)) {
      if (grouped) {
        const group = `${card.bookId}|${card.chapter}`;
        if (group !== lastGroup) {
          lastGroup = group;
          list.append(h('li', { className: 'cards-group', 'data-testid': 'cards-group' }, h('strong', {}, titleOf(card.bookId)), ` · ${chapterOf(card)}`));
        }
      }
      list.append(row(card, grouped, now));
    }
    more.hidden = result.length <= shown;
    more.textContent = `Afficher les suivantes (${result.length - shown})`;
  }

  function renderSummary(): void {
    const s = summarize(cards, Date.now());
    summary.textContent = [
      `${s.questions} fiche${s.questions > 1 ? 's' : ''}`,
      `${s.dueToday} à revoir aujourd’hui`,
      `${s.mastered} maîtrisée${s.mastered > 1 ? 's' : ''}`,
      s.highlights ? `${s.highlights} passage${s.highlights > 1 ? 's' : ''} surligné${s.highlights > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ');
  }

  function openDetail(card: CardRecord): void {
    detail?.el.remove();
    detail = cardDetailSheet(card, {
      bookTitle: titleOf(card.bookId),
      chapterLabel: chapterOf(card),
      bookExists: books.some((b) => b.id === card.bookId),
      reviews: reviews.filter((r) => r.cardId === card.id),
      allCards: cards,
      navigate,
      onChange: (updated) => {
        cards = updated ? cards.map((c) => (c.id === card.id ? updated : c)) : cards.filter((c) => c.id !== card.id);
        renderSummary();
        renderStates();
        renderList();
      },
    });
    detail.open();
  }

  async function load(): Promise<void> {
    [cards, reviews, books] = await Promise.all([listAllCards(), listReviews(), listBooks()]);
    const withCards = books.filter((b) => cards.some((c) => c.bookId === b.id));
    clear(bookSelect);
    add(bookSelect,
      h('option', { value: 'all' }, 'Tous les livres'),
      ...withCards.map((b) => h('option', { value: b.id }, b.title)),
    );
    if (filters.book !== 'all' && !withCards.some((b) => b.id === filters.book)) filters.book = 'all';
    bookSelect.value = filters.book;
    renderSummary();
    renderStates();
    renderList();
  }

  load().catch((err: unknown) => {
    logError('fiches', err);
    clear(list);
    list.append(h('li', { className: 'error-box' }, `Tes fiches n’ont pas pu être chargées : ${errorMessage(err)}`));
  });

  return {
    el,
    destroy() {
      window.clearTimeout(searchTimer);
      detail?.el.remove();
    },
  };
}
