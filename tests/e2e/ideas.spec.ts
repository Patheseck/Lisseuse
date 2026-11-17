import { expect, test } from '@playwright/test';
import { importFile, watchErrors } from './helpers';

const BOOK = `# Le sommeil

Pendant le sommeil profond, le cerveau rejoue ce qu'il a appris dans la journée.

# Annexe

Références.
`;

test.describe('Idées centrales et liens', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('restitution : idées centrales, liens entre elles, fiches créées et rappel en fin de chapitre', async ({ page }) => {
    await page.goto('/');
    await importFile(page, 'sommeil.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Le sommeil');
    await page.evaluate(() => (document.querySelector('[data-testid=start-recall]') as HTMLButtonElement).click());

    const sheet = page.getByTestId('recall-sheet');
    await expect(sheet).toContainText('2. Les idées centrales, une par ligne');
    await sheet.getByTestId('recall-main').fill('Le sommeil consolide les souvenirs');
    await sheet.getByTestId('recall-text').fill('- Le cerveau rejoue la journée\n- Le manque de sommeil fait oublier');
    await sheet.getByTestId('recall-finish').click();

    // Relier les idées, de mémoire.
    await expect(sheet).toContainText('Relier tes idées');
    await expect(sheet.getByTestId('link-from').locator('option')).toHaveCount(3);
    await sheet.getByTestId('link-from').selectOption({ label: 'Le cerveau rejoue la journée' });
    await sheet.getByTestId('link-relation').selectOption('cause');
    await sheet.getByTestId('link-to').selectOption({ label: 'Le sommeil consolide les souvenirs' });
    await sheet.getByTestId('link-add').click();
    await expect(sheet.getByTestId('link-item')).toHaveText(/Le cerveau rejoue la journée → entraîne → Le sommeil consolide les souvenirs/);
    // Même idée des deux côtés : refusé.
    await sheet.getByTestId('link-to').selectOption({ label: 'Le cerveau rejoue la journée' });
    await sheet.getByTestId('link-add').click();
    await expect(sheet).toContainText('Choisis deux idées différentes');
    await sheet.getByTestId('links-continue').click();

    // Comparaison : les idées et les liens sont repris, les fiches proposées.
    await expect(sheet).toContainText('• Le manque de sommeil fait oublier');
    await expect(sheet.getByTestId('recall-ideas-card')).toBeChecked();
    await expect(sheet.getByTestId('recall-link-cards')).toBeChecked();
    await sheet.getByTestId('recall-done').click();

    const end = page.getByTestId('chapter-end');
    await expect(end.getByTestId('end-ideas')).toContainText('Le manque de sommeil fait oublier');
    await expect(end.getByTestId('end-links')).toContainText('→ entraîne →');

    // Les deux fiches de synthèse sont dans « Mes fiches » et en révision.
    await page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());
    await page.getByTestId('open-cards').click();
    await page.getByTestId('filter-type').selectOption('synthesis');
    await expect(page.getByTestId('card-row')).toHaveCount(2);
    await expect(page.getByTestId('cards-list')).toContainText('Quelles sont les idées centrales de « Le sommeil » ?');
    await expect(page.getByTestId('cards-list')).toContainText('Quel lien entre « Le cerveau rejoue la journée » et « Le sommeil consolide les souvenirs » ?');
    await page.getByTestId('card-row').filter({ hasText: 'idées centrales' }).click();
    await expect(page.getByTestId('detail-answer')).toContainText('• Le sommeil consolide les souvenirs');
    await expect(page.getByTestId('detail-passage')).toHaveCount(0);

    // Refaire la restitution ne crée pas de doublons.
    await page.keyboard.press('Escape');
    await page.getByTestId('cards-back').click();
    await page.getByTestId('continue-reading').click();
    await page.getByTestId('start-recall').waitFor({ state: 'attached' });
    await page.evaluate(() => (document.querySelector('[data-testid=start-recall]') as HTMLButtonElement).click());
    await sheet.getByTestId('recall-main').fill('Le sommeil consolide les souvenirs');
    await sheet.getByTestId('recall-text').fill('Le cerveau rejoue la journée');
    await sheet.getByTestId('recall-finish').click();
    await sheet.getByTestId('link-from').selectOption({ label: 'Le cerveau rejoue la journée' });
    await sheet.getByTestId('link-relation').selectOption('cause');
    await sheet.getByTestId('link-to').selectOption({ label: 'Le sommeil consolide les souvenirs' });
    await sheet.getByTestId('link-add').click();
    await sheet.getByTestId('links-continue').click();
    await sheet.getByTestId('recall-done').click();
    await page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());
    await page.getByTestId('open-cards').click();
    await page.getByTestId('filter-type').selectOption('synthesis');
    await expect(page.getByTestId('card-row')).toHaveCount(2);
  });
});
