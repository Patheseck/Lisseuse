import { goalSummary, type BookGoal } from '../core/goal';
import { ideaPool, splitIdeas, type IdeaLink } from '../core/ideas';
import type { Answered, BookBilan, ChapterGuide } from '../storage/method';
import { add, h } from './dom';
import { linkBuilder } from './link-builder';
import { createSheet } from './sheet';

/** Idées centrales gardées pour le livre entier. */
const MAX_IDEAS = 8;

export interface BilanResult {
  bilan: BookBilan;
  makeAboutCard: boolean;
  makeIdeasCard: boolean;
  makeLinkCards: boolean;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { className: 'field' }, h('span', { className: 'field-label' }, label), hint ? h('span', { className: 'hint' }, hint) : null, control);
}

/**
 * Bilan de fin de livre, livre fermé : de quoi il parle vraiment (comparé à l'hypothèse du
 * départ), ses idées centrales et leurs liens, l'objectif atteint, et ce qu'on va en faire.
 * Résout avec le bilan, ou null si le panneau est fermé sans enregistrer.
 */
export function bilanSheet(options: {
  bookTitle: string;
  goal: BookGoal | null;
  bilan: BookBilan | null;
  /** Idées principales des chapitres, pour comparer après coup. */
  chapters: { label: string; guide?: ChapterGuide }[];
}): Promise<BilanResult | null> {
  return new Promise((resolve) => {
    let result: BilanResult | null = null;
    const previous = options.bilan;
    const sheet = createSheet({
      title: 'Bilan du livre',
      kind: 'full',
      testId: 'bilan-sheet',
      onClose: () => {
        sheet.el.remove();
        resolve(result);
      },
    });
    const area = (testId: string, value: string, placeholder: string, rows = 3) => {
      const el = h('textarea', { className: 'input textarea', rows, 'data-testid': testId, placeholder });
      el.value = value;
      return el;
    };
    const about = area('bilan-about', previous?.about ?? '', 'Ce livre montre surtout que…');
    const ideas = area('bilan-ideas', (previous?.ideas ?? []).join('\n'), 'Une idée par ligne…', 5);
    const next = area('bilan-next', previous?.next ?? '', 'Une action, un prochain livre, quelqu’un à qui en parler…', 2);
    let reached: Answered | null = previous?.reached ?? null;
    const links: IdeaLink[] = [...(previous?.links ?? [])];

    const reachedGroup = h('div', { className: 'segmented', role: 'radiogroup', 'aria-label': 'Objectif atteint ?' });
    for (const [value, label] of [['yes', 'Oui'], ['partly', 'En partie'], ['no', 'Non']] as [Answered, string][]) {
      const input = h('input', { type: 'radio', name: 'bilan-reached', id: `bilan-reached-${value}`, value, className: 'visually-hidden', checked: reached === value });
      input.addEventListener('change', () => input.checked && (reached = value));
      reachedGroup.append(input, h('label', { for: `bilan-reached-${value}`, 'data-testid': `bilan-reached-${value}` }, label));
    }

    // Liens : entre les idées du livre et les idées principales des chapitres. Les idées des liens
    // déjà faits restent proposées, même si leur texte a changé depuis.
    const linksBox = h('div', { className: 'bilan-links', 'data-testid': 'bilan-links' });
    const chapterIdeas = options.chapters.flatMap((c) => (c.guide?.main ? [c.guide.main] : []));
    let linksShown = false;
    const renderLinks = () => {
      linksShown = true;
      const pool = ideaPool('', [...splitIdeas(ideas.value, MAX_IDEAS), ...chapterIdeas, ...links.flatMap((l) => [l.from, l.to])]);
      linksBox.replaceChildren(pool.length >= 2 ? linkBuilder({ pool, links }) : h('p', { className: 'hint' }, 'Écris d’abord au moins deux idées centrales.'));
    };
    // Les idées réécrites rejoignent la liste dès que le champ est quitté.
    ideas.addEventListener('change', () => linksShown && renderLinks());
    if (links.length) renderLinks();
    else linksBox.append(h('button', { type: 'button', className: 'btn', 'data-testid': 'bilan-open-links', onclick: renderLinks }, 'Relier mes idées'));

    const goal = goalSummary(options.goal);
    const reminder = options.chapters.filter((c) => c.guide?.main);
    const aboutCard = h('input', { type: 'checkbox', checked: true, 'data-testid': 'bilan-about-card' });
    const ideasCard = h('input', { type: 'checkbox', checked: true, 'data-testid': 'bilan-ideas-card' });
    const linkCards = h('input', { type: 'checkbox', checked: true, 'data-testid': 'bilan-link-cards' });

    add(sheet.body,
      h('p', { className: 'hint' }, `Livre fermé, fais le point sur « ${options.bookTitle} » : c’est le moment où ce que tu as lu devient à toi.`),
      field('1. De quoi parle vraiment ce livre ?', about),
      options.goal?.about ? h('p', { className: 'review-block bilan-hypothesis', 'data-testid': 'bilan-hypothesis' }, h('span', { className: 'field-label' }, 'Avant de lire, tu pensais'), h('span', { className: 'guide-question-text' }, options.goal.about)) : null,
      field('2. Les idées centrales du livre, une par ligne', ideas, '3 à 5 idées qui résument le livre.'),
      reminder.length
        ? h('details', { className: 'data-section', 'data-testid': 'bilan-chapters' },
            h('summary', {}, 'Comparer avec tes idées de chapitre'),
            h('ul', { className: 'about-list' }, ...reminder.map((c) => h('li', {}, h('strong', {}, `${c.label} : `), c.guide!.main!))),
          )
        : null,
      h('div', { className: 'field' }, h('span', { className: 'field-label' }, '3. Les liens entre ces idées'), linksBox),
      h('div', { className: 'field' },
        h('span', { className: 'field-label' }, goal ? '4. As-tu atteint ton objectif ?' : '4. Ce livre t’a-t-il apporté ce que tu en attendais ?'),
        goal ? h('span', { className: 'hint', 'data-testid': 'bilan-goal' }, `Ton objectif : ${goal}`) : null,
        reachedGroup,
      ),
      field('5. Et maintenant ?', next, 'Ce que tu vas faire de ce livre.'),
      h('label', { className: 'check recall-guide' }, aboutCard, h('span', {}, `Créer une fiche : « De quoi parle ${options.bookTitle} ? »`)),
      h('label', { className: 'check recall-guide' }, ideasCard, h('span', {}, `Créer une fiche : les idées centrales de « ${options.bookTitle} »`)),
      h('label', { className: 'check recall-guide' }, linkCards, h('span', {}, 'Créer une fiche pour chaque nouveau lien')),
      h('div', { className: 'sheet-actions' },
        h('button', {
          type: 'button', className: 'btn btn-primary', 'data-testid': 'bilan-save',
          onclick: () => {
            result = {
              bilan: {
                about: about.value.trim(), ideas: splitIdeas(ideas.value, MAX_IDEAS), links: [...links], reached, next: next.value.trim(), at: Date.now(),
                ...(previous?.aboutCardId ? { aboutCardId: previous.aboutCardId } : {}),
                ...(previous?.ideasCardId ? { ideasCardId: previous.ideasCardId } : {}),
              },
              makeAboutCard: aboutCard.checked,
              makeIdeasCard: ideasCard.checked,
              makeLinkCards: linkCards.checked,
            };
            sheet.close();
          },
        }, 'Enregistrer mon bilan'),
      ),
    );
    sheet.open();
    about.focus();
  });
}
