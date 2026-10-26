import type { CardRecord } from '../storage/cards';
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
}

/** Tiroir latéral : sommaire et liste des surlignages du livre. */
export function readerTocSheet(o: TocOptions): Sheet & { refresh(): void } {
  let tab: 'chapters' | 'highlights' = 'chapters';
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
    tabs.append(tabButton('chapters', 'Chapitres'), tabButton('highlights', `Passages (${cards.length})`));
    clear(panel);
    if (tab === 'chapters') {
      const list = h('ol', { className: 'toc-list' });
      o.labels().forEach((label, i) => {
        list.append(h('li', {},
          h('button', {
            type: 'button', className: 'toc-item', 'aria-current': i === o.current() ? 'page' : null,
            onclick: () => { sheet.close(); o.onChapter(i); },
          }, label),
        ));
      });
      panel.append(list);
      requestAnimationFrame(() => list.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' }));
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
