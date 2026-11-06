import { expect, test, type Page } from '@playwright/test';
import { hideChrome, importFile, showChrome, tapReader, watchErrors } from './helpers';

const BOOK = `# Relire ou se tester

La **relecture** donne une *illusion de compétence* : le texte paraît familier.

## Reconnaître n'est pas se souvenir

- reconnaissance visuelle
- rappel actif

Se tester oblige à chercher en mémoire.

# Les lacunes

Les trous révèlent ce qui n'a pas été compris.

# Annexe

${'Un long paragraphe annexe pour remplir plusieurs pages. '.repeat(120)}
`;

async function openBook(page: Page): Promise<void> {
  await page.goto('/');
  await importFile(page, 'methode.md', 'text/markdown', Buffer.from(BOOK));
  await expect(page.getByTestId('reader-chapter')).toHaveText('Relire ou se tester');
  // L'objectif du livre est proposé d'abord ; ces tests portent sur l'aperçu des chapitres.
  await page.getByTestId('goal-box').getByTestId('skip-goal').click();
}

test.describe('Méthode Lire · Poser · Récupérer', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('aperçu du chapitre, question directrice, fiche créée à la restitution', async ({ page }) => {
    await openBook(page);
    const box = page.getByTestId('guide-box');
    await expect(box).toContainText('Avant de lire');
    await box.getByTestId('start-survey').click();

    const survey = page.getByTestId('survey-sheet');
    await expect(survey.getByTestId('survey-headings')).toContainText('Reconnaître n\'est pas se souvenir');
    await expect(survey.getByTestId('survey-bold')).toContainText('relecture');
    await expect(survey.getByTestId('survey-italic')).toContainText('illusion de compétence');
    await expect(survey.getByTestId('survey-lists')).toContainText('rappel actif');
    // Question vide refusée, question vague signalée.
    await survey.getByTestId('guide-save').click();
    await expect(survey.getByTestId('guide-warning')).toContainText('Écris une question');
    await survey.getByTestId('guide-question').fill('De quoi parle ce chapitre ?');
    await expect(survey.getByTestId('guide-warning')).toContainText('n’importe quel passage');
    await survey.getByTestId('guide-question').fill('Pourquoi la relecture donne-t-elle une illusion de savoir ?');
    await expect(survey.getByTestId('guide-warning')).toBeHidden();
    await survey.getByTestId('guide-save').click();
    await expect(survey).toHaveCount(0);

    await expect(box.getByTestId('guide-current')).toContainText('Pourquoi la relecture');
    await expect(page.getByTestId('question-bar')).toHaveText('Pourquoi la relecture donne-t-elle une illusion de savoir ?');
    await expect(page.getByTestId('chapter-end').getByTestId('end-question')).toContainText('Pourquoi la relecture');

    await page.getByTestId('start-recall').click();
    const sheet = page.getByTestId('recall-sheet');
    await expect(sheet).toContainText('Pourquoi la relecture donne-t-elle une illusion de savoir ?');
    await sheet.getByTestId('recall-answered-partly').click();
    await sheet.getByTestId('recall-main').fill('La familiarité du texte se confond avec le souvenir.');
    await sheet.getByTestId('recall-finish').click();
    await expect(sheet.getByTestId('recall-guide-card')).toBeChecked();
    await sheet.getByTestId('recall-done').click();
    await expect(page.getByTestId('toast')).toContainText('Rappel enregistré');

    // La fiche existe (sans surlignage dans le texte) et part en révision.
    await expect(page.locator('mark.hl')).toHaveCount(0);
    await showChrome(page);
    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: /Passages/ }).click();
    await expect(page.getByTestId('highlight-item')).toContainText('Pourquoi la relecture');
    await page.keyboard.press('Escape');
    await page.getByTestId('back').click();
    await page.getByTestId('start-review').click();
    await expect(page.getByTestId('review-chapter')).toHaveText('Relire ou se tester');
    await expect(page.locator('.review-question')).toHaveText('Pourquoi la relecture donne-t-elle une illusion de savoir ?');
    // Fiche de question directrice : pas d'indice « début du passage » (ce serait le début du chapitre).
    await expect(page.getByTestId('show-start')).toHaveCount(0);

    // La question survit au rechargement.
    await page.goto('/');
    await page.getByTestId('continue-reading').click();
    await expect(page.getByTestId('question-bar')).toHaveText(/Pourquoi la relecture/);
  });

  test('« Plus tard » masque la proposition ; la méthode guidée se désactive', async ({ page }) => {
    await openBook(page);
    await page.getByTestId('guide-box').getByTestId('skip-survey').click();
    await expect(page.getByTestId('guide-box')).toBeHidden();
    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('guide-box')).toBeVisible();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('set-guided').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('guide-box')).toBeHidden();
    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('guide-box')).toBeHidden();
  });

  test('chapitres choisis : la progression ne compte qu’eux', async ({ page }) => {
    await openBook(page);
    await page.getByTestId('open-toc').click();
    const toc = page.getByTestId('toc-sheet');
    await toc.getByRole('button', { name: 'Ajouter à mon objectif : Relire ou se tester' }).click();
    await toc.getByRole('button', { name: 'Ajouter à mon objectif : Les lacunes' }).click();
    await expect(toc.getByTestId('focus-hint')).toContainText('2 chapitres choisis');
    await page.keyboard.press('Escape');
    // Premier chapitre lu en entier (il tient sur un écran) : 1 chapitre choisi sur 2.
    await expect(page.getByTestId('status-progress')).toHaveText(/^50 %/);
    await page.getByTestId('back').click();
    await expect(page.getByTestId('book-meta')).toContainText('objectif : 2 chap.');
    await expect(page.getByTestId('book-meta')).toContainText('50 % lu');

    await page.getByTestId('continue-reading').click();
    await page.getByTestId('open-toc').click();
    await toc.getByTestId('focus-clear').click();
    await expect(toc.getByTestId('focus-hint')).toContainText('Tu n’es pas obligé');
  });

  test('signets : ajout, liste, retour, suppression', async ({ page }) => {
    await openBook(page);
    await page.getByTestId('next-chapter').click();
    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Annexe');
    await hideChrome(page);
    await tapReader(page, 0.9);
    await tapReader(page, 0.9);
    await expect(page.getByTestId('status-page')).toHaveText(/^3 \//);
    await showChrome(page);
    await page.getByTestId('toggle-bookmark').click();
    await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();
    await expect(page.getByTestId('toggle-bookmark')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('prev-chapter').click();
    await expect(page.getByTestId('bookmark-ribbon')).toBeHidden();
    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: 'Signets (1)' }).click();
    await expect(page.getByTestId('bookmark-item')).toContainText('Annexe');
    await page.getByTestId('bookmark-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Annexe');
    await expect(page.getByTestId('status-page')).toHaveText(/^3 \//);
    await expect(page.getByTestId('bookmark-ribbon')).toBeVisible();

    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: 'Signets (1)' }).click();
    await page.getByTestId('bookmark-delete').click();
    await expect(page.getByRole('tab', { name: 'Signets (0)' })).toBeVisible();
  });

  test('défilement automatique : pages tournées seules, vitesse, pause, arrêt', async ({ page }) => {
    await page.clock.install();
    await openBook(page);
    await page.getByTestId('next-chapter').click();
    await page.getByTestId('next-chapter').click();
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
    await page.getByTestId('auto-scroll').click();
    const bar = page.getByTestId('auto-bar');
    await expect(bar.getByTestId('auto-speed')).toHaveText('Vitesse 4 · 13 s/page');
    await bar.getByTestId('auto-faster').click();
    await expect(bar.getByTestId('auto-speed')).toHaveText('Vitesse 5 · 11 s/page');
    await page.clock.runFor(11_500);
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \//);
    // Un tap met en pause.
    await tapReader(page, 0.5);
    await page.clock.runFor(30_000);
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \//);
    await bar.getByTestId('auto-stop').click();
    await expect(bar).toBeHidden();
  });
});

test.describe('Bibliothèque premium', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('étagère en grille, couvertures générées, tri et vue mémorisés, « Continuer la lecture »', async ({ page }) => {
    for (const [name, title] of [['zeta.md', 'Zêta'], ['alpha.md', 'Alpha']] as const) {
      await importFile(page, name, 'text/markdown', Buffer.from(`# ${title}\n\nTexte de ${title}.\n\n# Suite\n\nFin.`));
      await expect(page.getByTestId('reader-title')).toHaveText(name.replace('.md', ''));
      await page.getByTestId('back').click();
    }
    await expect(page.locator('.book-grid')).toHaveCount(1);
    await expect(page.locator('.book-item .book-cover-made')).toHaveCount(2);
    await expect(page.getByTestId('continue-card')).toContainText('alpha');
    await expect(page.locator('.book-item .book-title').first()).toHaveText('alpha');

    await page.getByTestId('shelf-sort').selectOption('title');
    await expect(page.locator('.book-item .book-title')).toHaveText(['alpha', 'zeta']);
    await page.getByTestId('shelf-view').click();
    await expect(page.locator('.book-grid')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('shelf-sort')).toHaveValue('title');
    await expect(page.locator('.book-grid')).toHaveCount(0);
    await page.getByTestId('continue-reading').click();
    await expect(page.getByTestId('reader-title')).toHaveText('alpha');
  });
});
