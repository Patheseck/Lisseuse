import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { makeEpub3 } from '../fixtures/make-epub';
import { importFile, selectText, watchErrors } from './helpers';

/** Crée sur l'appareil un profil V5.7 tel que la V5 l'écrivait (IndexedDB + localStorage). */
async function seedV5Profile(page: Page): Promise<void> {
  const epub = Array.from(await makeEpub3());
  const markdown = '# Chapitre unique\n\nLes mitochondries produisent l’énergie de la cellule.\n';
  await page.evaluate(async ({ epub, markdown }) => {
    const epubFile = new File([new Uint8Array(epub)], 'livre-test.epub', { type: 'application/epub+zip' });
    const mdFile = new File([markdown], 'notes.md', { type: 'text/markdown' });
    const sha = async (f: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
    const epubId = await sha(epubFile);
    const mdId = 'notes.md:' + mdFile.size; // identifiant d'une très ancienne V5
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('liseuse-db', 2);
      req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const t = req.result.transaction('books', 'readwrite');
        t.objectStore('books').put({ id: epubId, title: 'Le Livre de Test', format: 'epub', fileBlob: epubFile, coverBlob: null, addedAt: 1, lastOpenedAt: 2 });
        t.objectStore('books').put({ id: mdId, title: 'Notes', format: 'md', fileBlob: mdFile, addedAt: 1, lastOpenedAt: 3 });
        t.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    const day = 86400000;
    localStorage.setItem(`liseuse:cards:${epubId}`, JSON.stringify([
      { id: 'c1', chapter: 1, text: 'Voici la suite annoncée.', source: 'manual', createdAt: Date.now() - 9 * day, mojorNumber: 4, association: { word: 'Flèche', place: 'Couloir' }, mode: 'concept', reformulation: 'La suite est annoncée', review: { fsrs: { version: 6, difficulty: 5, stability: 3, reps: 2, lapses: 0, lastReviewed: Date.now() - 4 * day }, due: Date.now() - day, interval: 3 } },
      { id: 'c2', chapter: 0, text: 'plantes produisent du glucose', mojorNumber: null, review: null },
    ]));
    localStorage.setItem(`liseuse:cards:${mdId}`, JSON.stringify([
      { id: 'c1', chapter: 0, text: 'mitochondries produisent', mojorNumber: 0, mode: 'verbatim', review: null },
    ]));
    localStorage.setItem('liseuse:progress', JSON.stringify({ [epubId]: { chapter: 1, scrollTop: 300, updatedAt: Date.now() } }));
    localStorage.setItem('liseuse:prefs', JSON.stringify({ theme: 'dark', fontSize: 20 }));
    localStorage.setItem('liseuse:review-log', JSON.stringify([
      { cardId: 'c1', bookId: epubId, bookTitle: 'Le Livre de Test', chapter: 1, timestamp: Date.now() - 4 * day, rating: 3, stabilityBefore: 1, stabilityAfter: 3, intervalDays: 3 },
    ]));
  }, { epub, markdown });
}

test.describe('Étape 4 — données', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('reprend automatiquement un profil V5.7 au premier lancement', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('empty-library')).toBeVisible();
    await seedV5Profile(page);
    await page.reload();

    const report = page.getByTestId('info-dialog');
    await expect(report).toContainText('2 livres, 3 fiches et 1 révision');
    await report.getByTestId('info-ok').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('book-item')).toHaveCount(2);
    await expect(page.getByTestId('review-banner')).toContainText('2 fiches à réviser');

    // La fiche V5 est retrouvée dans le bon chapitre, avec la progression reprise.
    await page.getByTestId('book-item').filter({ hasText: 'Le Livre de Test' }).getByRole('button').first().click();
    await expect(page.getByTestId('chapter-position')).toHaveText('2 / 3');
    await expect(page.locator('mark.hl-card')).toHaveText('Voici la suite annoncée.');
    await page.getByTestId('prev-chapter').click();
    await expect(page.locator('mark.hl:not(.hl-card)')).toHaveText('plantes produisent du glucose');

    // Révision : question générée, marquée « Reprise V5 ».
    await page.getByTestId('back').click();
    await page.getByTestId('start-review').click();
    await expect(page.getByText('Reprise V5')).toBeVisible();

    // Second lancement : pas de nouvelle migration.
    await page.reload();
    await expect(page.getByTestId('book-item')).toHaveCount(2);
    await expect(page.getByTestId('info-dialog')).toHaveCount(0);
  });

  test('sauvegarde complète puis restauration après suppression', async ({ page }, testInfo) => {
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from('# Cours\n\nLa mémoire se consolide pendant le sommeil.\n'));
    await selectText(page, 'La mémoire', 'sommeil.');
    await page.getByTestId('card-from-selection').click();
    await page.getByTestId('card-question').fill('Quand la mémoire se consolide-t-elle ?');
    await page.getByTestId('card-answer').fill('Pendant le sommeil.');
    await page.getByTestId('card-save').click();
    await page.getByTestId('back').click();

    await page.getByTestId('open-data').click();
    await page.getByTestId('backup-books').check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
    expect(download.suggestedFilename()).toMatch(/^liseuse-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/);
    const path = testInfo.outputPath('sauvegarde.json');
    await download.saveAs(path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ app: 'liseuse', format: 6, includesBooks: true });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Supprimer cours' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('empty-library')).toBeVisible();

    await page.getByTestId('open-data').click();
    // Contenu passé directement : Playwright ne transmet pas les fichiers dont le chemin contient des accents.
    await page.getByTestId('restore-input').setInputFiles({ name: 'sauvegarde.json', mimeType: 'application/json', buffer: await readFile(path) });
    await expect(page.getByTestId('info-dialog')).toContainText('1 livre, 1 fiche et 0 révision');
    await page.getByTestId('info-ok').click();
    await expect(page.getByTestId('book-item')).toHaveCount(1);
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.locator('mark.hl-card')).toHaveText('La mémoire se consolide pendant le sommeil.');
  });

  test('sauvegarde chiffrée : mot de passe confirmé, puis exigé à la restauration', async ({ page }, testInfo) => {
    await page.goto('/');
    await importFile(page, 'a.md', 'text/markdown', Buffer.from('# A\n\nTexte.\n'));
    await page.getByTestId('back').click();
    await page.getByTestId('open-data').click();
    await page.getByTestId('backup-encrypt').check();
    await page.getByTestId('export-backup').click();
    await page.getByTestId('password').fill('motdepasse1');
    await page.getByTestId('password-confirm').fill('autre chose');
    await page.getByTestId('password-ok').click();
    await expect(page.getByRole('alert').filter({ hasText: 'différents' })).toBeVisible();
    await page.getByTestId('password-confirm').fill('motdepasse1');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('password-ok').click()]);
    const path = testInfo.outputPath('chiffree.json');
    await download.saveAs(path);
    expect(await readFile(path, 'utf8')).not.toContain('Texte');

    await page.getByTestId('restore-input').setInputFiles({ name: 'chiffree.json', mimeType: 'application/json', buffer: await readFile(path) });
    await page.getByTestId('password').fill('mauvais');
    await page.getByTestId('password-ok').click();
    await expect(page.getByTestId('toast').last()).toContainText('Mot de passe incorrect');
    errors.length = 0; // l'échec est journalisé volontairement
  });
});
