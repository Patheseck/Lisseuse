import { expect, test, type Page } from '@playwright/test';
import { importFile, selectText, watchErrors } from './helpers';

const BOOK = `# Mémoire

La consolidation transforme un souvenir fragile en souvenir durable.

Le sommeil profond favorise la consolidation des apprentissages.

## Les trois étapes

Encodage, stockage, récupération.

# Oubli

La courbe de l'oubli décroît rapidement les premiers jours.
`;

async function openBook(page: Page): Promise<void> {
  await page.goto('/');
  await importFile(page, 'memoire.md', 'text/markdown', Buffer.from(BOOK));
  await expect(page.getByTestId('reader-chapter')).toHaveText('Mémoire');
}

async function createCard(page: Page, from: string, to: string, question: string, answer: string): Promise<void> {
  await selectText(page, from, to);
  await page.getByTestId('card-from-selection').click();
  await page.getByTestId('card-question').fill(question);
  await page.getByTestId('card-answer').fill(answer);
  await page.getByTestId('card-save').click();
  await expect(page.getByTestId('card-editor')).toHaveCount(0);
}

test.describe('Étape 5 — apprentissage actif', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('restitution de fin de chapitre : minuteur, 3 couches, tri des idées en 3 niveaux', async ({ page }) => {
    await page.clock.install();
    await openBook(page);
    await selectText(page, 'La consolidation', 'durable.');
    await page.getByTestId('highlight-selection').click();
    await createCard(page, 'Le sommeil', 'apprentissages.', 'Quel est le rôle du sommeil profond ?', 'Il favorise la consolidation.');

    await page.getByTestId('start-recall').click();
    const sheet = page.getByTestId('recall-sheet');
    await expect(sheet.getByTestId('recall-clock')).toHaveText('3:00');
    await page.clock.runFor(30_000);
    await expect(sheet.getByTestId('recall-clock')).toHaveText('2:30');
    await sheet.getByTestId('recall-main').fill('Le sommeil consolide les souvenirs.');
    await sheet.getByTestId('recall-text').fill('Le sommeil aide à consolider.');
    await sheet.getByTestId('recall-explain').fill('Pendant la nuit, le cerveau range ce qu’on a appris.');
    await page.clock.runFor(155_000);
    await expect(sheet).toContainText('Temps écoulé');
    await sheet.getByTestId('recall-finish').click();

    await expect(sheet).toContainText('Le sommeil aide à consolider.');
    await expect(sheet).toContainText('le cerveau range');
    const items = sheet.getByTestId('recall-item');
    await expect(items).toHaveCount(2);
    // Surlignage « mal compris » : proposé en fiche (décoché ici) ; fiche « retrouvée ».
    await items.nth(0).getByTestId('recall-level-hard').click();
    await items.nth(0).getByTestId('recall-make-card').uncheck();
    await items.nth(1).getByTestId('recall-level-easy').click();
    await sheet.getByTestId('recall-done').click();
    await expect(page.getByTestId('toast')).toContainText('1 / 2 idées retrouvées. 1 point à approfondir.');
    const end = page.getByTestId('chapter-end');
    await expect(end).toContainText('Dernier rappel : 1 / 2');
    await expect(end.getByTestId('deepen')).toContainText('La consolidation transforme');
    await end.getByRole('button', { name: 'Voir le passage' }).click();
    await expect(page.locator('mark.flash')).toHaveCount(1);
  });

  test('sans passage marqué, le rappel s’appuie sur les sections du chapitre', async ({ page }) => {
    await openBook(page);
    await page.getByTestId('start-recall').click();
    await page.getByTestId('recall-finish').click();
    await expect(page.getByTestId('recall-item')).toHaveCount(1);
    await expect(page.getByTestId('recall-sheet')).toContainText('Les trois étapes');
  });

  test('pré-questions à la réouverture d’un chapitre qui a des fiches', async ({ page }) => {
    await openBook(page);
    await expect(page.getByTestId('pretest-box')).toBeHidden();
    await page.getByTestId('next-chapter').click();
    await createCard(page, 'La courbe', 'jours.', 'Comment évolue l’oubli ?', 'Très vite au début.');
    await page.getByTestId('prev-chapter').click();
    await page.getByTestId('next-chapter').click();

    const box = page.getByTestId('pretest-box');
    await expect(box).toContainText('1 question');
    await box.getByTestId('start-pretest').click();
    const sheet = page.getByTestId('pretest-sheet');
    await expect(sheet).toContainText('Comment évolue l’oubli ?');
    await sheet.getByTestId('pretest-attempt').fill('Lentement ?');
    await sheet.getByTestId('pretest-reveal').click();
    await expect(sheet.getByTestId('pretest-answer')).toContainText('Très vite au début.');
    await sheet.getByTestId('pretest-next').click();
    await expect(sheet.getByTestId('pretest-done')).toBeVisible();
    await sheet.getByRole('button', { name: 'Commencer la lecture' }).click();
    await expect(box).toBeHidden();

    // Déjà fait aujourd'hui : pas reproposé, même après rechargement.
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Oubli');
    await expect(page.getByTestId('pretest-box')).toBeHidden();
  });

  test('aide-mémoire : table Mojor, coach, indice en révision', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('open-data').click();
    const table = [{ number: 0, word: 'Zorro', verb: 'tranche', place: 'Le balcon' }, { number: 1, word: 'Thé' }];
    await page.getByTestId('mojor-input').setInputFiles({ name: 'mojor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(table)) });
    await expect(page.getByTestId('mojor-status')).toContainText('2 entrées');
    await page.keyboard.press('Escape');

    await importFile(page, 'memoire.md', 'text/markdown', Buffer.from(BOOK));
    await selectText(page, 'Encodage', 'récupération.');
    await page.getByTestId('card-from-selection').click();
    const editor = page.getByTestId('card-editor');
    await editor.getByTestId('card-question').fill('Quelles sont les trois étapes de la mémoire ?');
    await editor.getByTestId('card-answer').fill('Encodage, stockage, récupération.');
    await editor.getByTestId('mnemonic-section').locator('summary').first().click();
    await expect(editor.getByTestId('mn-number')).toHaveValue('0');
    await expect(editor.getByTestId('mn-word')).toHaveValue('Zorro');
    await expect(editor.getByTestId('mn-place')).toHaveValue('Le balcon');
    await expect(editor.getByTestId('mn-coach')).toContainText('vivante');
    await editor.getByTestId('mn-person').fill('Zorro lui-même');
    await expect(editor.getByTestId('mn-coach')).toContainText('Scène complète');
    await editor.getByTestId('card-save').click();

    await page.getByTestId('back').click();
    await page.getByTestId('start-review').click();
    await expect(page.getByTestId('show-hint-text')).toBeHidden();
    await page.getByTestId('show-hint').click();
    await expect(page.getByTestId('show-hint-text')).toHaveText('📍 Le balcon · n° 0 · Zorro lui-même · Zorro · tranche');
  });

  test('tableau de bord : 4 indicateurs et réglage des nouvelles fiches', async ({ page }) => {
    await openBook(page);
    await createCard(page, 'Le sommeil', 'apprentissages.', 'Quel est le rôle du sommeil ?', 'Consolider.');
    await page.getByTestId('back').click();
    await page.getByTestId('start-review').click();
    await page.getByTestId('confidence-3').click();
    await page.getByTestId('grade-4').click();
    await expect(page.getByTestId('review-done')).toBeVisible();
    await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();

    await page.getByTestId('open-stats').click();
    await expect(page.getByTestId('due-today')).toHaveText('0');
    await expect(page.getByTestId('stat-retention')).toContainText('Pas encore de révision espacée');
    await expect(page.getByTestId('stat-calibration')).toContainText('100 % · 1');
    await expect(page.getByTestId('calibration-advice')).toContainText('Encore quelques révisions');
    await expect(page.getByTestId('active-days')).toHaveText('1');
    await expect(page.locator('.strip .cell.on')).toHaveCount(1);

    await expect(page.getByTestId('new-per-day')).toHaveText('20');
    await page.getByRole('button', { name: 'Plus de nouvelles fiches' }).click();
    await expect(page.getByTestId('new-per-day')).toHaveText('25');
    await page.waitForTimeout(300);
    await page.reload();
    await page.getByTestId('open-stats').click();
    await expect(page.getByTestId('new-per-day')).toHaveText('25');
  });
});
