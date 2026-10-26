import { expect, test, type Page } from '@playwright/test';
import { importFile, selectText, watchErrors } from './helpers';

const BOOK = `# Photosynthèse

La photosynthèse transforme la lumière en énergie chimique grâce à la chlorophylle.

Étapes principales :

1. Absorption de la lumière.
2. Photolyse de l'eau.
3. Cycle de Calvin.

# Respiration

La respiration cellulaire libère l'énergie du glucose dans les mitochondries.
`;

async function openBook(page: Page): Promise<void> {
  await page.goto('/');
  await importFile(page, 'bio.md', 'text/markdown', Buffer.from(BOOK));
  await expect(page.getByTestId('reader-chapter')).toHaveText('Photosynthèse');
}

async function createQaCard(page: Page): Promise<void> {
  await selectText(page, 'La photosynthèse transforme', 'chlorophylle.');
  await page.getByTestId('card-from-selection').click();
  const editor = page.getByTestId('card-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('card-save').click();
  await expect(editor.getByRole('alert')).toHaveText('Écris la question.');
  await editor.getByRole('button', { name: 'Pourquoi… ?' }).click();
  await editor.getByTestId('card-question').fill('Quel est le rôle de la chlorophylle ?');
  await editor.getByTestId('card-answer').fill('Capter la lumière pour la transformer en énergie chimique.');
  await editor.getByTestId('card-save').click();
  await expect(editor).toBeHidden();
}

test.describe('Étape 3 — fiches et révision', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await openBook(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('crée une fiche depuis une sélection et la révise jusqu’au bout', async ({ page }) => {
    await createQaCard(page);
    await expect(page.locator('mark.hl-card')).toHaveCount(1);
    await expect(page.getByTestId('toast')).toContainText('Fiche créée');

    await page.getByTestId('back').click();
    const banner = page.getByTestId('review-banner');
    await expect(banner).toContainText('1 fiche à réviser');
    await expect(banner).toContainText('1 nouvelle');
    await page.getByTestId('start-review').click();

    // Première présentation : rappel écrit, confiance, puis correction.
    await expect(page.getByTestId('review-question')).toHaveText('Quel est le rôle de la chlorophylle ?');
    await expect(page.getByTestId('review-progress')).toHaveText('1 / 1');
    await page.getByTestId('review-attempt').fill('Elle fabrique du sucre');
    await page.getByTestId('confidence-3').click();
    await expect(page.getByTestId('review-answer')).toHaveText('Capter la lumière pour la transformer en énergie chimique.');
    await expect(page.getByText('Elle fabrique du sucre')).toBeVisible();
    await expect(page.getByTestId('grade-4')).toContainText(/\d+ j/);

    // Erreur commise avec assurance → mise en garde (hypercorrection), puis la fiche revient.
    await page.getByTestId('grade-1').click();
    await expect(page.getByTestId('surprise')).toContainText('Surprise');
    await page.getByTestId('surprise-continue').click();
    await expect(page.getByTestId('review-question')).toHaveText('Quel est le rôle de la chlorophylle ?');

    // Réapprentissage dans la séance : on répond « Bien » jusqu'à ce qu'elle sorte de la séance.
    const done = page.getByTestId('review-done');
    const ask = page.getByTestId('confidence-2');
    for (let i = 0; i < 5; i++) {
      await expect(done.or(ask)).toBeVisible();
      if (await done.isVisible()) break;
      await ask.click();
      await page.keyboard.press('3');
    }
    await expect(done).toBeVisible();
    await expect(done.getByTestId('stat-count')).not.toHaveText('1');
    await expect(done).toContainText('Prochaine révision');

    // Après rechargement : plus rien à faire aujourd'hui.
    await page.reload();
    await expect(page.getByTestId('review-banner')).toContainText('Tout est à jour');
    await expect(page.getByTestId('start-review')).toHaveCount(0);
  });

  test('fiche « étapes » créée depuis un surlignage, révisée dans l’ordre', async ({ page }) => {
    await selectText(page, 'Absorption', 'Cycle de Calvin.');
    await page.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).not.toHaveCount(0);
    await expect(page.locator('mark.hl-card')).toHaveCount(0);

    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: /Passages/ }).click();
    await page.getByTestId('toc-edit-card').click();
    const editor = page.getByTestId('card-editor');
    await editor.getByText('Étapes dans l’ordre').click();
    await expect(editor.getByTestId('card-question')).toHaveValue('Quelles sont les étapes, dans l’ordre ?');
    await editor.getByRole('button', { name: 'Reprendre le passage' }).click();
    await expect(editor.getByTestId('card-steps')).toHaveValue('Absorption de la lumière.\nPhotolyse de l\'eau.\nCycle de Calvin.');
    await editor.getByTestId('card-save').click();
    await expect(page.locator('mark.hl-card')).not.toHaveCount(0);

    await page.getByTestId('back').click();
    await page.getByTestId('start-review').click();
    await page.getByTestId('confidence-2').click();
    await expect(page.getByTestId('review-answer').locator('li')).toHaveText(['Absorption de la lumière.', 'Photolyse de l\'eau.', 'Cycle de Calvin.']);
  });

  test('supprimer la fiche garde le surlignage ; retirer le passage demande confirmation', async ({ page }) => {
    await createQaCard(page);
    await page.locator('mark.hl-card').first().click();
    await page.getByTestId('edit-card').click();
    await page.getByTestId('card-demote').click();
    await expect(page.locator('mark.hl-card')).toHaveCount(0);
    await expect(page.locator('mark.hl')).not.toHaveCount(0);

    await page.getByTestId('back').click();
    await expect(page.getByTestId('review-banner')).toHaveCount(0);

    await page.getByTestId('book-item').getByRole('button').first().click();
    await page.locator('mark.hl').first().click();
    await page.getByTestId('edit-card').click();
    await page.getByTestId('card-editor').getByTestId('card-question').fill('Q ?');
    await page.getByTestId('card-editor').getByTestId('card-answer').fill('R.');
    await page.getByTestId('card-save').click();
    await page.locator('mark.hl-card').first().click();
    await page.getByTestId('remove-highlight').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(page.locator('mark.hl-card')).not.toHaveCount(0);
    await page.locator('mark.hl-card').first().click();
    await page.getByTestId('remove-highlight').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retirer' }).click();
    await expect(page.locator('mark.hl')).toHaveCount(0);
  });
});
