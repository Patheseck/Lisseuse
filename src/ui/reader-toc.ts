import type { CardRecord } from '../storage/cards';
import type { Bookmark } from '../storage/method';
import { clear, h } from './dom';
import { icon } from './icons';
import { createSheet, type Sheet } from './sheet';

export interface TocOptions {
  labels: () => string[];
  current: () => number;
  cards: () => CardRecord[];
  /** Ids des surlignages dont le passage n'a pas été retrouvé dans le texte. */
  orphans: () => Set<string>;
  onChapter: (index: number) => void;
  onCard: (card: CardRecord) => void;
  onEditCard: (card: CardRecord) => void;
  onDeleteCard: (card: CardRecord) => void;
  /** Chapitres choisis pour l'objectif de lecture (vide = tout le livre). */
  focus: () => number[];
  onToggleFocus: (index: number) => void;
  onClearFocus: () => void;
  bookmarks: () => Bookmark[];
  onBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
}

/** Tiroir latéral : sommaire (et chapitres choisis), surlignages et signets du livre. */
export function readerTocSheet(o: TocOptions): Sheet & { refresh(): void } {
  let tab: 'chapters' | 'highlights' | 'bookmarks' = 'chapters';
  const tabs = h('div', { className: 'tabs', role: 'tablist' });
  const panel = h('div', { className: 'toc-panel', role: 'tabpanel' });
  const sheet = createSheet({ title: 'Sommaire', kind: 'side', testId: 'toc-sheet' });
  sheet.body.append(tabs, panel);

  function tabButton(id: typeof tab, label: string): HTMLButtonElement {
    return h('button', {
      type: 'button', role: 'tab', className: 'tab', 'aria-selected': String(tab === id),
      onclick: () => { tab = id; refresh(); },
    }, label);
  }

  function refresh(): void {
    const cards = o.cards();
    clear(tabs);
    const bookmarks = o.bookmarks();
    tabs.append(tabButton('chapters', 'Chapitres'), tabButton('highlights', `Passages (${cards.length})`), tabButton('bookmarks', `Signets (${bookmarks.length})`));
    clear(panel);
    if (tab === 'chapters') {
      const focus = new Set(o.focus());
      panel.append(h('p', { className: 'hint toc-focus-hint', 'data-testid': 'focus-hint' },
        focus.size
          ? `${focus.size} chapitre${focus.size > 1 ? 's' : ''} choisi${focus.size > 1 ? 's' : ''} pour ton objectif : la progression ne compte qu’eux. `
          : 'Tu n’es pas obligé de tout lire : coche les chapitres utiles à ton objectif, la progression ne comptera qu’eux.',
        focus.size ? h('button', { type: 'button', className: 'link-btn', 'data-testid': 'focus-clear', onclick: () => { o.onClearFocus(); refresh(); } }, 'Tout le livre') : null,
      ));
      const list = h('ol', { className: 'toc-list' });
      o.labels().forEach((label, i) => {
        const chosen = focus.has(i);
        list.append(h('li', { className: `toc-row${focus.size && !chosen ? ' toc-out' : ''}` },
          h('button', {
            type: 'button', className: 'toc-item', 'aria-current': i === o.current() ? 'page' : null,
            onclick: () => { sheet.close(); o.onChapter(i); },
          }, label),
          h('button', {
            type: 'button', className: 'icon-btn toc-focus', 'aria-pressed': String(chosen), 'data-testid': 'toc-focus',
            'aria-label': `${chosen ? 'Retirer de' : 'Ajouter à'} mon objectif : ${label}`,
            onclick: () => { o.onToggleFocus(i); refresh(); },
          }, icon(chosen ? 'target' : 'circle')),
        ));
      });
      panel.append(list);
      requestAnimationFrame(() => list.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' }));
      return;
    }
    if (tab === 'bookmarks') {
      if (!bookmarks.length) {
        panel.append(h('p', { className: 'muted toc-empty' }, 'Aucun signet. Pendant la lecture, affiche les menus et touche l’icône signet pour marquer la page.'));
        return;
      }
      const list = h('ul', { className: 'hl-list' });
      for (const b of bookmarks) {
        list.append(h('li', { className: 'hl-item', 'data-testid': 'bookmark-item' },
          h('button', { type: 'button', className: 'hl-open', onclick: () => { sheet.close(); o.onBookmark(b); } },
            h('span', { className: 'hl-chapter' }, `${o.labels()[b.chapter] ?? `Chapitre ${b.chapter + 1}`} · ${Math.round(b.offset * 100)} %`),
            h('span', { className: 'hl-quote bm-quote' }, b.label || '…'),
          ),
          h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Supprimer ce signet', 'data-testid': 'bookmark-delete', onclick: () => { o.onDeleteBookmark(b); } }, icon('trash')),
        ));
      }
      panel.append(list);
      return;
    }
    if (!cards.length) {
      panel.append(h('p', { className: 'muted toc-empty' }, 'Sélectionne un passage dans le texte, puis touche « Surligner » ou « Créer une fiche » pour le retrouver ici.'));
      return;
    }
    const orphans = o.orphans();
    const list = h('ul', { className: 'hl-list' });
    for (const card of cards) {
      list.append(h('li', { className: 'hl-item', 'data-testid': 'highlight-item' },
        h('button', { type: 'button', className: 'hl-open', onclick: () => { sheet.close(); o.onCard(card); } },
          h('span', { className: 'hl-chapter' }, o.labels()[card.chapter] ?? `Chapitre ${card.chapter + 1}`, orphans.has(card.id) ? ' · passage introuvable' : ''),
          h('span', { className: 'hl-quote' }, card.anchor.quote.length > 220 ? `${card.anchor.quote.slice(0, 220)}…` : card.anchor.quote),
          card.kind !== 'highlight' ? h('span', { className: 'hl-question' }, h('span', { className: 'pill' }, 'Fiche'), card.question) : null,
        ),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': card.kind === 'highlight' ? 'Créer une fiche' : 'Modifier la fiche', 'data-testid': 'toc-edit-card', onclick: () => { sheet.close(); o.onEditCard(card); } }, icon('card')),
        h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retirer ce surlignage', onclick: () => o.onDeleteCard(card) }, icon('trash')),
      ));
    }
    panel.append(list);
  }

  const open = sheet.open.bind(sheet);
  return Object.assign(sheet, {
    open() {
      refresh();
      open();
    },
    refresh,
  });
}
