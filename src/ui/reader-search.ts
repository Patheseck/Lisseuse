import { searchChapters, type SearchHit } from '../reader/search';
import { clear, h } from './dom';
import { icon } from './icons';
import { createSheet, type Sheet } from './sheet';

const DEBOUNCE_MS = 200;

/** Panneau de recherche plein écran. `texts` est calculé à la demande (une fois par livre). */
export function readerSearchSheet(options: {
  texts: () => string[];
  chapterLabel: (i: number) => string;
  onPick: (hit: SearchHit) => void;
}): Sheet & { searchFor(query: string): void } {
  const input = h('input', { type: 'search', className: 'input', placeholder: 'Rechercher dans ce livre…', 'aria-label': 'Rechercher dans ce livre', enterkeyhint: 'search', 'data-testid': 'search-input' });
  const status = h('p', { className: 'muted search-status', 'aria-live': 'polite' });
  const results = h('ol', { className: 'search-results', 'data-testid': 'search-results' });
  let timer: number | undefined;
  let sheet: Sheet;

  const header = h('div', { className: 'sheet-head search-head' },
    input,
    h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Fermer la recherche', onclick: () => sheet.close() }, icon('close')),
  );
  sheet = createSheet({ title: 'Recherche', kind: 'full', testId: 'search-sheet', header });
  sheet.body.append(status, results);

  function run(): void {
    const query = input.value;
    clear(results);
    if (query.trim().length < 2) {
      status.textContent = 'Saisis au moins deux caractères.';
      return;
    }
    const hits = searchChapters(options.texts(), query);
    status.textContent = hits.length ? `${hits.length >= 200 ? '200+' : hits.length} résultat${hits.length > 1 ? 's' : ''}` : 'Aucun résultat.';
    for (const hit of hits) {
      results.append(h('li', {},
        h('button', { type: 'button', className: 'search-hit', onclick: () => { sheet.close(); options.onPick(hit); } },
          h('span', { className: 'search-chapter' }, options.chapterLabel(hit.chapter)),
          h('span', { className: 'search-snippet' }, hit.before, h('mark', {}, hit.match), hit.after),
        ),
      ));
    }
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      window.clearTimeout(timer);
      run();
    }
  });

  const open = sheet.open.bind(sheet);
  sheet.open = () => {
    open();
    input.select();
    if (!input.value) status.textContent = 'Saisis au moins deux caractères.';
  };
  return Object.assign(sheet, {
    /** Ouvre la recherche déjà lancée sur un texte (sélection du lecteur). */
    searchFor(query: string) {
      input.value = query;
      open();
      run();
    },
  });
}
