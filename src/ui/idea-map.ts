import { applyPrompt, goalSummary, type BookGoal } from '../core/goal';
import { chapterHasIdeas, ideaMapText, otherIdeas, relationLabel, type IdeaLink, type IdeaMap, type MapChapter } from '../core/ideas';
import { errorMessage } from '../core/errors';
import { shareText } from '../native/files';
import type { Answered, BookBilan, ChapterGuide } from '../storage/method';
import { add, h } from './dom';
import { toast } from './feedback';
import { icon } from './icons';
import { createSheet, type Sheet } from './sheet';

const REACHED: Record<Answered, string> = { yes: 'Oui', partly: 'En partie', no: 'Non' };

export interface IdeaMapOptions {
  bookTitle: string;
  goal: BookGoal | null;
  bilan: BookBilan | null;
  chapters: { label: string }[];
  guides: Record<string, ChapterGuide>;
  /** Chapitres choisis pour l'objectif (vide : tout le livre). */
  focus: number[];
  onChapter: (index: number) => void;
  onBilan: () => void;
}

/** Données de la carte : l'objectif, le bilan, puis les chapitres dans l'ordre du livre. */
export function ideaMapData(o: Pick<IdeaMapOptions, 'bookTitle' | 'goal' | 'bilan' | 'chapters' | 'guides'>): IdeaMap {
  const apply = applyPrompt(o.goal?.kind);
  return {
    title: o.bookTitle,
    goal: goalSummary(o.goal),
    ...(o.goal?.about ? { hypothesis: o.goal.about } : {}),
    ...(o.bilan?.about ? { about: o.bilan.about } : {}),
    ideas: o.bilan?.ideas ?? [],
    links: o.bilan?.links ?? [],
    ...(o.bilan?.reached ? { reached: REACHED[o.bilan.reached] } : {}),
    ...(o.bilan?.next ? { next: o.bilan.next } : {}),
    chapters: o.chapters.map((c, i): MapChapter => {
      const g = o.guides[i];
      return {
        label: c.label,
        ...(g?.question ? { question: g.question } : {}),
        ...(g?.main ? { main: g.main } : {}),
        ideas: g?.ideas ?? [],
        links: g?.links ?? [],
        ...(g?.apply ? { apply: { label: apply?.label ?? 'Pour mon objectif', text: g.apply } } : {}),
      };
    }),
  };
}

function linkRow(link: IdeaLink): HTMLElement {
  return h('li', { className: 'map-link' },
    h('span', { className: 'map-idea' }, link.from),
    h('span', { className: 'map-rel' }, `↓ ${relationLabel(link.relation)}`),
    h('span', { className: 'map-idea' }, link.to),
  );
}

function block(label: string, ...content: (HTMLElement | string | null)[]): HTMLElement {
  return h('div', { className: 'map-block' }, h('span', { className: 'field-label' }, label), ...content);
}

/**
 * Carte des idées : tout ce que le lecteur a dégagé du livre, réuni sur une page — l'objectif,
 * le bilan, puis chapitre par chapitre la question, l'idée principale, les idées et leurs liens.
 */
export function ideaMapSheet(o: IdeaMapOptions): Sheet {
  const sheet = createSheet({ title: 'Carte des idées', kind: 'full', testId: 'idea-map' });
  const map = ideaMapData(o);
  const chapters = map.chapters.map((c, index) => ({ c, index })).filter(({ c }) => chapterHasIdeas(c));
  const restituted = o.chapters.filter((_, i) => o.guides[i]?.restitutedAt).length;
  const total = o.focus.length || o.chapters.length;

  const book = h('section', { className: 'map-book', 'data-testid': 'map-book' },
    h('h3', {}, `« ${o.bookTitle} »`),
    map.goal ? h('p', { className: 'map-goal', 'data-testid': 'map-goal' }, icon('target'), h('span', {}, `Ton objectif : ${map.goal}`)) : null,
  );
  if (o.bilan) {
    add(book,
      map.about ? block('De quoi il parle', h('p', { className: 'map-about', 'data-testid': 'map-about' }, map.about)) : null,
      map.hypothesis ? h('p', { className: 'hint' }, `Avant de lire, tu pensais : ${map.hypothesis}`) : null,
      map.ideas?.length ? block('Idées centrales du livre', h('ul', { className: 'map-ideas', 'data-testid': 'map-book-ideas' }, ...map.ideas.map((i) => h('li', {}, i)))) : null,
      map.links?.length ? block('Liens', h('ul', { className: 'map-links' }, ...map.links.map(linkRow))) : null,
      map.reached ? h('p', { className: 'map-reached' }, h('span', { className: 'field-label' }, 'Objectif atteint '), h('span', { className: `pill tone-${o.bilan.reached}` }, map.reached)) : null,
      map.next ? block('Et maintenant', h('p', {}, map.next)) : null,
      h('button', { type: 'button', className: 'btn', 'data-testid': 'map-bilan', onclick: () => { sheet.close(); o.onBilan(); } }, 'Revoir mon bilan'),
    );
  } else {
    add(book,
      map.hypothesis ? h('p', { className: 'hint' }, `Avant de lire, tu pensais : ${map.hypothesis}`) : null,
      h('p', { className: 'hint' }, 'À la fin du livre, le bilan réunit ici ce que tu en retiens : de quoi il parle vraiment, ses idées centrales et ce que tu vas en faire.'),
      h('button', { type: 'button', className: 'btn', 'data-testid': 'map-bilan', onclick: () => { sheet.close(); o.onBilan(); } }, 'Faire le bilan'),
    );
  }

  const list = h('section', { className: 'map-chapters', 'data-testid': 'map-chapters' },
    h('h3', {}, 'Chapitre par chapitre'),
    h('p', { className: 'hint', 'data-testid': 'map-count' }, `${restituted} chapitre${restituted > 1 ? 's' : ''} restitué${restituted > 1 ? 's' : ''} sur ${total}${o.focus.length ? ' choisis' : ''}.`),
  );
  if (!chapters.length) {
    list.append(h('p', { className: 'muted map-empty', 'data-testid': 'map-empty' }, 'Ta carte se remplit au fil de ta lecture : à la fin de chaque chapitre, « Restituer le chapitre » y ajoute ton idée principale, tes idées centrales et leurs liens.'));
  }
  for (const { c, index } of chapters) {
    const ideas = otherIdeas(c);
    list.append(h('article', { className: 'map-chapter', 'data-testid': 'map-chapter' },
      h('header', {},
        h('strong', {}, c.label),
        h('button', { type: 'button', className: 'link-btn', 'data-testid': 'map-go', onclick: () => { sheet.close(); o.onChapter(index); } }, 'Lire'),
      ),
      c.question ? h('p', { className: 'map-question' }, h('span', { className: 'field-label' }, 'Question'), h('em', {}, c.question)) : null,
      c.main ? h('p', { className: 'map-main' }, h('span', { className: 'field-label' }, 'Idée principale'), h('span', {}, c.main)) : null,
      ideas.length ? h('ul', { className: 'map-ideas' }, ...ideas.map((i) => h('li', {}, i))) : null,
      c.links?.length ? h('ul', { className: 'map-links', 'data-testid': 'map-links' }, ...c.links.map(linkRow)) : null,
      c.apply?.text ? h('p', { className: 'map-apply' }, h('span', { className: 'field-label' }, c.apply.label), h('span', {}, c.apply.text)) : null,
    ));
  }

  add(sheet.body,
    book,
    list,
    h('div', { className: 'sheet-actions' },
      h('button', {
        type: 'button', className: 'btn', 'data-testid': 'map-share',
        onclick: () => void shareText(ideaMapText(map), 'Partager ma carte des idées')
          .then((how) => how === 'copied' && toast('Carte copiée : colle-la dans tes notes.'))
          .catch((err: unknown) => toast(`Partage impossible : ${errorMessage(err)}`, 'error')),
      }, icon('share'), 'Partager ma carte'),
    ),
  );
  sheet.el.addEventListener('close', () => sheet.el.remove());
  return sheet;
}
