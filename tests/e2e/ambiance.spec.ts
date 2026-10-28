import { expect, test, type Page } from '@playwright/test';
import { importFile, showChrome, watchErrors } from './helpers';

/** Fichier WAV (sinusoïde) : un vrai morceau lisible par le navigateur. */
function wav(seconds: number, freq = 440, rate = 8000): Buffer {
  const n = Math.floor(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Les éléments audio créés par l'app (pour vérifier ce qui joue réellement). */
async function trackAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const created: HTMLAudioElement[] = [];
    const Original = window.Audio;
    const Tracked = function (src?: string) {
      const el = new Original(src);
      created.push(el);
      return el;
    } as unknown as typeof Audio;
    Tracked.prototype = Original.prototype;
    window.Audio = Tracked;
    (window as unknown as { __audios: HTMLAudioElement[] }).__audios = created;
  });
}
const playing = (page: Page) => page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios.filter((a) => !a.paused && a.src).length);

test.describe('Ambiance musicale', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    await trackAudio(page);
    await page.goto('/');
    await importFile(page, 'afrique.md', 'text/markdown', Buffer.from('# Dakar\n\nLe griot joue de la kora au bord du fleuve.\n\n# Tombouctou\n\nLes manuscrits de la ville.'));
    await expect(page.getByTestId('reader-chapter')).toHaveText('Dakar');
  });
  test.afterEach(() => {
    expect(errors, 'aucune erreur JavaScript').toEqual([]);
  });

  test('une ambiance par livre : choix, import d’un morceau, lecture, reprise, arrêt en quittant', async ({ page }) => {
    await showChrome(page);
    const button = page.getByTestId('open-ambiance');
    await expect(button).toHaveAttribute('data-state', 'stopped');
    await button.click();
    const sheet = page.getByTestId('ambiance-sheet');
    await sheet.getByTestId('ambiance-option-kora').click();
    await expect(sheet.getByTestId('ambiance-tracks')).toContainText('Aucun morceau');
    await expect(sheet.getByTestId('music-app-link').first()).toHaveAttribute('href', 'https://open.spotify.com/search/kora%20instrumental');

    await sheet.getByTestId('track-input').setInputFiles({ name: 'kora-01.wav', mimeType: 'audio/wav', buffer: wav(12) });
    await expect(page.getByTestId('toast').last()).toContainText('Morceau ajouté');
    await expect(sheet.getByTestId('track-item')).toContainText('kora-01.wav');
    await expect(sheet.getByTestId('track-item')).toContainText('12 s');
    await expect(sheet.getByTestId('ambiance-option-kora')).toContainText('1 morceau');
    await expect(sheet.getByTestId('ambiance-status')).toHaveText('En cours : Kora');
    await expect(button).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => playing(page)).toBe(1);

    // Fondu d'entrée terminé : volume par défaut, puis volume choisi.
    await page.waitForTimeout(3000);
    const volume = () => page.evaluate(() => (window as unknown as { __audios: HTMLAudioElement[] }).__audios.find((a) => !a.paused && a.src)?.volume ?? -1);
    expect(await volume()).toBeCloseTo(0.35, 2);
    await sheet.getByTestId('ambiance-volume').evaluate((el: HTMLInputElement) => {
      el.value = '0.8';
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    });
    expect(await volume()).toBeCloseTo(0.8, 2);

    // Pause puis reprise.
    await sheet.getByTestId('ambiance-toggle').click();
    await expect(button).toHaveAttribute('data-state', 'paused');
    await expect.poll(() => playing(page)).toBe(0);
    await sheet.getByTestId('ambiance-toggle').click();
    await expect(button).toHaveAttribute('data-state', 'playing');
    await page.keyboard.press('Escape');

    // Écran éteint (page cachée) : la musique s'arrête, et reprend au retour.
    const setVisibility = (state: 'hidden' | 'visible') => page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await setVisibility('hidden');
    await expect.poll(() => playing(page)).toBe(0);
    await setVisibility('visible');
    await expect.poll(() => playing(page)).toBe(1);

    // Quitter le livre arrête la musique ; le rouvrir la relance.
    await page.getByTestId('back').click();
    await expect.poll(() => playing(page), { timeout: 4000 }).toBe(0);
    await page.getByTestId('continue-reading').click();
    await expect(page.getByTestId('open-ambiance')).toHaveAttribute('data-state', 'playing');
    await expect.poll(() => playing(page)).toBe(1);
  });

  test('« Silence » arrête la musique pour ce livre ; un fichier non audio est refusé', async ({ page }) => {
    await showChrome(page);
    await page.getByTestId('open-ambiance').click();
    const sheet = page.getByTestId('ambiance-sheet');
    await sheet.getByTestId('ambiance-option-oud').click();
    await sheet.getByTestId('track-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('pas de la musique') });
    await expect(page.getByTestId('toast').last()).toContainText('pas des fichiers audio');
    await sheet.getByTestId('track-input').setInputFiles({ name: 'oud.wav', mimeType: 'audio/wav', buffer: wav(12, 330) });
    await expect(page.getByTestId('open-ambiance')).toHaveAttribute('data-state', 'playing');
    await sheet.getByTestId('ambiance-option-silence').click();
    await expect(page.getByTestId('open-ambiance')).toHaveAttribute('data-state', 'stopped');
    await expect(sheet.getByTestId('ambiance-tracks')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByTestId('continue-reading').click();
    await expect(page.getByTestId('reader-chapter')).toHaveText('Dakar');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('open-ambiance')).toHaveAttribute('data-state', 'stopped');
    expect(await playing(page)).toBe(0);
  });
});
