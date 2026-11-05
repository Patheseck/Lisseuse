import { expect, test, type Page } from '@playwright/test';
import { filler, makePdf, typesetBook, type BookSpec } from '../fixtures/make-pdf';
import { importFile, selectText, watchErrors } from './helpers';

const BOOK: BookSpec = {
  title: 'Le Sommeil et la Mémoire',
  author: 'Claire Dupont',
  outline: true,
  furniture: true,
  chapters: [
    {
      title: 'Chapitre 1 — Dormir',
      footnote: 'Selon une étude de 2004.',
      paragraphs: [
        ['Pendant le sommeil profond, le cerveau rejoue les souve-', 'nirs de la journée. Il faut peut-', 'être dormir davantage, c’est-à-', 'dire au moins sept heures.'],
        filler(400, 3),
        'Les souvenirs se fixent la nuit, surtout après une journée riche en découvertes.',
      ],
    },
    { title: 'Chapitre 2 — Rêver', paragraphs: [filler(150, 5), 'Le rêve mélange les souvenirs récents et anciens.'] },
  ],
};

const pdf = (spec: Partial<BookSpec> = {}) => Buffer.from(makePdf(typesetBook({ ...BOOK, ...spec })));
const click = (page: Page, testId: string) => page.evaluate((id) => (document.querySelector(`[data-testid=${id}]`) as HTMLButtonElement).click(), testId);

/** Pixels encrés de la page la plus encrée parmi celles dessinées, ou de la page `n` (0 : blanche). */
const inkedPixels = (page: Page, n?: number) => page.evaluate((n) => {
  let most = 0;
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>(`.pdfViewer .page${n ? `[data-page-number="${n}"]` : ''} canvas`)) {
    if (!canvas.width || !canvas.height) continue;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 16) if (Math.abs(data[i]! - data[0]!) > 60) ink++;
    most = Math.max(most, ink);
  }
  return most;
}, n);

/** PDF ouvert en pages originales : la visionneuse a dessiné sa première page, texte compris. */
async function pagesShown(page: Page): Promise<number> {
  await expect(page.getByTestId('pdf-viewer')).toBeVisible();
  await expect(page.locator('.pdfViewer .page canvas').first()).toBeAttached();
  // Pages à leur taille (pas de hauteur nulle), et dessinées.
  expect(await page.locator('.pdfViewer .page').first().evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(100);
  await expect.poll(() => inkedPixels(page), { message: 'page dessinée (pas blanche)', timeout: 10000 }).toBeGreaterThan(150);
  const label = await page.getByTestId('pdf-page').textContent();
  return Number(label!.match(/sur (\d+)/)![1]);
}

const journal = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('liseuse:v6:errors') ?? '[]') as { message: string }[]).map((e) => e.message));

/** Bascule en texte adapté (réglages d'affichage du PDF). */
async function toText(page: Page): Promise<void> {
  await click(page, 'open-settings');
  await page.getByTestId('settings-sheet').locator('label[for="pdf-mode-text"]').click();
  // Converti puis ouvert : le titre du chapitre est affiché.
  await expect(page.getByTestId('reader-chapter')).toHaveText(/\S/, { timeout: 15000 });
}

async function tocLabels(page: Page): Promise<string[]> {
  await click(page, 'open-toc');
  const sheet = page.getByTestId('toc-sheet');
  await expect(sheet.locator('.toc-item').first()).toBeVisible();
  const labels = await sheet.locator('.toc-item').allTextContents();
  await page.keyboard.press('Escape');
  return labels;
}

test.describe('PDF en pages originales', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('un PDF s’ouvre tel quel, comme dans une liseuse : pages dessinées, texte sélectionnable, couverture', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    const total = await pagesShown(page);
    expect(total).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.pdfViewer .page')).toHaveCount(total);
    await expect(page.getByTestId('status-page')).toHaveText(`1 / ${total}`);
    // Couche de texte : le texte de la page se sélectionne (copier, partager).
    await expect(page.locator('.pdfViewer .page').first().locator('.textLayer')).toContainText('Le Sommeil et la Mémoire');
    await click(page, 'back');
    await expect(page.getByTestId('book-meta')).toContainText(`PDF · ${total} pages`);
    await expect(page.getByTestId('book-item').locator('img.book-cover')).toHaveCount(1);
    // Rien d'anormal au journal d'erreurs.
    expect(await journal(page)).toEqual([]);
  });

  test('ressources de pdf.js livrées avec l’app : polices standard, décodeurs d’images, licences', async ({ page }) => {
    const files = ['standard_fonts/FoxitSerif.pfb', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'wasm/openjpeg_nowasm_fallback.js', 'wasm/jbig2.wasm', 'wasm/jbig2_nowasm_fallback.js', 'cmaps/UniJIS-UCS2-H.bcmap'];
    const status = await page.evaluate((list) => Promise.all(list.map(async (f) => (await fetch(`pdfjs/${f}`)).status)), files);
    expect(status).toEqual(files.map(() => 200));
    const licenses = await page.evaluate(async () => (await fetch('licenses.txt')).text());
    expect(licenses).toContain('Polices Liberation Sans (Red Hat)');
    expect(licenses).toContain('OpenJPEG, décodeur JPEG 2000');
  });

  test('WebView sans la fonction CSS round() (Chrome 119 à 124, Android 7) : les pages gardent leur taille', async ({ page }) => {
    // pdf.js dimensionne les pages avec round() : sans elle, elles auraient une hauteur nulle.
    await page.addInitScript({ content: 'const supports = CSS.supports.bind(CSS); CSS.supports = (...args) => !args.join(" ").includes("round(") && supports(...args);' });
    await page.reload();
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    await pagesShown(page);
    const style = await page.locator('.pdfViewer .page').first().getAttribute('style');
    expect(style).toContain('height: calc(var(--total-scale-factor) * ');
    expect(style).not.toContain('round(');
    await expect(page.locator('.pdfViewer .page').first().locator('.textLayer')).toHaveAttribute('style', /width: calc\(var\(--total-scale-factor\)/);
  });

  test('texte que la WebView ne dessine pas (pages blanches vues sur un téléphone) : dessin de secours, noté au journal', async ({ page }) => {
    // Le texte des pages n'est pas dessiné avec les polices du PDF ; les lettres tracées, si.
    await page.addInitScript({ content: 'CanvasRenderingContext2D.prototype.fillText = () => {}; CanvasRenderingContext2D.prototype.strokeText = () => {};' });
    await page.reload();
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    // La première page de texte est vérifiée : sans texte visible, le PDF est rouvert en dessin de
    // secours, au même endroit, et ses pages s'affichent.
    await pagesShown(page);
    // La page de titre (du texte seulement) montre son texte.
    await expect.poll(() => inkedPixels(page, 1), { timeout: 10000 }).toBeGreaterThan(150);
    await expect.poll(() => journal(page)).toEqual([expect.stringMatching(/^Texte de la page 1 invisible \(Chrome \d+, écran ×[\d.]+\) : dessin de secours activé\.$/)]);
    await expect(page.locator('.pdfViewer .page').first().locator('.textLayer')).toContainText('Le Sommeil et la Mémoire');
    // Gardé sur cet appareil : le PDF suivant s'ouvre directement en dessin de secours.
    await click(page, 'back');
    await page.getByTestId('book-item').getByRole('button').first().click();
    await pagesShown(page);
    await page.waitForTimeout(500);
    expect(await journal(page)).toHaveLength(1);
    errors.length = 0; // l'incident est noté en console volontairement
  });

  test('navigation : suite, aller à la page, sommaire du PDF, signets ; la page lue est gardée', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    const total = await pagesShown(page);
    await click(page, 'next-page');
    await expect(page.getByTestId('status-page')).not.toHaveText(`1 / ${total}`);

    // Aller à une page précise.
    await click(page, 'pdf-go-page');
    const go = page.getByTestId('pdf-go-sheet');
    await go.getByTestId('pdf-go-input').fill(String(total));
    await go.getByTestId('pdf-go-confirm').click();
    await expect(page.getByTestId('status-page')).toHaveText(`${total} / ${total}`);

    // Sommaire du PDF (ses signets) : vers le chapitre 1.
    await click(page, 'open-toc');
    const toc = page.getByTestId('toc-sheet');
    await expect(toc.getByTestId('pdf-outline-item')).toHaveText(['Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);
    await toc.getByTestId('pdf-outline-item').first().click();
    await expect(page.getByTestId('status-page')).toHaveText(`2 / ${total}`);

    // Signet sur cette page, retrouvé dans le sommaire.
    await click(page, 'toggle-bookmark');
    await expect(page.getByTestId('toast').last()).toContainText('Signet ajouté : page 2');
    await click(page, 'open-toc');
    await toc.getByRole('tab', { name: 'Signets (1)' }).click();
    await expect(toc.getByTestId('bookmark-item')).toHaveText('Page 2');
    await page.keyboard.press('Escape');

    // Rouvert plus tard : à la même page.
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByTestId('continue-reading').click();
    await pagesShown(page);
    await expect(page.getByTestId('status-page')).toHaveText(`2 / ${total}`);
    await expect(page.getByTestId('toggle-bookmark')).toHaveAttribute('aria-pressed', 'true');
  });

  test('recherche : résultats comptés et surlignés sur la page', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    const total = await pagesShown(page);
    await click(page, 'open-search');
    await page.getByTestId('pdf-find-input').fill('anciens');
    await expect(page.getByTestId('pdf-find-count')).toHaveText('1 / 1');
    await expect(page.getByTestId('status-page')).toHaveText(`${total} / ${total}`);
    await expect(page.locator('.textLayer .highlight')).toHaveCount(1);
    // Accents ignorés, comme dans le texte : « reve » trouve « rêve ».
    await page.getByTestId('pdf-find-input').fill('reve melange');
    await expect(page.getByTestId('pdf-find-count')).toHaveText('1 / 1');
    await page.getByTestId('pdf-find-input').fill('introuvablexyz');
    await expect(page.getByTestId('pdf-find-count')).toHaveText('Introuvable');
    await page.getByTestId('pdf-find-close').click();
    await expect(page.getByTestId('pdf-find')).toBeHidden();
    await expect(page.locator('.textLayer .highlight')).toHaveCount(0);
  });

  test('page par page, zoom, couleurs des pages selon le thème', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    await pagesShown(page);
    await click(page, 'open-settings');
    const sheet = page.getByTestId('settings-sheet');
    // Page par page : les pages défilent de côté, une à la fois.
    await sheet.locator('label[for="pdf-scroll-pages"]').click();
    await expect(page.getByTestId('pdf-viewer')).toHaveClass(/pdf-snap/);
    await expect(page.locator('.pdfViewer')).toHaveClass(/scrollHorizontal/);
    // Zoomé : plus d'aimantation (on se déplace dans la page) ; « Ajuster » la rétablit.
    const width = () => page.locator('.pdfViewer .page').first().evaluate((el) => el.getBoundingClientRect().width);
    const fitted = await width();
    await sheet.getByTestId('pdf-zoom-in').click();
    await expect.poll(width).toBeGreaterThan(fitted * 1.2);
    await expect(page.getByTestId('pdf-viewer')).not.toHaveClass(/pdf-snap/);
    await sheet.getByTestId('pdf-zoom-fit').click();
    await expect.poll(width).toBeCloseTo(fitted, 0);
    await expect(page.getByTestId('pdf-viewer')).toHaveClass(/pdf-snap/);

    // Thème nuit : les pages prennent ses couleurs ; « couleurs d'origine » : page blanche.
    const corner = () => page.locator('.pdfViewer .page canvas').first().evaluate((c: HTMLCanvasElement) => {
      const [r, g, b] = c.getContext('2d')!.getImageData(3, 3, 1, 1).data;
      return (r! + g! + b!) / 3;
    });
    await sheet.locator('label[for="set-theme-dark"]').click();
    await expect.poll(corner, { timeout: 8000 }).toBeLessThan(80);
    await sheet.locator('label[for="pdf-colors-original"]').click();
    await expect.poll(corner, { timeout: 8000 }).toBeGreaterThan(230);
  });

  test('zoom à deux doigts et double appui', async ({ page, context }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    await pagesShown(page);
    const width = () => page.locator('.pdfViewer .page').first().evaluate((el) => el.getBoundingClientRect().width);
    const fitted = await width();
    // Deux doigts qui s'écartent : la page grandit.
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 5, radiusY: 5, force: 1 })) });
    await touch('touchStart', [[180, 400], [230, 450]]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [[180 - i * 12, 400 - i * 12], [230 + i * 12, 450 + i * 12]]);
      await page.waitForTimeout(30);
    }
    await touch('touchEnd', []);
    await expect.poll(width).toBeGreaterThan(fitted * 2);
    // Double appui : retour à la largeur de l'écran, puis zoom ×2 ; les menus ne bougent pas.
    const box = (await page.getByTestId('pdf-viewer').boundingBox())!;
    const doubleTap = async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + 300);
      await page.waitForTimeout(60);
      await page.mouse.click(box.x + box.width / 2, box.y + 300);
    };
    await doubleTap();
    await expect.poll(width).toBeCloseTo(fitted, 0);
    await doubleTap();
    await expect.poll(width).toBeCloseTo(fitted * 2, 0);
    await expect(page.locator('.pdf-reader.chrome-hidden')).toHaveCount(0);
  });

  test('PDF scanné : ses pages se lisent ; le texte adapté explique pourquoi il n’existe pas', async ({ page }) => {
    const scanned = Buffer.from(makePdf({ pages: [{ runs: [], image: true }, { runs: [], image: true }], title: 'Mon scan' }));
    await importFile(page, 'scan.pdf', 'application/pdf', scanned);
    expect(await pagesShown(page)).toBe(2);
    await click(page, 'open-settings');
    await page.getByTestId('settings-sheet').locator('label[for="pdf-mode-text"]').click();
    await expect(page.getByTestId('reader-error')).toContainText('pas de texte à adapter');
    await page.getByTestId('reader-error').getByTestId('pdf-to-pages').click();
    expect(await pagesShown(page)).toBe(2);
  });

  test('mot de passe : demandé à l’import et à chaque ouverture, jamais gardé', async ({ page }) => {
    const file = pdf({ userPassword: 'lune' });
    await importFile(page, 'secret.pdf', 'application/pdf', file);
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toContainText('PDF protégé');
    // Abandon : rien n'est importé.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('toast').last()).toContainText('Import annulé');
    await expect(page.getByTestId('empty-library')).toBeVisible();

    await importFile(page, 'secret.pdf', 'application/pdf', file);
    await dialog.getByTestId('password').fill('soleil');
    await dialog.getByTestId('password-ok').click();
    await expect(dialog).toContainText('Mot de passe incorrect');
    await dialog.getByTestId('password').fill('lune');
    await dialog.getByTestId('password-ok').click();
    // Les pages s'ouvrent : le mot de passe est redemandé (il n'est pas gardé).
    await expect(dialog).toContainText('PDF protégé');
    await dialog.getByTestId('password').fill('lune');
    await dialog.getByTestId('password-ok').click();
    await pagesShown(page);
    // Sans mot de passe à l'ouverture : une explication.
    await click(page, 'back');
    await page.getByTestId('book-item').getByRole('button').first().click();
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('pdf-message')).toContainText('protégé par un mot de passe');
  });

  test('PDF verrouillé par un DRM : refusé comme un EPUB protégé', async ({ page }) => {
    const locked = Buffer.from(makePdf({ ...typesetBook(BOOK), drm: true }));
    await importFile(page, 'achete.pdf', 'application/pdf', locked);
    const dialog = page.getByTestId('info-dialog');
    await expect(dialog).toContainText('Livre protégé (DRM)');
    await expect(dialog).toContainText('Adobe');
    await dialog.getByTestId('info-ok').click();
  });

  test('PDF abîmé : message clair', async ({ page }) => {
    await importFile(page, 'cours.pdf', 'application/pdf', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'));
    await expect(page.getByTestId('toast').last()).toContainText('Import impossible');
    errors.length = 0; // l'échec d'import est journalisé en console volontairement
  });
});

test.describe('PDF en texte adapté', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('chapitres, texte recollé, en-têtes et numéros retirés, notes ; retour aux pages au même endroit', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf());
    const total = await pagesShown(page);
    await toText(page);
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    expect(await tocLabels(page)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);

    await click(page, 'next-chapter');
    const content = page.getByTestId('reader-content');
    await expect(content.locator('h2')).toHaveText('Chapitre 1 — Dormir');
    await expect(content.locator('p').first()).toHaveText('Pendant le sommeil profond, le cerveau rejoue les souvenirs de la journée. Il faut peut-être dormir davantage, c’est-à-dire au moins sept heures.1');
    await expect(content.locator('sup')).toHaveText('1');
    await expect(content.locator('[role="doc-endnotes"]')).toHaveText('1. Selon une étude de 2004.');
    await expect(content.locator('[role="doc-endnotes"]')).toHaveAttribute('aria-label', 'Notes');
    // Ni l'en-tête courant (titre du livre) ni les numéros de page dans le texte.
    await expect(content).not.toContainText('Le Sommeil et la Mémoire');
    await expect(content.locator('p').filter({ hasText: /^\d+$/ })).toHaveCount(0);
    // Un paragraphe coupé par un changement de page est recollé (la note est à part).
    await expect(content.locator(':scope > p')).toHaveCount(3);
    await expect(content).toHaveAttribute('lang', 'fr');

    // Les outils de lecture marchent comme pour un EPUB.
    await selectText(page, 'Les souvenirs se fixent', 'la nuit');
    await page.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');

    // Le choix est gardé : rouvert, le livre est en texte adapté (sans relire le PDF).
    await click(page, 'back');
    await expect(page.getByTestId('book-meta')).toContainText('3 chapitres');
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Chapitre 1 — Dormir');
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');

    // Retour aux pages originales, vers le même endroit du livre (le chapitre 1, page 2).
    await click(page, 'pdf-to-pages');
    await pagesShown(page);
    await expect(page.getByTestId('status-page')).toHaveText(new RegExp(`^[2-3] / ${total}$`));
  });

  test('sans signets : les titres, plus grands que le texte, font les chapitres', async ({ page }) => {
    await importFile(page, 'sommeil.pdf', 'application/pdf', pdf({ outline: false }));
    await pagesShown(page);
    await toText(page);
    expect(await tocLabels(page)).toEqual(['Début du livre', 'Chapitre 1 — Dormir', 'Chapitre 2 — Rêver']);
  });

  test('sans aucune structure : découpé en tranches de pages', async ({ page }) => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => filler(200, i + 1));
    await importFile(page, 'notes.pdf', 'application/pdf', pdf({ plain: true, outline: false, title: '', chapters: [{ title: '', paragraphs }] }));
    // Sans titre dans le fichier : le nom du fichier.
    await expect(page.getByTestId('reader-title')).toHaveText('notes');
    await pagesShown(page);
    await toText(page);
    const labels = await tocLabels(page);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels.every((l) => /^Pages? \d+( à \d+)?$/.test(l))).toBe(true);
    expect(labels[0]).toMatch(/^Pages 1 à \d+$/);
  });

  test('sans les chapitres en cache (sauvegarde restaurée) : le PDF est relu, mot de passe compris, et les surlignages tiennent', async ({ page }) => {
    const dialog = page.locator('dialog.dialog');
    const password = async () => {
      await expect(dialog).toContainText('PDF protégé');
      await dialog.getByTestId('password').fill('lune');
      await dialog.getByTestId('password-ok').click();
    };
    await importFile(page, 'secret.pdf', 'application/pdf', pdf({ userPassword: 'lune' }));
    await password();
    await password();
    await pagesShown(page);
    await click(page, 'open-settings');
    await page.getByTestId('settings-sheet').locator('label[for="pdf-mode-text"]').click();
    await password();
    await expect(page.getByTestId('reader-title')).toHaveText('Le Sommeil et la Mémoire');
    await page.getByTestId('reader-content').locator('h2, h3').first().waitFor();
    await click(page, 'next-chapter');
    await selectText(page, 'Les souvenirs se fixent', 'la nuit');
    await page.getByTestId('highlight-selection').click();
    await expect(page.locator('mark.hl')).toHaveCount(1);
    // Le cache des chapitres disparaît (comme après une restauration sur un autre téléphone).
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('liseuse');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('chapters', 'readwrite');
        tx.objectStore('chapters').clear();
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await page.getByTestId('book-item').getByRole('button').first().click();
    await expect(dialog).toContainText('PDF protégé');
    // Sans mot de passe : une explication, pas une erreur.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByTestId('reader-error')).toContainText('protégé par un mot de passe');
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await click(page, 'back');
    await page.getByTestId('book-item').getByRole('button').first().click();
    await password();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Chapitre 1 — Dormir');
    await expect(page.locator('mark.hl')).toHaveText('Les souvenirs se fixent la nuit');
  });
});
