import { getBook, readsPages } from '../storage/library';
import { logError } from '../core/errors';
import { h } from './dom';
import { pdfReaderScreen } from './pdf-reader';
import { readerScreen } from './reader';
import type { Navigate, Screen } from './screen';

/**
 * Écran de lecture d'un livre : un PDF s'ouvre en pages originales (sauf si son texte adapté a été
 * choisi, ou pour aller au passage d'une fiche, qui vit dans le texte adapté) ; le reste en texte.
 */
export function bookScreen(bookId: string, navigate: Navigate, cardId?: string, view?: 'pages' | 'text'): Screen {
  const el = h('div', { className: 'screen-host' });
  let inner: Screen | null = null;
  let destroyed = false;
  const mount = (screen: Screen) => {
    inner = screen;
    el.append(screen.el);
  };
  void getBook(bookId)
    .then((book) => {
      if (destroyed) return;
      const pages = !!book && book.format === 'pdf' && !cardId && (view ? view === 'pages' : readsPages(book));
      mount(pages ? pdfReaderScreen(bookId, navigate) : readerScreen(bookId, navigate, cardId));
    })
    .catch((err: unknown) => {
      logError('ouverture', err);
      if (!destroyed) mount(readerScreen(bookId, navigate, cardId));
    });
  return {
    el,
    onBack: () => inner?.onBack?.() ?? false,
    destroy() {
      destroyed = true;
      inner?.destroy();
    },
  };
}
