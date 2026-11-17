import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

// Capacitor (Android) insère son script de liaison, en ligne, juste après <head>.
// La politique de sécurité (CSP) étant déclarée plus loin, elle ne doit pas le bloquer.
test('le script injecté par Capacitor s’exécute malgré la CSP, et l’app démarre', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('http://localhost:4173/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace('<head>', '<head>\n<script type="text/javascript">window.__capacitorInjected = true;</script>\n');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/');
  expect(await page.evaluate(() => (window as unknown as { __capacitorInjected?: boolean }).__capacitorInjected)).toBe(true);
  await expect(page.getByTestId('empty-library')).toBeVisible();
  expect(errors).toEqual([]);
});

test('dans un navigateur, le rappel quotidien est indiqué comme réservé à Android', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-stats').click();
  await expect(page.getByTestId('reminder-status')).toHaveText('Disponible dans l’application Android.');
  await expect(page.getByTestId('reminder-on')).toBeDisabled();
});
