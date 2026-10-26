import { expect, test, type Page } from '@playwright/test';
import { makeEpub3 } from '../fixtures/make-epub';

const MARKDOWN = `# Chapitre un

La photosynthèse est le processus par lequel les plantes produisent du glucose.

# Chapitre deux

${'Un paragraphe de remplissage pour faire défiler le chapitre. '.repeat(200)}

Fin du chapitre deux.
`;

/** Collecte les erreurs JavaScript et console : un test échoue s'il y en a. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function importFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer });
}

test.describe('Étape 1 — démarrage et bibliothèque', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('démarre sur une bibliothèque vide, sans erreur', async ({ page }) => {
    await expect(page.getByTestId('empty-library')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Importer' })).toBeVisible();
  });

  test('importe un Markdown, le lit et retrouve la position après rechargement', async ({ page }) => {
    await importFile(page, 'notes.md', 'text/markdown', Buffer.from(MARKDOWN));
    await expect(page.getByTestId('reader-title')).toHaveText('notes');
    await expect(page.getByTestId('reader-content')).toContainText('photosynthèse');
    await expect(page.getByTestId('chapter-position')).toHaveText('1 / 2');
    await expect(page.getByTestId('prev-chapter')).toBeDisabled();

    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('reader-content')).toContainText('Fin du chapitre deux');
    await expect(page.getByTestId('next-chapter')).toBeDisabled();
    await page.locator('.reader-scroll').evaluate((el) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    });
    await page.waitForTimeout(600); // enregistrement différé de la position

    await page.getByTestId('back').click();
    await expect(page.getByTestId('book-meta')).toContainText('2 chapitres');
    await expect(page.getByTestId('book-meta')).toContainText(/7\d % lu/);

    await page.reload();
    await expect(page.getByTestId('book-item')).toHaveCount(1);
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.getByTestId('chapter-position')).toHaveText('2 / 2');
    const ratio = await page.locator('.reader-scroll').evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight));
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  test('importe un EPUB : sommaire, couverture, image, lien interne, contenu neutralisé', async ({ page }) => {
    await importFile(page, 'livre.epub', 'application/epub+zip', Buffer.from(await makeEpub3()));
    await expect(page.getByTestId('reader-title')).toHaveText('Le Livre de Test');
    const content = page.getByTestId('reader-content');
    await expect(content).toContainText('photosynthèse');

    const img = content.locator('img');
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
    await expect(content.locator('[onclick], script, [style]')).toHaveCount(0);

    await content.getByText('Aller à la suite').click();
    await expect(page.getByTestId('chapter-position')).toHaveText('2 / 3');
    await expect(content.getByText('Voici la suite annoncée.')).toBeInViewport();

    await page.getByTestId('back').click();
    await expect(page.locator('.book-cover')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.book-author')).toHaveText('Ada Lovelace');
  });

  test('signale un doublon au lieu de créer un second livre', async ({ page }) => {
    const file = Buffer.from(MARKDOWN);
    await importFile(page, 'notes.md', 'text/markdown', file);
    await expect(page.getByTestId('reader-title')).toHaveText('notes');
    await page.getByTestId('back').click();
    await importFile(page, 'copie.md', 'text/markdown', file);
    await expect(page.getByTestId('toast')).toContainText('déjà dans ta bibliothèque');
    await page.getByTestId('back').click();
    await expect(page.getByTestId('book-item')).toHaveCount(1);
  });

  test('refuse un fichier invalide et reste utilisable', async ({ page }) => {
    errors.length = 0;
    await importFile(page, 'faux.epub', 'application/epub+zip', Buffer.from('PK pas vraiment une archive'));
    await expect(page.getByTestId('toast')).toContainText('Import impossible');
    await importFile(page, 'image.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await expect(page.getByTestId('toast').last()).toContainText('Format non pris en charge');
    await expect(page.getByTestId('empty-library')).toBeVisible();
    // Les erreurs d'import sont journalisées en console volontairement.
    errors.length = 0;
  });

  test('supprime un livre après confirmation', async ({ page }) => {
    await importFile(page, 'notes.md', 'text/markdown', Buffer.from(MARKDOWN));
    await page.getByTestId('back').click();
    await page.getByRole('button', { name: 'Supprimer notes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('book-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Supprimer notes' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('empty-library')).toBeVisible();
  });
});
