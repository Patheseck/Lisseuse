import { DrmError } from '../book/epub';
import { ImportCancelled, ScannedPdfError } from '../book/errors';
import type { PdfOptions } from '../book/pdf';
import { importBook } from '../book/service';
import { errorMessage, logError } from '../core/errors';
import { infoDialog, passwordDialog, toast, withBusy, type BusyUpdate } from './feedback';
import type { Navigate } from './screen';

/** Suivi de la lecture d'un PDF : avancement des pages, mot de passe s'il est protégé. */
export function pdfOptions(update: BusyUpdate, verb = 'Lecture du PDF'): PdfOptions {
  return {
    onProgress: (done, total) => update(done / total, `${verb} : page ${done} sur ${total}…`),
    askPassword: (retry) => passwordDialog({
      title: 'PDF protégé',
      message: retry ? 'Mot de passe incorrect. Réessaie : il t’a été donné avec le fichier.' : 'Ce PDF est protégé par un mot de passe. Saisis-le pour l’ouvrir (il n’est pas enregistré).',
      confirmLabel: 'Ouvrir',
    }),
  };
}

/** Importe un fichier (sélecteur, glisser-déposer ou « Ouvrir avec ») puis ouvre le livre. */
export async function importAndOpen(file: File, navigate: Navigate): Promise<void> {
  try {
    const { book, existed } = await withBusy('Import du livre…', (update) => importBook(file, pdfOptions(update)));
    if (existed) toast(`« ${book.title} » est déjà dans ta bibliothèque.`);
    navigate({ name: 'reader', bookId: book.id });
  } catch (err) {
    if (err instanceof ImportCancelled) {
      toast('Import annulé.');
      return;
    }
    if (err instanceof ScannedPdfError) {
      await infoDialog('PDF sans texte', [
        'Les pages de ce PDF sont des images : c’est un livre scanné (photographié page par page). Liseuse lit le texte des livres, et ce fichier n’en contient pas.',
        'Astuce : dans une autre appli, si tu ne peux pas sélectionner un mot du PDF, c’est qu’il est scanné. Cherche une version numérique (EPUB ou PDF dont le texte se sélectionne).',
      ]);
      return;
    }
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

/** Bilan d'un import de plusieurs livres. */
export interface ImportOutcome {
  added: string[];
  existing: string[];
  failed: string[];
}

function failureReason(err: unknown): string {
  if (err instanceof DrmError) return 'livre protégé (DRM)';
  if (err instanceof ScannedPdfError) return 'PDF sans texte (pages en images)';
  if (err instanceof ImportCancelled) return 'import annulé';
  return errorMessage(err);
}

/**
 * Importe plusieurs livres l'un après l'autre (trouvés dans le téléphone), sans les ouvrir :
 * un livre qui échoue n'arrête pas les suivants.
 */
export async function importBooks(items: { name: string; read: () => Promise<File> }[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: [], existing: [], failed: [] };
  await withBusy('Import des livres…', async (update) => {
    for (const [i, item] of items.entries()) {
      const label = `${i + 1} sur ${items.length} : ${item.name}`;
      update(i / items.length, label);
      try {
        const file = await item.read();
        const { book, existed } = await importBook(file, pdfOptions((p, message) => update((i + p) / items.length, message ? `${i + 1} sur ${items.length} · ${message}` : label)));
        (existed ? outcome.existing : outcome.added).push(book.title);
      } catch (err) {
        if (!(err instanceof ImportCancelled)) logError('import', err);
        outcome.failed.push(`${item.name} : ${failureReason(err)}`);
      }
    }
  });
  return outcome;
}
