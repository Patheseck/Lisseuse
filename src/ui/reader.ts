import { openBook, type OpenedBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { getProgress, saveProgress, touchBook } from '../storage/library';
import { clear, h } from './dom';
import { toast } from './feedback';
import type { Navigate, Screen } from './screen';

const SAVE_DELAY_MS = 400;

// Lecteur minimal de l'étape 1 : chapitres, navigation, reprise de position.
// La table des matières, la recherche, les réglages et le surlignage arrivent à l'étape 2.
export function readerScreen(bookId: string, navigate: Navigate): Screen {
  let opened: OpenedBook | null = null;
  let current = 0;
  let saveTimer: number | undefined;
  const resourceUrls = new Map<string, string>();

  const title = h('span', { className: 'topbar-title', 'data-testid': 'reader-title' }, 'Chargement…');
  const content = h('article', { className: 'reader-content', 'data-testid': 'reader-content' });
  const scroller = h('main', { className: 'scroll reader-scroll' }, h('div', { className: 'reader-column' }, content));
  const prev = h('button', { type: 'button', className: 'btn', 'data-testid': 'prev-chapter', onclick: () => go(current - 1) }, '← Précédent');
  const next = h('button', { type: 'button', className: 'btn', 'data-testid': 'next-chapter', onclick: () => go(current + 1) }, 'Suivant →');
  const position = h('span', { className: 'muted', 'data-testid': 'chapter-position' });
  const footer = h('footer', { className: 'bottombar' }, prev, position, next);
  footer.hidden = true;

  const el = h('div', { className: 'screen reader' },
    h('header', { className: 'topbar' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, '←'),
      title,
    ),
    scroller,
    footer,
  );

  function resourceUrl(path: string): string | undefined {
    let url = resourceUrls.get(path);
    const blob = opened?.resources[path];
    if (!url && blob) {
      url = URL.createObjectURL(blob);
      resourceUrls.set(path, url);
    }
    return url;
  }

  function offset(): number {
    const max = scroller.scrollHeight - scroller.clientHeight;
    // Un chapitre qui tient entièrement à l'écran est considéré comme lu.
    return max > 0 ? scroller.scrollTop / max : 1;
  }

  function persist(): void {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    if (opened) saveProgress(bookId, current, offset()).catch((err: unknown) => logError('progression', err));
  }

  function go(index: number, restoreOffset = 0): void {
    if (!opened || index < 0 || index >= opened.chapters.length) return;
    current = index;
    const chapter = opened.chapters[index]!;
    content.innerHTML = chapter.html; // HTML déjà nettoyé par DOMPurify à l'import
    content.querySelectorAll<HTMLImageElement>('img[data-res]').forEach((img) => {
      const url = resourceUrl(img.dataset.res ?? '');
      if (url) img.src = url;
    });
    position.textContent = `${index + 1} / ${opened.chapters.length}`;
    prev.disabled = index === 0;
    next.disabled = index === opened.chapters.length - 1;
    requestAnimationFrame(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.max(0, restoreOffset * max);
      persist();
    });
  }

  // Liens internes du livre (convertis à l'import en data-chapter / data-anchor).
  content.addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLElement>('a[data-chapter], a[data-anchor]');
    if (!link) return;
    e.preventDefault();
    const target = link.dataset.chapter !== undefined ? Number(link.dataset.chapter) : current;
    if (target !== current) go(target);
    const anchor = link.dataset.anchor;
    if (anchor) requestAnimationFrame(() => content.querySelector(`[data-anchor-id="${CSS.escape(anchor)}"]`)?.scrollIntoView());
  });

  scroller.addEventListener('scroll', () => {
    if (saveTimer === undefined) saveTimer = window.setTimeout(persist, SAVE_DELAY_MS);
  }, { passive: true });

  (async () => {
    opened = await openBook(bookId);
    title.textContent = opened.book.title;
    footer.hidden = false;
    const progress = await getProgress(bookId);
    const start = Math.min(Math.max(0, progress?.chapter ?? 0), opened.chapters.length - 1);
    go(start, progress?.offset ?? 0);
    await touchBook(bookId);
  })().catch((err: unknown) => {
    logError('ouverture', err);
    title.textContent = 'Livre illisible';
    clear(content);
    content.append(h('p', { className: 'error-box' }, `Impossible d’ouvrir ce livre : ${errorMessage(err)}`));
    toast('Ce livre n’a pas pu être ouvert.', 'error');
  });

  return {
    el,
    destroy() {
      if (saveTimer !== undefined) persist();
      resourceUrls.forEach((u) => URL.revokeObjectURL(u));
      resourceUrls.clear();
    },
  };
}
