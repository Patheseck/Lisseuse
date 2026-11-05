import { expect, test, type Page } from '@playwright/test';
import { filler, makePdf, typesetBook, type BookSpec } from '../fixtures/make-pdf';
import { importFile, selectText, watchErrors } from './helpers';

const BOOK: BookSpec = {
  title: 'Le Sommeil et la Mémoire',
  author: 'Claire Dupont',
  outline: true,
  furniture: true,
  chapters: [
    {
      title: 'Chapitre 1 — Dormir',
      footnote: 'Selon une étude de 2004.',
      paragraphs: [
        ['Pendant le sommeil profond, le cerveau rejoue les souve-', 'nirs de la journée. Il faut peut-', 'être dormir davantage, c’est-à-', 'dire au moins sept heures.'],
        filler(400, 3),
        'Les souvenirs se fixent la nuit, surtout après une journée riche en découvertes.',
      ],
    },
    { title: 'Chapitre 2 — Rêver', paragraphs: [filler(150, 5), 'Le rêve mélange les souvenirs récents et anciens.'] },
  ],
};

const pdf = (spec: Partial<BookSpec> = {}) => Buffer.from(makePdf(typesetBook({ ...BOOK, ...spec })));
const click = (page: Page, testId: string) => page.evaluate((id) => (document.querySelector(`[data-testid=${id}]`) as HTMLButtonElement).click(), testId);

async function tocLabels(page: Page): Promise<string[]> {
  await click(page, 'open-toc');
  const labels = await page.getByTestId('toc-sheet').locator('.toc-item').allTextContents();
  await page.keyboard.press('Escape');
  return labels;
}

test.describe('Livres PDF', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('PDF avec signets : chapitres, texte recollé, en-têtes et numéros de page retirés, notes en fin de chapitre', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    await expect(page.getByTestId('reader-chapter')).toHaveText('Début du livre');
    expect(await tocLabels(page)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);

    await click(page, 'next-chapter');
    const content = page.getByTestId('reader-content');
    await expect(content.locator('h2')).toHaveText('Chapitre 1 — Dormir');
    await expect(content.locator('p').first()).toHaveText('Pendant le sommeil profond, le cerveau rejoue les souvenirs de la journée. Il faut peut-être dormir davantage, c’est-à-dire au moins sept heures.1');
    await expect(content.locator('sup')).toHaveText('1');
    await expect(content.locator('[role="doc-endnotes"]')).toHaveText('1. Selon une étude de 2004.');
    await expect(content.locator('[role="doc-endnotes"]')).toHaveAttribute('aria-label', 'Notes');
    // Ni l'en-tête courant (titre du livre) ni les numéros de page dans le texte.
    await expect(content).not.toContainText('Le Sommeil et la Mémoire');
    await expect(content.locator('p').filter({ hasText: /^\d+$/ })).toHaveCount(0);
    // Un paragraphe coupé par un changement de page est recollé (la note est à part).
    await expect(content.locator(':scope > p')).toHaveCount(3);
    await expect(content).toHaveAttribute('lang', 'fr');

    // Les outils de lecture marchent comme pour un EPUB.
    await selectText(page, 'Les souvenirs se fixent', 'la nuit');
    await page.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');

    // Bibliothèque : format, auteur ; le livre se rouvre sans relire le PDF.
    await click(page, 'back');
    await expect(page.getByTestId('book-meta')).toContainText('PDF');
    await expect(page.getByTestId('book-item')).toContainText('Claire Dupont');
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Chapitre 1 — Dormir');
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');
  });

  test('PDF sans signets : les titres, plus grands que le texte, font les chapitres', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf({ outline: false }));
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    expect(await tocLabels(page)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);
  });

  test('PDF sans aucune structure : découpé en tranches de pages', async ({ page }) => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => filler(200, i + 1));
    await importFile(page, 'notes.pdf', 'application/pdf', pdf({ plain: true, outline: false, title: '', chapters: [{ title: '', paragraphs }] }));
    // Sans titre dans le fichier : le nom du fichier.
    await expect(page.getByTestId('reader-title')).toHaveText('notes');
    const labels = await tocLabels(page);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels.every((l) => /^Pages? \d+( à \d+)?$/.test(l))).toBe(true);
    expect(labels[0]).toMatch(/^Pages 1 à \d+$/);
  });

  test('couverture : la première page illustrée devient la couverture', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf({ coverImage: true }));
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    await click(page, 'back');
    await expect(page.getByTestId('book-item').locator('img.book-cover')).toHaveCount(1);
  });

  test('PDF protégé par un mot de passe : demandé, vérifié, jamais gardé', async ({ page }) => {
    const file = pdf({ userPassword: 'lune' });
    await importFile(page, 'secret.pdf', 'application/pdf', file);
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toContainText('PDF protégé');
    // Abandon : rien n'est importé.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('toast').last()).toContainText('Import annulé');
    await expect(page.getByTestId('empty-library')).toBeVisible();

    await importFile(page, 'secret.pdf', 'application/pdf', file);
    await dialog.getByTestId('password').fill('soleil');
    await dialog.getByTestId('password-ok').click();
    await expect(dialog).toContainText('Mot de passe incorrect');
    await dialog.getByTestId('password').fill('lune');
    await dialog.getByTestId('password-ok').click();
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    expect(await tocLabels(page)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);
  });

  test('sans les chapitres en cache (sauvegarde restaurée) : le PDF est relu, mot de passe compris, et les surlignages tiennent', async ({ page }) => {
    await importFile(page, 'secret.pdf', 'application/pdf', pdf({ userPassword: 'lune' }));
    const dialog = page.locator('dialog.dialog');
    await dialog.getByTestId('password').fill('lune');
    await dialog.getByTestId('password-ok').click();
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    await click(page, 'next-chapter');
    await selectText(page, 'Les souvenirs se fixent', 'la nuit');
    await page.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).toHaveCount(1);
    // Le cache des chapitres disparaît (comme après une restauration sur un autre téléphone).
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('liseuse');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('chapters', 'readwrite');
        tx.objectStore('chapters').clear();
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(dialog).toContainText('PDF protégé');
    // Sans mot de passe : une explication, pas une erreur.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('reader-error')).toContainText('protégé par un mot de passe');
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await click(page, 'back');
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(dialog).toContainText('PDF protégé');
    await dialog.getByTestId('password').fill('lune');
    await dialog.getByTestId('password-ok').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Chapitre 1 — Dormir');
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');
  });

  test('PDF scanné (images seules) : refusé avec une explication', async ({ page }) => {
    const scanned = Buffer.from(makePdf({ pages: [{ runs: [], image: true }, { runs: [], image: true }], title: 'Scan' }));
    await importFile(page, 'scan.pdf', 'application/pdf', scanned);
    const dialog = page.getByTestId('info-dialog');
    await expect(dialog).toContainText('PDF sans texte');
    await expect(dialog).toContainText('scanné');
    await dialog.getByTestId('info-ok').click();
    await expect(page.getByTestId('empty-library')).toBeVisible();
  });

  test('PDF verrouillé par un DRM : refusé comme un EPUB protégé', async ({ page }) => {
    const locked = Buffer.from(makePdf({ ...typesetBook(BOOK), drm: true }));
    await importFile(page, 'achete.pdf', 'application/pdf', locked);
    const dialog = page.getByTestId('info-dialog');
    await expect(dialog).toContainText('Livre protégé (DRM)');
    await expect(dialog).toContainText('Adobe');
    await dialog.getByTestId('info-ok').click();
  });

  test('PDF abîmé : message clair', async ({ page }) => {
    await importFile(page, 'cours.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'));
    await expect(page.getByTestId('toast').last()).toContainText('Import impossible');
    errors.length = 0; // l'échec d'import est journalisé en console volontairement
  });
});
