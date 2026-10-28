import { expect, test } from '@playwright/test';
import { hideChrome, importFile, selectText, tapReader, touchDrag, watchErrors } from './helpers';

const BOOK = `# Introduction

La photosynthèse est le processus par lequel les plantes produisent du **glucose** à partir de *lumière* et de dioxyde de carbone.

Elle a lieu dans les chloroplastes.

# Les étapes

${'Phrase de remplissage pour allonger ce chapitre. '.repeat(120)}

La phase lumineuse précède le cycle de Calvin.

# Conclusion

Sans photosynthese, pas d'oxygène.
`;

test.describe('Étape 2 — lecteur complet', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
    await importFile(page, 'biologie.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Introduction');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('le sommaire liste les chapitres et permet d’y aller', async ({ page }) => {
    await page.getByTestId('open-toc').click();
    const toc = page.getByTestId('toc-sheet');
    await expect(toc.getByRole('button', { name: 'Introduction', exact: true })).toHaveAttribute('aria-current', 'page');
    await toc.getByRole('button', { name: 'Conclusion', exact: true }).click();
    await expect(toc).toBeHidden();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Conclusion');
    await expect(page.getByTestId('chapter-position')).toHaveText('3 / 3');
  });

  test('la recherche ignore les accents et mène au passage', async ({ page }) => {
    await page.getByTestId('open-search').click();
    await page.getByTestId('search-input').fill('PHOTOSYNTHESE');
    const results = page.getByTestId('search-results').getByRole('button');
    await expect(results).toHaveCount(2);
    await page.getByTestId('search-input').fill('cycle de calvin');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('Les étapes');
    await results.first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Les étapes');
    const flash = page.locator('mark.flash');
    await expect(flash).toHaveText('cycle de Calvin');
    await expect(flash).toBeInViewport();
    await expect(flash).toHaveCount(0, { timeout: 5000 });
  });

  test('les réglages s’appliquent en direct et sont conservés', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    const sheet = page.getByTestId('settings-sheet');
    await sheet.getByRole('button', { name: 'Agrandir le texte' }).click();
    await sheet.getByRole('button', { name: 'Agrandir le texte' }).click();
    await expect(sheet.getByTestId('font-size-value')).toHaveText('20');
    await sheet.getByText('Nuit', { exact: true }).click();
    await sheet.getByText('Plex Sans').click();
    await sheet.getByText('Défilement').click();
    await sheet.getByTestId('set-justify').uncheck();
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    const fontSize = () => page.getByTestId('reader-content').evaluate((el) => getComputedStyle(el).fontSize);
    expect(await fontSize()).toBe('20px');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500); // enregistrement différé
    await page.reload();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-content')).toBeVisible();
    expect(await fontSize()).toBe('20px');
    expect(await page.getByTestId('reader-content').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('IBM Plex Sans');
    expect(await page.getByTestId('reader-content').evaluate((el) => getComputedStyle(el).textAlign)).toBe('start');
    await expect(page.locator('.reader-scroll')).toHaveClass(/layout-scroll/);
  });

  test('surligne un passage à cheval sur du gras et de l’italique, le conserve et le retire', async ({ page }) => {
    await selectText(page, 'produisent', 'lumière');
    await page.getByTestId('highlight-selection').click();
    const marks = page.locator('mark.hl');
    await expect(marks).toHaveCount(4); // texte · gras · texte · italique
    expect((await marks.allTextContents()).join('')).toBe('produisent du glucose à partir de lumière');

    // Chevauchement refusé.
    await selectText(page, 'glucose', 'partir');
    await page.getByTestId('highlight-selection').click();
    await expect(page.getByTestId('toast')).toContainText('chevauche');
    await expect(marks).toHaveCount(4);

    // Conservé après rechargement, listé dans le tiroir.
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.locator('mark.hl')).toHaveCount(4);
    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: /Passages/ }).click();
    await expect(page.getByTestId('highlight-item')).toHaveCount(1);
    await expect(page.getByTestId('highlight-item')).toContainText('produisent du glucose');
    await page.keyboard.press('Escape');

    // Retiré depuis le texte.
    await page.locator('mark.hl').first().click();
    await page.getByTestId('remove-highlight').click();
    await expect(page.locator('mark.hl')).toHaveCount(0);
    await expect(page.getByTestId('reader-content')).toContainText('produisent du glucose à partir de lumière');
  });

  test('un surlignage de la liste mène au bon chapitre', async ({ page }) => {
    await page.getByTestId('next-chapter').click();
    await selectText(page, 'La phase lumineuse', 'Calvin');
    await page.getByTestId('highlight-selection').click();
    await page.getByTestId('prev-chapter').click();
    await page.getByTestId('open-toc').click();
    await page.getByRole('tab', { name: /Passages/ }).click();
    await page.getByTestId('highlight-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Les étapes');
    await expect(page.locator('mark.flash')).toBeInViewport();
  });

  test('plein écran : menus au tap central, pages au tap et au clavier, chapitres enchaînés', async ({ page }) => {
    await expect(page.locator('header.reader-chrome')).toBeVisible();
    await tapReader(page, 0.5);
    await expect(page.locator('header.reader-chrome')).toBeHidden();
    await expect(page.getByTestId('status-clock')).toHaveText(/^\d{2}:\d{2}$/);
    await tapReader(page, 0.5);
    await expect(page.locator('header.reader-chrome')).toBeVisible();

    // Chapitre « Introduction » : une seule page ; la page suivante est le chapitre suivant.
    await hideChrome(page);
    await expect(page.getByTestId('status-page')).toHaveText('1 / 1');
    await tapReader(page, 0.92);
    await expect(page.getByTestId('reader-chapter')).toHaveText('Les étapes');
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \/ [2-9]$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \/ /);
    await tapReader(page, 0.08);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \/ /);
    // Reculer depuis la première page : fin du chapitre précédent.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('reader-chapter')).toHaveText('Introduction');
    await expect(page.getByTestId('status-progress')).toHaveText(/^\d+ %/);
  });

  test('gestes tactiles : glisser pour tourner, bord gauche pour la luminosité', async ({ page }) => {
    await page.getByTestId('next-chapter').click();
    await hideChrome(page);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
    await touchDrag(page, [0.8, 0.5], [0.2, 0.52]);
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \//);
    await touchDrag(page, [0.3, 0.5], [0.85, 0.5]);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
    // Petit glisser : la page revient en place.
    await touchDrag(page, [0.6, 0.5], [0.55, 0.5]);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);

    // Glisser vers le bas sur le bord gauche : moins de lumière (voile plus opaque).
    await touchDrag(page, [0.05, 0.3], [0.05, 0.7], 200);
    const dim = await page.locator('html').evaluate((el) => Number(el.style.getPropertyValue('--dim')));
    expect(dim).toBeGreaterThan(0.2);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
  });

  test('sélection : mots complétés, barre utilisable même si la sélection a disparu, copier, rechercher', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const bar = page.getByTestId('selection-bar');

    // Sélection coupée au milieu des mots : le surlignage prend les mots entiers.
    await selectText(page, 'otosynth', 'proces');
    await expect(bar).toBeVisible();
    // Sur Android, toucher un bouton efface la sélection avant le clic.
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await bar.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).toHaveText('photosynthèse est le processus');

    await selectText(page, 'chloroplas', 'chloroplas');
    await bar.getByTestId('copy-selection').click();
    await expect(page.getByTestId('toast').last()).toContainText('Passage copié');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('chloroplastes');

    await selectText(page, 'glucose', 'glucose');
    await bar.getByTestId('search-selection').click();
    await expect(page.getByTestId('search-input')).toHaveValue('glucose');
    await expect(page.getByTestId('search-results').locator('li')).toHaveCount(1);
  });

  test('un tap pour annuler la sélection ne tourne pas la page', async ({ page }) => {
    await page.getByTestId('next-chapter').click();
    await hideChrome(page);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
    await selectText(page, 'Phrase de', 'remplissage');
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    // Tap dans le texte, loin de la barre de sélection.
    await tapReader(page, 0.9, 0.8);
    await expect(page.getByTestId('status-page')).toHaveText(/^1 \//);
    await expect(page.getByTestId('selection-bar')).toBeHidden();
    await expect(page.locator('.reader.chrome-hidden')).toHaveCount(1);
    await tapReader(page, 0.9);
    await expect(page.getByTestId('status-page')).toHaveText(/^2 \//);
  });
});
