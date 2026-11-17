import { expect, test, type Page } from '@playwright/test';
import { importFile, watchErrors } from './helpers';

const BOOK = `# Le sommeil

Pendant le sommeil profond, le cerveau rejoue ce qu'il a appris dans la journée.

# Les rêves

Le rêve mélange les souvenirs récents et anciens.
`;

/** Clic par le DOM : l'encadré de fin de chapitre peut être sur une autre page. */
async function clickInReader(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).waitFor({ state: 'attached' });
  await page.evaluate((id) => (document.querySelector(`[data-testid=${id}]`) as HTMLButtonElement).click(), testId);
}

async function setGoal(page: Page): Promise<void> {
  await page.getByTestId('goal-box').getByTestId('start-goal').click();
  const sheet = page.getByTestId('goal-sheet');
  await sheet.getByTestId('goal-about').fill('Un livre sur les rêves.');
  await sheet.getByTestId('goal-kind-savoir').click();
  await sheet.getByTestId('goal-capable').fill('expliquer pourquoi dormir aide à retenir');
  await sheet.getByTestId('goal-save').click();
  await expect(sheet).toBeHidden();
}

async function restituteFirstChapter(page: Page): Promise<void> {
  await clickInReader(page, 'start-recall');
  const sheet = page.getByTestId('recall-sheet');
  await sheet.getByTestId('recall-main').fill('Le sommeil consolide les souvenirs');
  await sheet.getByTestId('recall-text').fill('Le cerveau rejoue la journée');
  await sheet.getByTestId('recall-finish').click();
  await sheet.getByTestId('link-from').selectOption({ label: 'Le cerveau rejoue la journée' });
  await sheet.getByTestId('link-relation').selectOption('cause');
  await sheet.getByTestId('link-to').selectOption({ label: 'Le sommeil consolide les souvenirs' });
  await sheet.getByTestId('link-add').click();
  await sheet.getByTestId('links-continue').click();
  await sheet.getByTestId('recall-done').click();
  await expect(sheet).toBeHidden();
}

test.describe('Bilan du livre et carte des idées', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('bilan en fin de livre : hypothèse comparée, idées, liens, objectif, fiches « Tout le livre »', async ({ page }) => {
    await page.goto('/');
    await importFile(page, 'sommeil.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Le sommeil');
    await setGoal(page);
    await restituteFirstChapter(page);
    // Le bilan n'est proposé qu'à la fin du livre.
    await expect(page.getByTestId('end-bilan')).toHaveCount(0);

    await clickInReader(page, 'next-chapter');
    await expect(page.getByTestId('reader-chapter')).toHaveText('Les rêves');
    await expect(page.getByTestId('end-bilan')).toContainText('Fin du livre.');
    await clickInReader(page, 'start-bilan');

    const sheet = page.getByTestId('bilan-sheet');
    await expect(sheet.getByTestId('bilan-hypothesis')).toContainText('Un livre sur les rêves.');
    await expect(sheet.getByTestId('bilan-goal')).toContainText('être capable d’expliquer pourquoi dormir aide à retenir');
    await sheet.getByTestId('bilan-chapters').locator('summary').click();
    await expect(sheet.getByTestId('bilan-chapters')).toContainText('Le sommeil : Le sommeil consolide les souvenirs');
    await sheet.getByTestId('bilan-about').fill('Le sommeil fait partie de l’apprentissage.');
    await sheet.getByTestId('bilan-ideas').fill('- Dormir consolide la mémoire\n- Le rêve trie les souvenirs');
    // Liens : entre les idées du livre et celles des chapitres.
    await sheet.getByTestId('bilan-open-links').click();
    await expect(sheet.getByTestId('link-from').locator('option')).toHaveCount(3);
    await sheet.getByTestId('link-from').selectOption({ label: 'Le rêve trie les souvenirs' });
    await sheet.getByTestId('link-relation').selectOption('partie');
    await sheet.getByTestId('link-to').selectOption({ label: 'Dormir consolide la mémoire' });
    await sheet.getByTestId('link-add').click();
    await expect(sheet.getByTestId('link-item')).toHaveText(/Le rêve trie les souvenirs → fait partie de → Dormir consolide la mémoire/);
    await sheet.getByTestId('bilan-reached-partly').click();
    await sheet.getByTestId('bilan-next').fill('Arrêter les révisions de nuit.');
    await sheet.getByTestId('bilan-save').click();
    await expect(page.getByTestId('toast').last()).toContainText('Bilan enregistré : 3 fiches créées.');
    await expect(page.getByTestId('end-bilan')).toContainText('Bilan fait le');
    await expect(page.getByTestId('start-bilan')).toHaveText('Revoir mon bilan');

    // Carte des idées : le livre, puis les chapitres restitués.
    await clickInReader(page, 'end-map');
    const map = page.getByTestId('idea-map');
    await expect(map.getByTestId('map-goal')).toContainText('expliquer pourquoi dormir aide à retenir');
    await expect(map.getByTestId('map-about')).toHaveText('Le sommeil fait partie de l’apprentissage.');
    await expect(map.getByTestId('map-book-ideas')).toContainText('Le rêve trie les souvenirs');
    await expect(map.getByTestId('map-book')).toContainText('En partie');
    await expect(map.getByTestId('map-count')).toHaveText('1 chapitre restitué sur 2.');
    await expect(map.getByTestId('map-chapter')).toHaveCount(1);
    await expect(map.getByTestId('map-chapter')).toContainText('Le sommeil consolide les souvenirs');
    await expect(map.getByTestId('map-links')).toContainText('↓ entraîne');
    // Partage : le texte de la carte (ici copié, faute de menu de partage).
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: { text: string }) => { (window as unknown as { shared: string }).shared = data.text; } });
    });
    await map.getByTestId('map-share').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared?: string }).shared ?? '')).toContain('CHAPITRE PAR CHAPITRE');
    // « Lire » ramène au chapitre.
    await map.getByTestId('map-go').click();
    await expect(map).toHaveCount(0);
    await expect(page.getByTestId('reader-chapter')).toHaveText('Le sommeil');

    // Revoir le bilan : tout est repris (liens compris) et les fiches ne sont pas recréées.
    await clickInReader(page, 'next-chapter');
    await clickInReader(page, 'start-bilan');
    await expect(sheet.getByTestId('bilan-about')).toHaveValue('Le sommeil fait partie de l’apprentissage.');
    await expect(sheet.locator('#bilan-reached-partly')).toBeChecked();
    await expect(sheet.getByTestId('link-item')).toHaveCount(1);
    // Une idée réécrite rejoint la liste des idées à relier.
    await sheet.getByTestId('bilan-ideas').fill('- Dormir consolide la mémoire\n- Le rêve trie les souvenirs\n- Réviser la veille');
    await sheet.getByTestId('bilan-ideas').blur();
    await expect(sheet.getByTestId('link-from').locator('option', { hasText: 'Réviser la veille' })).toHaveCount(1);
    await sheet.getByTestId('bilan-save').click();
    await expect(page.getByTestId('toast').last()).toHaveText('Bilan enregistré.');

    // « Mes fiches » : les fiches du bilan concernent tout le livre.
    await page.evaluate(() => (document.querySelector('[data-testid=back]') as HTMLButtonElement).click());
    await page.getByTestId('open-cards').click();
    await page.getByTestId('filter-type').selectOption('synthesis');
    await expect(page.getByTestId('card-row')).toHaveCount(5);
    await expect(page.getByTestId('cards-list')).toContainText('De quoi parle « sommeil » ?');
    await page.getByTestId('card-row').filter({ hasText: 'De quoi parle' }).click();
    await expect(page.getByTestId('detail-where')).toHaveText('Tout le livre');
    await expect(page.getByTestId('detail-answer')).toContainText('Le sommeil fait partie de l’apprentissage.');
    await page.getByTestId('card-goto').click();
    await expect(page.getByTestId('idea-map')).toBeVisible();
  });

  test('les panneaux ne glissent pas : seul leur contenu défile, l’en-tête reste visible', async ({ page }) => {
    await page.goto('/');
    await importFile(page, 'sommeil.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Le sommeil');
    await page.getByTestId('skip-goal').click();
    // Panneau du bilan et réglages : des choix segmentés (boutons radio masqués) loin en bas.
    for (const [opener, testId] of [['start-bilan', 'bilan-sheet'], ['open-settings', 'settings-sheet']] as const) {
      if (opener === 'start-bilan') await clickInReader(page, 'next-chapter');
      await clickInReader(page, opener);
      const sheet = page.getByTestId(testId);
      await sheet.waitFor();
      // Aller tout en bas, comme le ferait le défilement au doigt ou le clavier.
      await sheet.locator('.sheet-body > :last-child').scrollIntoViewIfNeeded();
      const box = await sheet.evaluate((d) => ({ overflow: d.scrollHeight - d.clientHeight, scrolled: d.scrollTop, head: d.firstElementChild!.getBoundingClientRect().top }));
      expect(box.overflow, `${testId} : le panneau lui-même ne déborde pas`).toBe(0);
      expect(box.scrolled, testId).toBe(0);
      expect(box.head, `${testId} : en-tête visible`).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
  });

  test('carte vide : explique comment elle se remplit, et lance le bilan', async ({ page }) => {
    await page.goto('/');
    await importFile(page, 'sommeil.md', 'text/markdown', Buffer.from(BOOK));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Le sommeil');
    await page.getByTestId('skip-goal').click();
    await page.evaluate(() => (document.querySelector('[data-testid=open-toc]') as HTMLButtonElement).click());
    await page.getByTestId('toc-sheet').getByTestId('open-map').click();
    const map = page.getByTestId('idea-map');
    await expect(map.getByTestId('map-empty')).toBeVisible();
    await expect(map.getByTestId('map-count')).toHaveText('0 chapitre restitué sur 2.');
    await map.getByTestId('map-bilan').click();
    const sheet = page.getByTestId('bilan-sheet');
    await expect(sheet).toContainText('Ce livre t’a-t-il apporté ce que tu en attendais ?');
    await expect(sheet.getByTestId('bilan-hypothesis')).toHaveCount(0);
    await sheet.getByTestId('bilan-open-links').click();
    await expect(sheet.getByTestId('bilan-links')).toContainText('Écris d’abord au moins deux idées centrales.');
    // Fermé sans enregistrer : retour à la carte, rien d'enregistré.
    await page.keyboard.press('Escape');
    await expect(map).toBeVisible();
    await expect(map.getByTestId('map-bilan')).toHaveText('Faire le bilan');
  });
});
