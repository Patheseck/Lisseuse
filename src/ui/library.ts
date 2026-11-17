import { importAndOpen, importBooks } from './import-flow';
import { readFoundFile, scanSupported, type FoundFile } from '../native/storage-scan';
import { BOOK_EXTENSIONS, fileKey, openScanSheet } from './scan-sheet';
import { duplicateGroups, looksLikeBook, planDuplicates, type CopyData } from '../book/duplicates';
import { errorMessage, logError } from '../core/errors';
import { planSession } from '../core/session';
import { isReviewable, listAllCards, listReviews, type CardRecord } from '../storage/cards';
import { deleteBook, listBooks, listProgress, percentRead, readsPages, type BookRecord, type ProgressRecord } from '../storage/library';
import { bilanKey, bookmarksKey, focusKey, goalKey, guideKey, loadShelf, normalizeFocus, pageMarksKey, saveShelf, type ShelfPrefs, type ShelfSort } from '../storage/method';
import { goalSummary, normalizeGoal } from '../core/goal';
import { listSettings, loadReviewSettings } from '../storage/settings';
import { icon } from './icons';
import { formatDue } from './review';
import { dataSheet } from './data-sheet';
import type { Sheet } from './sheet';
import { clear, h } from './dom';
import { confirmDialog, infoDialog, toast, withBusy } from './feedback';
import type { Navigate, Screen } from './screen';

const ACCEPT = '.epub,.pdf,.md,.markdown,.txt,application/epub+zip,application/pdf,text/markdown,text/plain';
const SEARCH_THRESHOLD = 4;

/** Teinte stable tirée du titre, pour les couvertures générées. */
function hueOf(title: string): number {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function libraryScreen(navigate: Navigate): Screen {
  let coverUrls: string[] = [];
  let query = '';
  let shelf: ShelfPrefs = { view: 'grid', sort: 'recent' };
  const fileInput = h('input', { type: 'file', accept: ACCEPT, className: 'visually-hidden', 'data-testid': 'file-input', tabindex: '-1', 'aria-hidden': 'true' });
  const body = h('div', { className: 'library-body' });
  const el = h(
    'div',
    { className: 'screen library' },
    h('header', { className: 'topbar' },
      h('h1', { className: 'topbar-title' }, 'Bibliothèque'),
      h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'open-import', onclick: () => void openImport() }, '+ Importer'),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Mes fiches', 'data-testid': 'open-cards', onclick: () => navigate({ name: 'cards' }) }, icon('card')),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Ma mémoire : tableau de bord', 'data-testid': 'open-stats', onclick: () => navigate({ name: 'stats' }) }, icon('chart')),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Mes données et à propos : sauvegarde, restauration, version', 'data-testid': 'open-data', onclick: () => openData() }, icon('more')),
    ),
    h('main', { className: 'scroll' }, body),
    fileInput,
  );

  async function handleFile(file: File | undefined): Promise<void> {
    if (file) await importAndOpen(file, navigate);
  }

  /**
   * « + Importer » : dans l'app Android, rechercher les livres du téléphone ou choisir un fichier
   * (Google Drive compris) ; dans un navigateur, le sélecteur de fichiers directement.
   */
  async function openImport(): Promise<void> {
    if (!scanSupported()) {
      fileInput.click();
      return;
    }
    const books = await listBooks().catch(() => []);
    const known = new Set(books.map((b) => fileKey(b.fileName, b.file.size)));
    openScanSheet({
      title: 'Importer des livres',
      testId: 'import-sheet',
      what: 'tes livres (EPUB, PDF, Markdown, texte)',
      noun: 'livre',
      extensions: BOOK_EXTENSIONS,
      multiple: true,
      isKnown: (f) => known.has(fileKey(f.name, f.size)) || looksLikeBook(f.name, books),
      onPick: () => fileInput.click(),
      onImport: importFound,
    }).open();
  }

  /** Livres trouvés dans le téléphone : un seul s'ouvre comme d'habitude ; plusieurs, un bilan. */
  async function importFound(found: FoundFile[]): Promise<void> {
    if (found.length === 1) {
      let file: File;
      try {
        file = await withBusy('Lecture du fichier…', () => readFoundFile(found[0]!));
      } catch (err) {
        logError('import', err);
        toast(`Import impossible : ${errorMessage(err)}`, 'error', 6000);
        return;
      }
      await importAndOpen(file, navigate);
      return;
    }
    const outcome = await importBooks(found.map((f) => ({ name: f.name, read: () => readFoundFile(f) })));
    await render();
    const added = outcome.added.length;
    if (!outcome.failed.length && !outcome.existing.length) {
      toast(`${added} livre${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à ta bibliothèque.`);
      return;
    }
    const list = (items: string[]) => h('ul', {}, ...items.map((t) => h('li', {}, t)));
    await infoDialog('Import terminé', [
      `${added} livre${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.`,
      outcome.existing.length ? 'Déjà dans ta bibliothèque :' : null,
      outcome.existing.length ? list(outcome.existing) : null,
      outcome.failed.length ? 'Pas importés :' : null,
      outcome.failed.length ? list(outcome.failed) : null,
    ]);
  }
  fileInput.addEventListener('change', () => {
    void handleFile(fileInput.files?.[0]);
    fileInput.value = '';
  });

  // Glisser-déposer sur tout l'écran (ordinateur, tablette).
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('dragging');
  });
  el.addEventListener('dragleave', (e) => {
    if (e.target === el) el.classList.remove('dragging');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('dragging');
    void handleFile(e.dataTransfer?.files[0]);
  });

  let data: Sheet | null = null;
  function openData(): void {
    data?.el.remove();
    data = dataSheet(() => void render());
    data.open();
  }

  function revokeCovers(): void {
    coverUrls.forEach((u) => URL.revokeObjectURL(u));
    coverUrls = [];
  }

  function coverFor(book: BookRecord, className: string): HTMLElement {
    if (book.cover) {
      const url = URL.createObjectURL(book.cover);
      coverUrls.push(url);
      return h('img', { className: `book-cover ${className}`, src: url, alt: '' });
    }
    // Couverture générée : teinte tirée du titre, titre et auteur composés.
    return h('span', { className: `book-cover book-cover-made ${className}`, style: `--hue:${hueOf(book.title)}`, 'aria-hidden': 'true' },
      h('span', { className: 'made-title' }, book.title),
      book.author ? h('span', { className: 'made-author' }, book.author) : null,
    );
  }

  function bookItem(book: BookRecord, progress: ProgressRecord | undefined, focus: number[]): HTMLElement {
    const pct = percentRead(book, progress, focus);
    const size = readsPages(book) && book.pageCount ? `${book.pageCount} page${book.pageCount > 1 ? 's' : ''}` : `${book.chapterCount} chapitre${book.chapterCount > 1 ? 's' : ''}`;
    const started = readsPages(book) ? progress?.page !== undefined : !!progress;
    const meta = [book.format === 'epub' ? 'EPUB' : book.format === 'pdf' ? 'PDF' : book.format === 'md' ? 'Markdown' : 'Ancien format', size, started ? `${pct} % lu` : 'Pas commencé'];
    if (focus.length) meta.push(`objectif : ${focus.length} chap.`);
    return h('li', { className: 'book-item', 'data-testid': 'book-item' },
      h('button', { type: 'button', className: 'book-open', onclick: () => navigate({ name: 'reader', bookId: book.id }) },
        h('span', { className: 'cover-wrap' }, coverFor(book, ''), pct >= 100 ? h('span', { className: 'cover-badge' }, 'Lu') : null),
        h('span', { className: 'book-info' },
          h('span', { className: 'book-title' }, book.title),
          book.author ? h('span', { className: 'book-author' }, book.author) : null,
          h('span', { className: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progression' },
            h('span', { className: 'progress-fill', style: `width:${pct}%` })),
          h('span', { className: 'book-meta', 'data-testid': 'book-meta' }, meta.join(' · ')),
        ),
      ),
      h('button', {
        type: 'button', className: 'icon-btn book-delete', 'aria-label': `Supprimer ${book.title}`,
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Supprimer ce livre ?',
            message: `« ${book.title} » sera retiré de la bibliothèque avec ses fiches et son historique de révision.`,
            confirmLabel: 'Supprimer',
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteBook(book.id);
            await render();
          } catch (err) {
            logError('suppression', err);
            toast(`Suppression impossible : ${errorMessage(err)}`, 'error');
          }
        },
      }, icon('trash')),
    );
  }

  /** Grand bouton « Continuer la lecture » : le dernier livre ouvert, s'il est commencé et pas fini. */
  function continueCard(book: BookRecord, progress: ProgressRecord, focus: number[], goal: string | null): HTMLElement {
    const pct = percentRead(book, progress, focus);
    const chapter = readsPages(book)
      ? `Page ${(progress.page ?? 0) + 1}${book.pageCount ? ` sur ${book.pageCount}` : ''}`
      : (book.chapterLabels?.[progress.chapter] ?? `Chapitre ${progress.chapter + 1}`);
    return h('section', { className: 'continue', 'data-testid': 'continue-card' },
      coverFor(book, 'continue-cover'),
      h('div', { className: 'continue-info' },
        h('span', { className: 'continue-kicker' }, 'Continuer la lecture'),
        h('strong', { className: 'continue-title' }, book.title),
        h('span', { className: 'muted continue-chapter' }, chapter),
        goal ? h('span', { className: 'continue-goal', 'data-testid': 'continue-goal' }, `Objectif : ${goal}`) : null,
        h('span', { className: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progression' },
          h('span', { className: 'progress-fill', style: `width:${pct}%` })),
        h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'continue-reading', onclick: () => navigate({ name: 'reader', bookId: book.id }) }, icon('play'), `Reprendre · ${pct} %`),
      ),
    );
  }

  function sortBooks(books: BookRecord[], progress: Map<string, ProgressRecord>, focusOf: (b: BookRecord) => number[]): BookRecord[] {
    const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
    const by: Record<ShelfSort, (a: BookRecord, b: BookRecord) => number> = {
      recent: (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      title: (a, b) => collator.compare(a.title, b.title),
      author: (a, b) => collator.compare(a.author ?? '\uffff', b.author ?? '\uffff') || collator.compare(a.title, b.title),
      progress: (a, b) => percentRead(b, progress.get(b.id), focusOf(b)) - percentRead(a, progress.get(a.id), focusOf(a)),
    };
    return [...books].sort(by[shelf.sort]);
  }

  /** Enregistre le choix d'affichage, puis l'applique : ce qui est à l'écran est toujours sauvegardé. */
  async function changeShelf(next: ShelfPrefs, apply: () => void): Promise<void> {
    shelf = next;
    try {
      await saveShelf(shelf);
    } catch (err) {
      logError('bibliothèque', err);
    }
    apply();
  }

  function shelfBar(onChange: () => void): HTMLElement {
    const sort = h('select', { className: 'input shelf-sort', 'aria-label': 'Trier les livres', 'data-testid': 'shelf-sort' },
      ...([['recent', 'Récents'], ['title', 'Titre'], ['author', 'Auteur'], ['progress', 'Progression']] as const).map(([v, label]) => h('option', { value: v, selected: v === shelf.sort }, label)));
    sort.addEventListener('change', () => void changeShelf({ ...shelf, sort: sort.value as ShelfSort }, onChange));
    const view = h('button', {
      type: 'button', className: 'icon-btn', 'data-testid': 'shelf-view',
      'aria-label': shelf.view === 'grid' ? 'Afficher en liste' : 'Afficher en grille',
      onclick: () => void changeShelf({ ...shelf, view: shelf.view === 'grid' ? 'list' : 'grid' }, () => {
        view.replaceChildren(icon(shelf.view === 'grid' ? 'list' : 'grid'));
        view.setAttribute('aria-label', shelf.view === 'grid' ? 'Afficher en liste' : 'Afficher en grille');
        onChange();
      }),
    }, icon(shelf.view === 'grid' ? 'list' : 'grid'));
    return h('div', { className: 'shelf-bar' }, h('h2', { className: 'shelf-title' }, 'Mes livres'), sort, view);
  }

  /**
   * Livres en double (importés avant la 6.12.2, ou restaurés) : « Retirer les doublons » garde
   * l'exemplaire où sont les fiches, les notes ou la lecture la plus avancée, et retire les autres
   * s'ils n'ont ni fiche ni note. Si plusieurs exemplaires ont des fiches, l'utilisateur choisit.
   */
  function duplicatesBanner(books: BookRecord[], data: (b: BookRecord) => CopyData): HTMLElement | null {
    const plans = planDuplicates(duplicateGroups(books), data);
    if (!plans.length) return null;
    const format = (b: BookRecord) => (b.format === 'pdf' ? 'PDF' : b.format === 'epub' ? 'EPUB' : 'texte');
    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const removable = plans.flatMap((p) => p.remove);
    const conflicts = plans.filter((p) => p.conflicts.length);
    const remove = async () => {
      const ok = await confirmDialog({
        title: 'Retirer les doublons',
        message: `${removable.length > 1 ? `Ces ${removable.length} exemplaires en double, sans fiche ni note, vont être retirés` : 'Cet exemplaire en double, sans fiche ni note, va être retiré'} : ${removable.map((b) => `« ${b.title} » (${format(b)})`).join(', ')}. L’exemplaire gardé conserve tes fiches, tes notes et ta lecture.`,
        confirmLabel: 'Retirer',
      });
      if (!ok) return;
      try {
        for (const book of removable) await deleteBook(book.id);
        toast(`${plural(removable.length, 'doublon')} retiré${removable.length > 1 ? 's' : ''}.`);
      } catch (err) {
        logError('doublons', err);
        toast(`Doublons non retirés : ${errorMessage(err)}`, 'error');
      }
      await render();
    };
    return h('section', { className: 'duplicates-banner', 'data-testid': 'duplicates-banner' },
      h('p', {}, h('strong', {}, plans.length > 1 ? `${plans.length} livres en double` : 'Un livre en double'),
        removable.length ? ' : retire les exemplaires en trop d’un geste ; celui qui a tes fiches, tes notes ou ta lecture la plus avancée est gardé.' : '.'),
      ...(conflicts.length ? [h('ul', {}, ...conflicts.map((p) => h('li', {}, `« ${p.keep.title} » : chaque exemplaire a des fiches ou des notes (${[p.keep, ...p.conflicts].map((b) => `${format(b)} : ${plural(data(b).cards, 'fiche')}`).join(', ')}). Supprime celui que tu n’utilises plus avec la corbeille de sa couverture : ses fiches partent avec lui.`)))] : []),
      ...(removable.length ? [h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'remove-duplicates', onclick: () => void remove() }, `Retirer les doublons (${removable.length})`)] : []),
    );
  }

  function emptyState(): HTMLElement {
    return h('section', { className: 'empty', 'data-testid': 'empty-library' },
      h('h2', {}, 'Ta liseuse d’apprentissage'),
      h('p', {}, 'Importe un livre EPUB ou PDF, ou un texte. Pendant la lecture, transforme les passages importants en questions : l’app te les reposera au bon moment pour les retenir durablement.'),
      h('button', { type: 'button', className: 'dropzone', onclick: () => fileInput.click() },
        h('strong', {}, 'Choisir un fichier'), h('span', {}, '.epub, .pdf, .md ou .txt — ou dépose-le ici')),
    );
  }

  function reviewBanner(books: BookRecord[], cards: CardRecord[], reviews: Awaited<ReturnType<typeof listReviews>>, newPerDay: number): HTMLElement | null {
    const known = new Set(books.map((b) => b.id));
    const reviewable = cards.filter((c) => isReviewable(c) && known.has(c.bookId));
    if (!reviewable.length) return null;
    const plan = planSession(reviewable, reviews, { now: Date.now(), newPerDay });
    const count = plan.queue.length;
    const detail = [plan.dueCount ? `${plan.dueCount} à revoir` : '', plan.newCount ? `${plan.newCount} nouvelle${plan.newCount > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    return h('section', { className: `review-banner${count ? ' is-due' : ''}`, 'data-testid': 'review-banner' },
      h('div', {},
        h('strong', {}, count ? `${count} fiche${count > 1 ? 's' : ''} à réviser` : 'Tout est à jour'),
        h('span', { className: 'muted' }, count ? detail : plan.nextDue ? `Prochaine révision ${formatDue(plan.nextDue)}` : ''),
      ),
      count ? h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'start-review', onclick: () => navigate({ name: 'review' }) }, icon('review'), 'Réviser') : null,
    );
  }

  async function render(): Promise<void> {
    const [books, progress, cards, reviews, reviewSettings, settings, prefs] = await Promise.all([listBooks(), listProgress(), listAllCards(), listReviews(), loadReviewSettings(), listSettings(), loadShelf()]);
    shelf = prefs;
    revokeCovers();
    clear(body);
    if (!books.length) {
      body.append(emptyState());
      return;
    }
    const focusValues = new Map(settings.filter((r) => r.key.startsWith('focus:')).map((r) => [r.key, r.value]));
    const focusOf = (b: BookRecord) => normalizeFocus(focusValues.get(focusKey(b.id)), b.chapterCount);
    // Notes personnelles d'un livre : signets, objectif, bilan, questions, rappels, chapitres choisis.
    const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && (Array.isArray(v) ? v.length > 0 : typeof v !== 'object' || Object.keys(v).length > 0);
    const noteValues = new Map(settings.map((r) => [r.key, r.value]));
    const hasNotes = (id: string) => [`recall:${id}`, `pretest:${id}`, guideKey(id), focusKey(id), bookmarksKey(id), goalKey(id), bilanKey(id), pageMarksKey(id)].some((k) => filled(noteValues.get(k)));
    const list = h('ul', { className: 'book-list' });
    const renderList = () => {
      const q = query.trim().toLowerCase();
      const items = sortBooks(books, progress, focusOf).filter((b) => !q || b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q));
      list.className = shelf.view === 'grid' ? 'book-list book-grid' : 'book-list';
      for (const img of list.querySelectorAll('img')) URL.revokeObjectURL(img.src);
      clear(list);
      if (!items.length) list.append(h('li', { className: 'muted' }, 'Aucun livre ne correspond.'));
      items.forEach((b) => list.append(bookItem(b, progress.get(b.id), focusOf(b))));
    };
    // Dernier livre ouvert, commencé et pas terminé.
    const last = books.reduce((a, b) => (b.lastOpenedAt > a.lastOpenedAt ? b : a));
    const lastProgress = progress.get(last.id);
    if (lastProgress && percentRead(last, lastProgress, focusOf(last)) < 100) {
      const goal = goalSummary(normalizeGoal(settings.find((r) => r.key === goalKey(last.id))?.value));
      body.append(continueCard(last, lastProgress, focusOf(last), goal));
    }
    const banner = reviewBanner(books, cards, reviews, reviewSettings.newPerDay);
    if (banner) body.append(banner);
    const doubles = duplicatesBanner(books, (b) => ({
      cards: cards.filter((c) => c.bookId === b.id).length,
      notes: hasNotes(b.id),
      read: percentRead(b, progress.get(b.id), focusOf(b)),
    }));
    if (doubles) body.append(doubles);
    // Accès direct aux fiches, sans ouvrir de livre.
    const known = new Set(books.map((b) => b.id));
    const mine = cards.filter((c) => known.has(c.bookId));
    if (mine.length) {
      const questions = mine.filter((c) => c.kind !== 'highlight').length;
      body.append(h('button', { type: 'button', className: 'cards-entry', 'data-testid': 'cards-entry', onclick: () => navigate({ name: 'cards' }) },
        icon('card'),
        h('span', {}, h('strong', {}, 'Mes fiches'), h('small', { className: 'muted' }, `${questions} fiche${questions > 1 ? 's' : ''} · ${mine.length - questions} passage${mine.length - questions > 1 ? 's' : ''} surligné${mine.length - questions > 1 ? 's' : ''}`)),
        icon('chevronRight'),
      ));
    }
    body.append(shelfBar(renderList));
    if (books.length >= SEARCH_THRESHOLD) {
      const search = h('input', { type: 'search', className: 'input', placeholder: 'Rechercher un titre ou un auteur…', 'aria-label': 'Rechercher dans la bibliothèque', value: query });
      search.addEventListener('input', () => {
        query = search.value;
        renderList();
      });
      body.append(search);
    }
    body.append(list);
    renderList();
  }

  render().catch((err: unknown) => {
    logError('bibliothèque', err);
    clear(body);
    body.append(h('p', { className: 'error-box' }, `La bibliothèque n’a pas pu être chargée : ${errorMessage(err)}`));
  });

  return {
    el,
    destroy() {
      revokeCovers();
      data?.el.remove();
    },
  };
}
