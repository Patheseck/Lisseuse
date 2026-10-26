import { importBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { toast, withBusy } from './feedback';
import type { Navigate } from './screen';

/** Importe un fichier (sélecteur, glisser-déposer ou « Ouvrir avec ») puis ouvre le livre. */
export async function importAndOpen(file: File, navigate: Navigate): Promise<void> {
  try {
    const { book, existed } = await withBusy('Import du livre…', () => importBook(file));
    if (existed) toast(`« ${book.title} » est déjà dans ta bibliothèque.`);
    navigate({ name: 'reader', bookId: book.id });
  } catch (err) {
    logError('import', err);
    toast(`Import impossible : ${errorMessage(err)}`, 'error', 6000);
  }
}
