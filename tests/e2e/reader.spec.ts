import { expect, test } from '@playwright/test';
import { importFile, selectText, watchErrors } from './helpers';

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
    await expect(toc.getByRole('button', { name: 'Introduction' })).toHaveAttribute('aria-current', 'page');
    await toc.getByRole('button', { name: 'Conclusion' }).click();
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
    await sheet.getByText('Sombre').click();
    await sheet.getByText('Sans empattement').click();
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

  test('mode concentration et navigation au clavier', async ({ page }) => {
    await page.getByTestId('open-settings').click();
    await page.getByTestId('focus-mode').click();
    await expect(page.locator('header.topbar')).toBeHidden();
    await expect(page.getByTestId('chapter-position')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('reader-chapter')).toHaveText('Les étapes');
    await page.getByTestId('exit-focus').click();
    await expect(page.locator('header.topbar')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('chapter-position')).toHaveText('1 / 3');
  });
});
