import { linkSentence, RELATIONS, sameLink, shortIdea, type IdeaLink, type RelationId } from '../core/ideas';
import { add, clear, h } from './dom';

/**
 * « Relier tes idées » : choisir deux idées et la relation qui les unit. `links` est modifié
 * sur place ; `onChange` prévient à chaque ajout ou retrait.
 */
export function linkBuilder(options: { pool: string[]; links: IdeaLink[]; onChange?: () => void }): HTMLElement {
  const { pool, links } = options;
  const select = (testId: string, label: string, items: [string, string][]) =>
    h('select', { className: 'input', 'aria-label': label, 'data-testid': testId }, ...items.map(([v, l]) => h('option', { value: v }, l)));
  const ideaOptions = pool.map((idea, i): [string, string] => [String(i), shortIdea(idea, 70)]);
  const from = select('link-from', 'Première idée', ideaOptions);
  const relation = select('link-relation', 'Relation', RELATIONS.map((r): [string, string] => [r.id, `${r.label} (${r.hint})`]));
  const to = select('link-to', 'Seconde idée', ideaOptions);
  if (pool.length > 1) to.value = '1';
  const list = h('ul', { className: 'link-list', 'data-testid': 'link-list' });
  const message = h('p', { className: 'form-error', role: 'alert', hidden: true });

  function render(): void {
    clear(list);
    links.forEach((link, i) => list.append(h('li', { className: 'link-item', 'data-testid': 'link-item' },
      h('span', {}, linkSentence({ ...link, from: shortIdea(link.from, 50), to: shortIdea(link.to, 50) })),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retirer ce lien', onclick: () => { links.splice(i, 1); render(); options.onChange?.(); } }, '×'),
    )));
  }

  const box = h('div', { className: 'link-builder-box' });
  add(box,
    h('div', { className: 'link-builder' }, from, relation, to,
      h('button', {
        type: 'button', className: 'btn', 'data-testid': 'link-add',
        onclick: () => {
          const link: IdeaLink = { from: pool[Number(from.value)]!, relation: relation.value as RelationId, to: pool[Number(to.value)]! };
          message.hidden = true;
          if (link.from === link.to) {
            message.hidden = false;
            message.textContent = 'Choisis deux idées différentes.';
            return;
          }
          if (!links.some((l) => sameLink(l, link))) links.push(link);
          render();
          options.onChange?.();
        },
      }, '+ Ajouter ce lien'),
    ),
    message,
    list,
  );
  render();
  return box;
}
