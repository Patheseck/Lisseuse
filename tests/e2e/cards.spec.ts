import { expect, test, type Page } from '@playwright/test';
import { importFile, selectText, watchErrors } from './helpers';

const BOOK = `# Mémoire

La consolidation transforme un souvenir fragile en souvenir durable.

Le sommeil profond favorise la consolidation des apprentissages.

# Oubli

La courbe de l'oubli décroît rapidement les premiers jours.
`;

async function createCard(page: Page, from: string, to: string, question: string, answer: string): Promise<void> {
  await selectText(page, from, to);
  await page.getByTestId('card-from-selection').click();
  await page.getByTestId('card-question').fill(question);
  await page.getByTestId('card-answer').fill(answer);
  await page.getByTestId('card-save').click();
  await expect(page.getByTestId('card-editor')).toHaveCount(0);
}

const back = (page: Page) => page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());

test.describe('Mes fiches', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
    await importFile(page, 'memoire.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Mémoire');
    await createCard(page, 'Le sommeil', 'apprentissages.', 'Quel est le rôle du sommeil profond ?', 'Il favorise la consolidation.');
    await selectText(page, 'La consolidation', 'durable.');
    await page.getByTestId('highlight-selection').click();
    await page.getByTestId('next-chapter').click();
    await createCard(page, 'La courbe', 'jours.', 'Comment évolue l’oubli après une lecture ?', 'Très vite les premiers jours.');
    await back(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('toutes les fiches sans ouvrir de livre : recherche, filtres, détail', async ({ page }) => {
    await expect(page.getByTestId('cards-entry')).toContainText('2 fiches · 1 passage surligné');
    await page.getByTestId('cards-entry').click();
    await expect(page.getByTestId('cards-summary')).toHaveText('2 fiches · 0 à revoir aujourd’hui · 0 maîtrisée · 1 passage surligné');
    await expect(page.getByTestId('card-row')).toHaveCount(3);
    await expect(page.getByTestId('cards-group')).toHaveText(['memoire · Mémoire', 'memoire · Oubli']);

    await page.getByTestId('cards-search').fill('SOMMEIL');
    await expect(page.getByTestId('card-row')).toHaveCount(1);
    await page.getByTestId('cards-search').fill('');
    await page.getByTestId('filter-type').selectOption('highlight');
    await expect(page.getByTestId('card-row')).toHaveCount(1);
    await expect(page.getByTestId('card-status')).toHaveText('Passage surligné');
    await page.getByTestId('filter-type').selectOption('all');
    await page.getByTestId('cards-state-new').click();
    await expect(page.getByTestId('card-row')).toHaveCount(2);
    await expect(page.getByTestId('cards-state-new')).toContainText('2');

    // Détail d'une fiche.
    await page.getByTestId('card-row').filter({ hasText: 'sommeil' }).click();
    const detail = page.getByTestId('card-detail');
    await expect(detail.getByTestId('detail-question')).toHaveText('Quel est le rôle du sommeil profond ?');
    await expect(detail.getByTestId('detail-answer')).toContainText('Il favorise la consolidation.');
    await expect(detail.getByTestId('detail-passage')).toContainText('Le sommeil profond');
    await expect(detail.getByTestId('detail-history')).toContainText('aucune');
    await expect(detail.getByTestId('detail-where')).toHaveText('Mémoire');
  });

  test('pause, révision immédiate, remise à zéro et suppression', async ({ page }) => {
    await expect(page.getByTestId('review-banner')).toContainText('2 fiches à réviser');
    await page.getByTestId('open-cards').click();
    const detail = page.getByTestId('card-detail');

    // En pause : la fiche sort des révisions.
    await page.getByTestId('card-row').filter({ hasText: 'oubli' }).click();
    await detail.getByTestId('card-pause').click();
    await expect(page.getByTestId('toast').last()).toContainText('Fiche en pause');
    await expect(detail.getByTestId('card-review-now')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('card-row').filter({ hasText: 'oubli' }).getByTestId('card-status')).toHaveText('En pause');
    await page.getByTestId('cards-back').click();
    await expect(page.getByTestId('review-banner')).toContainText('1 fiche à réviser');

    // Réviser maintenant une fiche précise, puis revenir à « Mes fiches ».
    await page.getByTestId('open-cards').click();
    await page.getByTestId('card-row').filter({ hasText: 'sommeil' }).click();
    await detail.getByTestId('card-review-now').click();
    await expect(page.locator('.review-question')).toHaveText('Quel est le rôle du sommeil profond ?');
    await page.getByTestId('confidence-3').click();
    await page.getByTestId('grade-3').click();
    // « Bien » sur une nouvelle fiche : elle revient dans la séance (réapprentissage).
    const done = page.getByTestId('review-done');
    const ask = page.getByTestId('confidence-3');
    for (;;) {
      // Attendre l'écran suivant (question ou fin de séance) avant de décider.
      await expect(ask.or(done)).toBeVisible();
      if (await done.isVisible()) break;
      await ask.click();
      await page.getByTestId('grade-4').click();
    }
    await done.getByRole('button', { name: 'Retour à mes fiches' }).click();
    await page.getByTestId('card-row').filter({ hasText: 'sommeil' }).click();
    await expect(detail.getByTestId('detail-history')).toContainText('réussie');
    await expect(detail.getByTestId('detail-memory')).toContainText('%');

    // Recommencer à zéro.
    await detail.getByTestId('card-reset').click();
    await page.locator('dialog.dialog').getByRole('button', { name: 'Recommencer', exact: true }).click();
    await expect(page.getByTestId('toast').last()).toContainText('remise à zéro');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('card-row').filter({ hasText: 'sommeil' }).getByTestId('card-status')).toHaveText('Nouvelle');

    // Supprimer.
    await page.getByTestId('card-row').filter({ hasText: 'sommeil' }).click();
    await detail.getByTestId('card-delete').click();
    await page.locator('dialog.dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByTestId('card-row')).toHaveCount(2);
  });

  test('« Aller au passage » ouvre le livre au bon chapitre, puis « Revenir à ma lecture »', async ({ page }) => {
    // La lecture en était au chapitre « Oubli ».
    await page.getByTestId('open-cards').click();
    await page.getByTestId('card-row').filter({ hasText: 'sommeil' }).click();
    await page.getByTestId('card-detail').getByTestId('card-goto').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Mémoire');
    await expect(page.locator('mark.flash')).toHaveCount(1);
    await expect(page.getByTestId('return-bar')).toBeVisible();
    await page.getByTestId('return-to-reading').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Oubli');
  });

  test('un passage surligné se transforme en fiche depuis « Mes fiches »', async ({ page }) => {
    await page.getByTestId('open-cards').click();
    await page.getByTestId('card-row').filter({ hasText: 'La consolidation transforme' }).click();
    const detail = page.getByTestId('card-detail');
    await expect(detail.getByTestId('card-review-now')).toHaveCount(0);
    await detail.getByTestId('card-edit').click();
    await page.getByTestId('card-question').fill('Que fait la consolidation d’un souvenir ?');
    await page.getByTestId('card-answer').fill('Elle le rend durable.');
    await page.getByTestId('card-save').click();
    await expect(detail.getByTestId('detail-question')).toHaveText('Que fait la consolidation d’un souvenir ?');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cards-summary')).toContainText('3 fiches');
  });
});
