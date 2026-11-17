import { expect, test, type Page } from '@playwright/test';
import { importFile, selectText, showChrome, watchErrors } from './helpers';

const BOOK = `# La méthode des lieux

On place chaque élément à retenir dans un lieu familier, le long d'un parcours.

## Choisir son palais

Un lieu que l'on connaît par cœur, parcouru toujours dans le même ordre.

# Les erreurs fréquentes

Images trop faibles, parcours changeant, lieux trop semblables.

# Annexe

Références.
`;

async function openBook(page: Page): Promise<void> {
  await page.goto('/');
  await importFile(page, 'palais.md', 'text/markdown', Buffer.from(BOOK));
  await expect(page.getByTestId('reader-chapter')).toHaveText('La méthode des lieux');
}

test.describe('Objectif du livre', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('défini à la première ouverture, puis rappelé dans l’aperçu, la restitution, les fiches et la bibliothèque', async ({ page }) => {
    await openBook(page);
    const goalBox = page.getByTestId('goal-box');
    await expect(goalBox).toContainText('pourquoi lis-tu ce livre');
    // Une proposition à la fois : l'aperçu du chapitre attend l'objectif.
    await expect(page.getByTestId('guide-box')).toBeHidden();
    await goalBox.getByTestId('start-goal').click();

    const sheet = page.getByTestId('goal-sheet');
    await sheet.getByTestId('goal-save').click();
    await expect(sheet).toContainText('Réponds au moins à une question');
    await sheet.getByTestId('goal-about').fill('Une technique de mémorisation par les lieux.');
    await sheet.getByTestId('goal-why').fill('Retenir mes cours d’histoire.');
    await sheet.getByTestId('goal-kind-savoir-faire').click();
    await sheet.getByTestId('goal-verb').filter({ hasText: 'appliquer' }).click();
    await sheet.getByTestId('goal-capable').pressSequentially('la méthode des lieux à mes cours');
    await sheet.getByTestId('goal-known').fill('Rien, sauf le nom.');
    await sheet.getByTestId('goal-chapters').locator('summary').click();
    await sheet.getByTestId('goal-chapter').nth(0).check();
    await sheet.getByTestId('goal-chapter').nth(2).check();
    await sheet.getByTestId('goal-save').click();
    await expect(page.getByTestId('toast').last()).toContainText('Objectif enregistré');

    await expect(goalBox).toBeHidden();
    await expect(page.getByTestId('guide-box')).toBeVisible();
    await showChrome(page);
    await page.getByTestId('open-toc').click();
    await expect(page.getByTestId('toc-goal')).toContainText('être capable d’appliquer la méthode des lieux à mes cours');
    await expect(page.getByTestId('focus-hint')).toContainText('2 chapitres choisis');
    await page.keyboard.press('Escape');

    // Aperçu : l'objectif est rappelé, les exemples suivent le savoir-faire.
    await page.getByTestId('guide-box').getByTestId('start-survey').click();
    const survey = page.getByTestId('survey-sheet');
    await expect(survey.getByTestId('survey-goal')).toContainText('être capable d’appliquer');
    await expect(survey.getByTestId('guide-question')).toHaveAttribute('placeholder', /Comment faire pour/);
    await survey.getByTestId('guide-question').fill('Comment construire un palais de mémoire solide ?');
    await survey.getByTestId('guide-save').click();

    // Fiches : modèles du savoir-faire.
    await selectText(page, 'On place', 'parcours.');
    await page.getByTestId('card-from-selection').click();
    await expect(page.getByTestId('card-editor').getByRole('button', { name: 'Comment faire… ?' })).toBeVisible();
    await expect(page.getByTestId('card-editor').getByRole('button', { name: 'Quelle erreur éviter… ?' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Restitution : une action à essayer, rappelée en fin de chapitre.
    await page.evaluate(() => (document.querySelector('[data-testid=start-recall]') as HTMLButtonElement).click());
    const recall = page.getByTestId('recall-sheet');
    await expect(recall).toContainText('4. Une action à essayer');
    await recall.getByTestId('recall-main').fill('Des lieux connus servent de crochets.');
    await recall.getByTestId('recall-apply').fill('Ce soir, chez moi, je place les dates du chapitre 3 dans ma cuisine.');
    await recall.getByTestId('recall-finish').click();
    await recall.getByTestId('recall-done').click();
    await expect(page.getByTestId('chapter-end').getByTestId('end-apply')).toContainText('Une action à essayer : Ce soir, chez moi');

    // Bibliothèque : l'objectif sur « Continuer la lecture ».
    await page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());
    await expect(page.getByTestId('continue-goal')).toHaveText('Objectif : être capable d’appliquer la méthode des lieux à mes cours');
  });

  test('« Plus tard » laisse place à l’aperçu ; lecture plaisir et méthode guidée désactivée l’effacent', async ({ page }) => {
    await openBook(page);
    await page.getByTestId('goal-box').getByTestId('skip-goal').click();
    await expect(page.getByTestId('goal-box')).toBeHidden();
    await expect(page.getByTestId('guide-box')).toBeVisible();

    // Objectif « plaisir » défini depuis le sommaire : l'aperçu n'est plus proposé.
    await showChrome(page);
    await page.getByTestId('open-toc').click();
    await page.getByTestId('edit-goal').click();
    const sheet = page.getByTestId('goal-sheet');
    await sheet.getByTestId('goal-kind-plaisir').click();
    await expect(sheet.getByTestId('goal-verb')).toHaveCount(0);
    await sheet.getByTestId('goal-save').click();
    await expect(page.getByTestId('guide-box')).toBeHidden();
    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('guide-box')).toBeHidden();
    // Pas de question d'application à la restitution.
    await page.evaluate(() => (document.querySelector('[data-testid=start-recall]') as HTMLButtonElement).click());
    await expect(page.getByTestId('recall-sheet').getByTestId('recall-apply')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Nouveau livre, méthode guidée désactivée : aucun encadré.
    await page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());
    await importFile(page, 'autre.md', 'text/markdown', Buffer.from('# Un\n\nTexte.\n\n# Deux\n\nSuite.'));
    await expect(page.getByTestId('goal-box')).toBeVisible();
    await showChrome(page);
    await page.getByTestId('open-settings').click();
    await page.getByTestId('set-guided').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('goal-box')).toBeHidden();
  });
});
