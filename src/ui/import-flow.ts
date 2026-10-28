import { DrmError } from '../book/epub';
import { importBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { infoDialog, toast, withBusy } from './feedback';
import type { Navigate } from './screen';

/** Importe un fichier (sélecteur, glisser-déposer ou « Ouvrir avec ») puis ouvre le livre. */
export async function importAndOpen(file: File, navigate: Navigate): Promise<void> {
  try {
    const { book, existed } = await withBusy('Import du livre…', () => importBook(file));
    if (existed) toast(`« ${book.title} » est déjà dans ta bibliothèque.`);
    navigate({ name: 'reader', bookId: book.id });
  } catch (err) {
    if (err instanceof DrmError) {
      await infoDialog('Livre protégé (DRM)', [
        `Ce livre est verrouillé par une protection ${err.vendor === 'inconnu' ? 'anti-copie' : err.vendor} : son texte est chiffré et seule l’application du vendeur peut l’ouvrir.`,
        'Liseuse lit les livres sans DRM. Beaucoup de librairies en ligne vendent des versions sans DRM ou « tatouées » (filigrane) : elles s’ouvrent ici normalement.',
      ]);
      return;
    }
    logError('import', err);
    toast(`Import impossible : ${errorMessage(err)}`, 'error', 6000);
  }
}
