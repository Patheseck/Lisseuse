import { errorMessage, logError, readErrors } from '../core/errors';
import { saveFile } from '../native/files';
import { exportBackup, readBackup, restoreBackup } from '../storage/backup';
import type { ImportReport } from '../storage/migrate-v5';
import { h } from './dom';
import { infoDialog, passwordDialog, toast, withBusy } from './feedback';
import { createSheet, type Sheet } from './sheet';

/** Affiche le bilan d'une migration ou d'une restauration. */
export function showImportReport(title: string, intro: string, r: ImportReport): Promise<void> {
  const counts = `${r.books} livre${r.books > 1 ? 's' : ''}, ${r.cards} fiche${r.cards > 1 ? 's' : ''} et ${r.reviews} révision${r.reviews > 1 ? 's' : ''}`;
  const list = (items: string[]) => h('ul', {}, ...items.map((t) => h('li', {}, t)));
  return infoDialog(title, [
    `${intro} ${counts}.`,
    r.missingBooks.length ? 'Ces livres ne sont pas dans le fichier : réimporte-les pour retrouver leurs fiches.' : null,
    r.missingBooks.length ? list(r.missingBooks) : null,
    r.failures.length ? 'Ces livres n’ont pas pu être lus :' : null,
    r.failures.length ? list(r.failures) : null,
  ]);
}

/** Panneau « Mes données » : sauvegarde, restauration, journal d'erreurs. */
export function dataSheet(onRestored: () => void): Sheet {
  const sheet = createSheet({ title: 'Mes données', kind: 'bottom', testId: 'data-sheet' });
  const includeBooks = h('input', { type: 'checkbox', id: 'backup-books', 'data-testid': 'backup-books' });
  const encrypt = h('input', { type: 'checkbox', id: 'backup-encrypt', 'data-testid': 'backup-encrypt' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', className: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'restore-input' });

  async function doExport(): Promise<void> {
    let password: string | undefined;
    if (encrypt.checked) {
      const p = await passwordDialog({ title: 'Chiffrer la sauvegarde', message: 'Sans ce mot de passe, la sauvegarde sera illisible : conserve-le précieusement.', confirm: true, confirmLabel: 'Chiffrer' });
      if (!p) return;
      password = p;
    }
    try {
      const { blob, fileName } = await withBusy('Préparation de la sauvegarde…', () => exportBackup({ includeBooks: includeBooks.checked, ...(password ? { password } : {}) }));
      await saveFile(blob, fileName);
      toast('Sauvegarde exportée.');
    } catch (err) {
      logError('sauvegarde', err);
      toast(`Sauvegarde impossible : ${errorMessage(err)}`, 'error');
    }
  }

  async function doRestore(file: File): Promise<void> {
    try {
      const parsed = await readBackup(await file.text(), () => passwordDialog({ title: 'Sauvegarde chiffrée', message: 'Saisis le mot de passe choisi lors de l’export.', confirmLabel: 'Déchiffrer' }));
      sheet.close();
      const report = await withBusy('Restauration en cours…', () => restoreBackup(parsed));
      onRestored();
      await showImportReport('Restauration terminée', parsed.kind === 'v5' ? 'Sauvegarde de la V5 reprise :' : 'Ajouté depuis la sauvegarde :', report);
    } catch (err) {
      logError('restauration', err);
      toast(`Restauration impossible : ${errorMessage(err)}`, 'error', 6000);
    }
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void doRestore(file);
  });

  const errors = readErrors();
  sheet.body.append(
    h('p', { className: 'hint' }, 'Tes livres et tes fiches restent uniquement sur cet appareil. Exporte une sauvegarde de temps en temps pour ne rien perdre.'),
    h('section', { className: 'data-section' },
      h('h3', {}, 'Sauvegarder'),
      h('label', { className: 'check', for: 'backup-books' }, includeBooks, h('span', {}, 'Inclure les fichiers des livres', h('small', {}, 'Fichier plus lourd, mais tout se restaure d’un coup.'))),
      h('label', { className: 'check', for: 'backup-encrypt' }, encrypt, h('span', {}, 'Chiffrer avec un mot de passe')),
      h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'export-backup', onclick: () => void doExport() }, 'Exporter une sauvegarde'),
    ),
    h('section', { className: 'data-section' },
      h('h3', {}, 'Restaurer'),
      h('p', { className: 'hint' }, 'Ajoute le contenu d’une sauvegarde (V6 ou V5.7) sans rien effacer : un livre déjà présent n’est jamais remplacé, et la version la plus récente de chaque fiche est conservée.'),
      h('button', { type: 'button', className: 'btn', 'data-testid': 'restore-backup', onclick: () => fileInput.click() }, 'Choisir un fichier de sauvegarde'),
      fileInput,
    ),
    h('details', { className: 'data-section' },
      h('summary', {}, `Journal d’erreurs (${errors.length})`),
      errors.length
        ? h('ol', { className: 'error-log' }, ...errors.slice().reverse().map((e) => h('li', {}, h('time', {}, new Date(e.at).toLocaleString('fr-FR')), ` ${e.context} — ${e.message}`)))
        : h('p', { className: 'hint' }, 'Aucune erreur enregistrée.'),
    ),
  );
  return sheet;
}
