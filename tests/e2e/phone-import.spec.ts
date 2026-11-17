import { expect, test } from '@playwright/test';
import { simulateAndroid } from './android-sim';
import { importFile, watchErrors } from './helpers';

// « Importer » dans l'app Android simulée : recherche dans la mémoire du téléphone (avec
// l'autorisation « Accès à tous les fichiers »), ou sélecteur de fichiers (Google Drive compris).

const COURS = '# Un\n\nPremier chapitre avec du texte.\n';
const day = (d: number) => Date.parse(`2026-11-${String(d).padStart(2, '0')}T10:00:00Z`);

test.describe('importer depuis la mémoire du téléphone (app Android simulée)', () => {
  test('livres : autorisation demandée, livres trouvés, déjà importés signalés, plusieurs importés d’un coup', async ({ page }) => {
    const errors = watchErrors(page);
    await simulateAndroid(page, {}, [], [], {
      files: [
        { path: '/storage/emulated/0/Download/cours.md', content: COURS, modified: day(3) },
        { path: '/storage/emulated/0/Download/Telegram/Histoire du Sénégal.md', content: '# Histoire\n\nTexte du livre.\n', modified: day(5) },
        { path: '/storage/emulated/0/Documents/Notes #1.txt', content: 'Notes de lecture.\n\nDeuxième paragraphe.\n', modified: day(1) },
        { path: '/storage/emulated/0/Documents/table.json', content: '{}' },
      ],
    });
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from(COURS));
    await page.getByTestId('back').click();

    await page.getByTestId('open-import').click();
    const sheet = page.getByTestId('import-sheet');
    await expect(sheet.getByTestId('scan-drive-hint')).toContainText('☰ › Drive');
    await sheet.getByTestId('scan-phone').click();
    await expect(sheet.getByTestId('scan-permission')).toContainText('« Accès à tous les fichiers »');
    await sheet.getByTestId('scan-allow').click();
    await expect(sheet.getByTestId('scan-status')).toHaveText('3 livres trouvés, dont 1 déjà importé.');
    const items = sheet.getByTestId('scan-item');
    await expect(items).toHaveCount(3);
    // Les plus récents d'abord ; l'emplacement est indiqué.
    await expect(items.nth(0)).toContainText('Histoire du Sénégal.md');
    await expect(items.nth(0)).toContainText('Download › Telegram · ');
    await expect(items.nth(1)).toContainText('déjà dans ta bibliothèque');
    await expect(items.nth(1).getByRole('checkbox')).toBeDisabled();
    await expect(sheet.getByTestId('scan-import')).toBeDisabled();
    await sheet.getByTestId('scan-select-all').click();
    await expect(sheet.getByTestId('scan-import')).toHaveText('Importer 2 livres');
    await sheet.getByTestId('scan-import').click();
    await expect(page.getByTestId('toast').filter({ hasText: '2 livres ajoutés à ta bibliothèque.' })).toBeVisible();
    await expect(page.getByTestId('book-item')).toHaveCount(3);
    await expect(page.getByTestId('book-item').filter({ hasText: 'Notes #1' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('un seul livre trouvé et choisi : il s’ouvre, comme un import habituel', async ({ page }) => {
    await simulateAndroid(page, {}, [], [], { files: [{ path: '/storage/emulated/0/Download/cours.md', content: COURS }] });
    await page.goto('/');
    await page.getByTestId('open-import').click();
    await page.getByTestId('scan-phone').click();
    await page.getByTestId('scan-allow').click();
    await page.getByTestId('scan-item').getByRole('checkbox').check();
    await page.getByTestId('scan-import').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Un');
  });

  test('table de rappel : le fichier Memoria est trouvé dans le téléphone et importé d’un appui', async ({ page }) => {
    const memoria = { tables: [{ id: 1, title: null, associations: [{ number: 0, value: null, name: 'Seau' }, { number: 1, value: null, name: 'Dé ' }, { number: null, value: '3', name: 'Mât' }] }] };
    await simulateAndroid(page, {}, [], [], {
      files: [
        { path: '/storage/emulated/0/Download/memoria_1767569733256_1.json', content: JSON.stringify(memoria) },
        { path: '/storage/emulated/0/Download/package.json', content: '{}' },
        { path: '/storage/emulated/0/Documents/livre.pdf', content: '%PDF' },
      ],
    });
    await page.goto('/');
    await page.getByTestId('open-data').click();
    await page.getByTestId('import-mojor').click();
    const sheet = page.getByTestId('table-import-sheet');
    await sheet.getByTestId('scan-phone').click();
    await sheet.getByTestId('scan-allow').click();
    await expect(sheet.getByTestId('scan-status')).toHaveText('1 fichier trouvé.');
    await expect(sheet.getByTestId('scan-item')).toContainText('memoria_1767569733256_1.json');
    await sheet.getByTestId('scan-item').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Table de rappel importée (Memoria) : 3 images, de 0 à 3.' })).toBeVisible();
    await expect(page.getByTestId('mojor-status')).toContainText('3 images, de 0 à 3 : il manque 2.');
  });

  test('autorisation refusée : le sélecteur de fichiers reste là (Google Drive compris)', async ({ page }) => {
    await simulateAndroid(page, {}, [], [], { grantOnRequest: false, files: [{ path: '/storage/emulated/0/Download/cours.md', content: COURS }] });
    await page.goto('/');
    await page.getByTestId('open-import').click();
    await page.getByTestId('scan-phone').click();
    await page.getByTestId('scan-allow').click();
    await expect(page.getByTestId('scan-status')).toHaveText('Autorisation non accordée : tu peux toujours choisir un fichier.');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('scan-pick').click()]);
    await chooser.setFiles({ name: 'cours.md', mimeType: 'text/markdown', buffer: Buffer.from(COURS) });
    await expect(page.getByTestId('reader-chapter')).toHaveText('Un');
  });
});

test('dans un navigateur, « + Importer » ouvre directement le sélecteur de fichiers', async ({ page }) => {
  await page.goto('/');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('open-import').click()]);
  expect(chooser.isMultiple()).toBe(false);
  await expect(page.getByTestId('import-sheet')).toHaveCount(0);
});
