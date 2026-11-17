import { expect, test } from '@playwright/test';
import { simulateAndroid } from './android-sim';
import { importFile, watchErrors } from './helpers';
import { makeEpub3 } from '../fixtures/make-epub';
import { makePdf } from '../fixtures/make-pdf';

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

test('liste longue sur un téléphone de 360 px : chaque nom a sa place, rien ne déborde', async ({ page }) => {
  // Bug corrigé : la liste, limitée en hauteur, écrasait chaque ligne à 44 px et les noms se chevauchaient ;
  // et la barre du haut élargissait la page au-delà de l'écran.
  await page.setViewportSize({ width: 360, height: 740 });
  const longName = (i: number) => `Cheikh_Anta_Diop_Nations_negres_et_culture_tome_${i}_De_l_antiquite_negre_egyptienne.pdf`;
  await simulateAndroid(page, {}, [], [], {
    files: Array.from({ length: 40 }, (_, i) => ({ path: `/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Dossier_sans_espaces_tres_long_${i}/${longName(i)}`, content: 'x'.repeat(2000 + i), modified: day(1) - i * 1000 })),
  });
  await page.goto('/');
  await importFile(page, 'cours.md', 'text/markdown', Buffer.from(COURS));
  await page.getByTestId('back').click();
  await page.getByTestId('open-import').click();
  await page.getByTestId('scan-phone').click();
  await page.getByTestId('scan-allow').click();
  await expect(page.getByTestId('scan-item')).toHaveCount(40);
  const problems = await page.getByTestId('scan-item').evaluateAll((items) => {
    const out: string[] = [];
    items.forEach((item, i) => {
      const box = item.getBoundingClientRect();
      const text = item.querySelector('small')!.getBoundingClientRect();
      if (text.bottom > box.bottom + 1) out.push(`ligne ${i} : texte qui dépasse de ${Math.round(text.bottom - box.bottom)} px`);
      const next = items[i + 1]?.getBoundingClientRect();
      if (next && next.top < box.bottom - 1) out.push(`lignes ${i} et ${i + 1} superposées`);
    });
    return out;
  });
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await expect(page.getByTestId('scan-item').first()).toContainText('WhatsApp › Documents › Dossier_sans_espaces_tres_long_0');
});

test.describe('pas de doublon', () => {
  const pdf = (text: string, title = 'LE LIVRE DE TEST (French Edition)', author = 'Lovelace, Ada') => Buffer.from(makePdf({ title, author, pages: [{ runs: [{ text, x: 72, y: 700, size: 12 }] }] }));

  test('un autre fichier du même livre n’est pas importé ; dans la liste du téléphone, il est grisé et les copies identiques regroupées', async ({ page }) => {
    const errors = watchErrors(page);
    const autre = pdf('Un autre livre.', 'Un autre livre', 'Quelqu’un');
    await simulateAndroid(page, {}, [], [], {
      files: [
        { path: '/storage/emulated/0/Download/Le Livre de Test.pdf', bytes: pdf('Une autre édition.'), modified: day(9) },
        { path: '/storage/emulated/0/Download/Un autre livre.pdf', bytes: autre, modified: day(8) },
        { path: '/storage/emulated/0/Download/Un autre livre (1).pdf', bytes: autre, modified: day(7) },
        { path: '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Un autre livre.pdf', bytes: autre, modified: day(6) },
      ],
    });
    await page.goto('/');
    await importFile(page, 'livre.epub', 'application/epub+zip', Buffer.from(await makeEpub3()));
    await page.getByTestId('back').click();
    await expect(page.getByTestId('book-item')).toHaveCount(1);

    // Le même livre en PDF, choisi directement : rien n'est ajouté, le livre présent s'ouvre.
    await page.getByTestId('open-import').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('scan-pick').click()]);
    await chooser.setFiles({ name: 'Le Livre de Test.pdf', mimeType: 'application/pdf', buffer: pdf('Une autre édition.') });
    await expect(page.getByTestId('toast').filter({ hasText: '« Le Livre de Test » est déjà dans ta bibliothèque (autre fichier du même livre) : rien n’a été ajouté.' })).toBeVisible();
    await page.getByTestId('back').click();
    await expect(page.getByTestId('book-item')).toHaveCount(1);

    // Recherche dans le téléphone.
    await page.getByTestId('open-import').click();
    await page.getByTestId('scan-phone').click();
    await page.getByTestId('scan-allow').click();
    await expect(page.getByTestId('scan-status')).toHaveText('2 livres trouvés, dont 1 déjà importé.');
    const items = page.getByTestId('scan-item');
    await expect(items.nth(0)).toContainText('Le Livre de Test.pdf');
    await expect(items.nth(0)).toContainText('déjà dans ta bibliothèque');
    await expect(items.nth(0).getByRole('checkbox')).toBeDisabled();
    await expect(items.nth(1)).toContainText('Un autre livre.pdf');
    await expect(items.nth(1)).toContainText('3 copies identiques');
    await items.nth(1).getByRole('checkbox').check();
    await page.getByTestId('scan-import').click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await page.goto('/');
    await expect(page.getByTestId('book-item')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('doublons déjà présents (restaurés) : signalés dans la bibliothèque, avec le nombre de fiches de chacun', async ({ page }) => {
    const entry = (id: string, bytes: Buffer) => ({ schemaVersion: 1, id, title: 'Le Livre de Test', author: 'Ada Lovelace', format: 'pdf', fileName: `${id}.pdf`, chapterCount: 0, chapterLabels: [], addedAt: 1, lastOpenedAt: 1, layout: 1, pageCount: 1, file: { type: 'application/pdf', data: bytes.toString('base64') } });
    const backup = { app: 'liseuse', format: 6, exportedAt: new Date().toISOString(), includesBooks: true, books: [entry('copie-a', pdf('Première.')), entry('copie-b', pdf('Seconde.'))], cards: [], reviews: [], progress: [], settings: [] };
    await page.goto('/');
    await expect(page.getByTestId('duplicates-banner')).toHaveCount(0);
    await page.getByTestId('open-data').click();
    await page.getByTestId('restore-input').setInputFiles({ name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByTestId('info-ok').click();
    const banner = page.getByTestId('duplicates-banner');
    await expect(banner).toContainText('Un livre en double : garde l’exemplaire où sont tes fiches et supprime l’autre avec la corbeille de sa couverture.');
    await expect(banner.getByRole('listitem')).toHaveText(['« Le Livre de Test » : PDF (0 fiche), PDF (0 fiche)']);
  });
});

test('dans un navigateur, « + Importer » ouvre directement le sélecteur de fichiers', async ({ page }) => {
  await page.goto('/');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('open-import').click()]);
  expect(chooser.isMultiple()).toBe(false);
  await expect(page.getByTestId('import-sheet')).toHaveCount(0);
});
