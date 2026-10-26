import { importBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { planSession } from '../core/session';
import { listAllCards, listReviews, type CardRecord } from '../storage/cards';
import { deleteBook, listBooks, listProgress, percentRead, type BookRecord, type ProgressRecord } from '../storage/library';
import { loadReviewSettings } from '../storage/settings';
import { icon } from './icons';
import { formatDue } from './review';
import { dataSheet } from './data-sheet';
import type { Sheet } from './sheet';
import { clear, h } from './dom';
import { confirmDialog, toast, withBusy } from './feedback';
import type { Navigate, Screen } from './screen';

const ACCEPT = '.epub,.md,.markdown,.txt,application/epub+zip,text/markdown,text/plain';
const SEARCH_THRESHOLD = 4;

export function libraryScreen(navigate: Navigate): Screen {
  let coverUrls: string[] = [];
  let query = '';
  const fileInput = h('input', { type: 'file', accept: ACCEPT, className: 'visually-hidden', 'data-testid': 'file-input', tabindex: '-1', 'aria-hidden': 'true' });
  const body = h('div', { className: 'library-body' });
  const el = h(
    'div',
    { className: 'screen library' },
    h('header', { className: 'topbar' },
      h('h1', { className: 'topbar-title' }, 'Bibliothèque'),
      h('button', { type: 'button', className: 'btn btn-primary', onclick: () => fileInput.click() }, '+ Importer'),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Mes données : sauvegarde et restauration', 'data-testid': 'open-data', onclick: () => openData() }, icon('more')),
    ),
    h('main', { className: 'scroll' }, body),
    fileInput,
  );

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { book, existed } = await withBusy('Import du livre…', () => importBook(file));
      if (existed) toast(`« ${book.title} » est déjà dans ta bibliothèque.`);
      navigate({ name: 'reader', bookId: book.id });
    } catch (err) {
      logError('import', err);
      toast(`Import impossible : ${errorMessage(err)}`, 'error', 6000);
    }
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

  function bookItem(book: BookRecord, progress: ProgressRecord | undefined): HTMLElement {
    const pct = percentRead(book, progress);
    let cover: HTMLElement;
    if (book.cover) {
      const url = URL.createObjectURL(book.cover);
      coverUrls.push(url);
      cover = h('img', { className: 'book-cover', src: url, alt: '' });
    } else {
      cover = h('span', { className: 'book-cover book-cover-empty', 'aria-hidden': 'true' }, book.title.trim().charAt(0).toUpperCase() || '📖');
    }
    const meta = [book.format === 'epub' ? 'EPUB' : book.format === 'md' ? 'Markdown' : 'Ancien format', `${book.chapterCount} chapitre${book.chapterCount > 1 ? 's' : ''}`, progress ? `${pct} % lu` : 'Pas commencé'];
    return h('li', { className: 'book-item', 'data-testid': 'book-item' },
      h('button', { type: 'button', className: 'book-open', onclick: () => navigate({ name: 'reader', bookId: book.id }) },
        cover,
        h('span', { className: 'book-info' },
          h('span', { className: 'book-title' }, book.title),
          book.author ? h('span', { className: 'book-author' }, book.author) : null,
          h('span', { className: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Progression' },
            h('span', { className: 'progress-fill', style: `width:${pct}%` })),
          h('span', { className: 'book-meta', 'data-testid': 'book-meta' }, meta.join(' · ')),
        ),
      ),
      h('button', {
        type: 'button', className: 'icon-btn', 'aria-label': `Supprimer ${book.title}`,
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

  function emptyState(): HTMLElement {
    return h('section', { className: 'empty', 'data-testid': 'empty-library' },
      h('h2', {}, 'Ta liseuse d’apprentissage'),
      h('p', {}, 'Importe un livre EPUB ou un document Markdown. Pendant la lecture, transforme les passages importants en questions : l’app te les reposera au bon moment pour les retenir durablement.'),
      h('button', { type: 'button', className: 'dropzone', onclick: () => fileInput.click() },
        h('strong', {}, 'Choisir un fichier'), h('span', {}, '.epub ou .md — ou dépose-le ici')),
    );
  }

  function reviewBanner(books: BookRecord[], cards: CardRecord[], reviews: Awaited<ReturnType<typeof listReviews>>, newPerDay: number): HTMLElement | null {
    const known = new Set(books.map((b) => b.id));
    const reviewable = cards.filter((c) => c.kind !== 'highlight' && c.srs && known.has(c.bookId));
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
    const [books, progress, cards, reviews, reviewSettings] = await Promise.all([listBooks(), listProgress(), listAllCards(), listReviews(), loadReviewSettings()]);
    revokeCovers();
    clear(body);
    if (!books.length) {
      body.append(emptyState());
      return;
    }
    const list = h('ul', { className: 'book-list' });
    const renderList = () => {
      const q = query.trim().toLowerCase();
      const items = books.filter((b) => !q || b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q));
      revokeCovers();
      clear(list);
      if (!items.length) list.append(h('li', { className: 'muted' }, 'Aucun livre ne correspond.'));
      items.forEach((b) => list.append(bookItem(b, progress.get(b.id))));
    };
    if (books.length >= SEARCH_THRESHOLD) {
      const search = h('input', { type: 'search', className: 'input', placeholder: 'Rechercher un titre ou un auteur…', 'aria-label': 'Rechercher dans la bibliothèque', value: query });
      search.addEventListener('input', () => {
        query = search.value;
        renderList();
      });
      body.append(search);
    }
    const banner = reviewBanner(books, cards, reviews, reviewSettings.newPerDay);
    if (banner) body.append(banner);
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
