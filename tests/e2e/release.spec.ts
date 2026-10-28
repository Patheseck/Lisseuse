import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { makeProtectedEpub } from '../fixtures/make-epub';
import { hideChrome, importFile, showChrome, tapReader, watchErrors } from './helpers';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

test.describe('Préparation à la vente', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('un livre protégé par DRM est refusé avec une explication', async ({ page }) => {
    await importFile(page, 'achete.epub', 'application/epub+zip', Buffer.from(await makeProtectedEpub('adobe')));
    const dialog = page.getByTestId('info-dialog');
    await expect(dialog).toContainText('Livre protégé (DRM)');
    await expect(dialog).toContainText('Adobe');
    await expect(dialog).toContainText('sans DRM');
    await dialog.getByTestId('info-ok').click();
    await expect(page.getByTestId('empty-library')).toBeVisible();
  });

  test('un PDF est refusé clairement', async ({ page }) => {
    errors.length = 0;
    await importFile(page, 'cours.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n...'));
    await expect(page.getByTestId('toast')).toContainText('PDF');
    errors.length = 0; // l'échec d'import est journalisé en console volontairement
  });

  test('un texte d’un seul tenant est découpé en chapitres, et les pages tournent', async ({ page }) => {
    // Un paragraphe par ligne, sans ligne vide (courant dans les .txt) ; chapitre II très long.
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Paragraphe ${i} de ce long récit écrit sans aucun titre Markdown, une ligne par paragraphe comme souvent.`).join('\n');
    const txt = `Mon roman\nCHAPITRE PREMIER\n${lines(60)}\nCHAPITRE II\n${lines(900)}\nÉpilogue\nFin de l’histoire, enfin, après tant de pages et de paragraphes écrits une ligne à la fois.`;
    await importFile(page, 'roman.txt', 'text/plain', Buffer.from(txt));
    await expect(page.getByTestId('reader-chapter')).toHaveText('CHAPITRE PREMIER');
    await expect(page.getByTestId('chapter-position')).toHaveText('1 / 5');
    await page.getByTestId('open-toc').click();
    await expect(page.getByTestId('toc-sheet').locator('.toc-item')).toHaveText(['CHAPITRE PREMIER', 'CHAPITRE II', 'CHAPITRE II (2/3)', 'CHAPITRE II (3/3)', 'Épilogue']);
    await expect(page.getByTestId('toc-sheet').locator('.toc-sub')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await hideChrome(page);
    await tapReader(page, 0.9);
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \//);
  });

  test('langue du livre : césure et voix dans la langue du texte', async ({ page }) => {
    await importFile(page, 'english.epub', 'application/epub+zip', Buffer.from(await makeProtectedEpub('fonts')));
    await expect(page.getByTestId('reader-content')).toHaveAttribute('lang', 'en-GB');
    await showChrome(page);
    await page.getByTestId('back').click();
    await importFile(page, 'notes.md', 'text/markdown', Buffer.from('# Notes\n\nLa mémoire se consolide pendant le sommeil, et il faut se tester pour retenir ce que l’on a lu dans le chapitre.'));
    await expect(page.getByTestId('reader-content')).toHaveAttribute('lang', 'fr');
  });

  test('« À propos » : version, confidentialité et licences des logiciels libres', async ({ page }) => {
    await page.getByTestId('open-data').click();
    await expect(page.getByTestId('storage-usage')).toContainText('Mo');
    await page.getByTestId('open-about').click();
    const about = page.getByTestId('about-sheet');
    await expect(about.getByTestId('about-version')).toHaveText(`Version ${version}`);
    await expect(about.getByTestId('about-privacy')).toContainText('hors ligne');
    await about.getByTestId('about-licenses').locator('summary').click();
    const licenses = about.getByTestId('licenses-text');
    await expect(licenses).toContainText('dompurify');
    await expect(licenses).toContainText('SIL Open Font License');
    await expect(licenses).toContainText('Apache License');
    await expect(licenses).toContainText('AndroidX');
  });
});
