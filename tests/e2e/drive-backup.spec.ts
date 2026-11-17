import { expect, test } from '@playwright/test';
import { importFile, watchErrors } from './helpers';
import { driveFiles, leaveApp, simulateAndroid, writes } from './android-sim';

// « Mes données » → sauvegarde automatique, dans l'app Android simulée (voir android-sim.ts) :
// seul le sélecteur de documents d'Android et Google Drive sont remplacés.

/** Déchiffre une sauvegarde (format de storage/backup.ts : PBKDF2-SHA256 puis AES-GCM). */
async function decryptBackup(text: string, password: string): Promise<unknown> {
  const p = JSON.parse(text) as { salt: string; iv: string; data: string; iterations: number };
  const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(p.salt), iterations: p.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(p.iv) }, key, bytes(p.data))));
}

test.describe('sauvegarde automatique sur Google Drive (app Android simulée)', () => {
  test('emplacement choisi une fois, puis sauvegarde refaite en quittant l’app si quelque chose a changé', async ({ page }) => {
    const errors = watchErrors(page);
    await simulateAndroid(page);
    await page.clock.install();
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from('# Un\n\nPremier chapitre avec du texte.\n'));
    await page.getByTestId('back').click();

    await page.getByTestId('open-data').click();
    const section = page.getByTestId('auto-backup');
    await expect(section.getByRole('heading')).toHaveText('Sauvegarde automatique (Google Drive)');
    await section.getByTestId('auto-backup-choose').click();
    await expect(section.getByTestId('auto-backup-file')).toHaveText('Fichier « Liseuse - sauvegarde.json », dans Google Drive.');
    await expect(section.getByTestId('auto-backup-status')).toHaveText(/^Dernière sauvegarde : à l’instant \(\d+ (o|Ko)\)\.$/);
    await expect(page.getByTestId('toast').filter({ hasText: 'Sauvegarde enregistrée dans Google Drive.' })).toBeVisible();
    const [uri, first] = Object.entries(await driveFiles(page))[0]!;
    expect(JSON.parse(first)).toMatchObject({ app: 'liseuse', includesBooks: false, books: [{ title: 'cours' }] });
    expect(first).not.toContain('auto-backup');
    await page.keyboard.press('Escape');

    // Rien de changé : ni le contrôle qui suit le lancement (15 s) ni la sortie de l'app ne réécrivent.
    await page.clock.fastForward('00:16');
    await leaveApp(page);
    await page.waitForTimeout(500);
    expect(await writes(page)).toBe(1);

    // Un livre de plus : sauvegardé en quittant l'app (au plus une fois toutes les deux minutes).
    await importFile(page, 'notes.md', 'text/markdown', Buffer.from('# Deux\n\nAutre texte.\n'));
    await page.getByTestId('back').click();
    await leaveApp(page);
    await page.waitForTimeout(500);
    expect(await writes(page)).toBe(1);
    await page.clock.fastForward('03:00');
    await leaveApp(page);
    await expect.poll(() => writes(page)).toBe(2);
    const second = JSON.parse((await driveFiles(page))[uri]!);
    expect(second.books.map((b: { title: string }) => b.title).sort()).toEqual(['cours', 'notes']);
    expect(errors).toEqual([]);
  });

  test('nouveau téléphone : restaurer la sauvegarde chiffrée de Google Drive, puis continuer dans le même fichier', async ({ page, browser, baseURL }) => {
    const errors = watchErrors(page);
    // Téléphone 1 : sauvegarde chiffrée.
    await simulateAndroid(page);
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from('# Un\n\nPremier chapitre avec du texte.\n'));
    await page.getByTestId('back').click();
    await page.getByTestId('open-data').click();
    const section = page.getByTestId('auto-backup');
    await section.getByTestId('auto-backup-choose').click();
    await expect(section.getByTestId('auto-backup-status')).toContainText('Dernière sauvegarde : à l’instant');
    await section.getByTestId('auto-backup-encrypt').check();
    await page.getByTestId('password').fill('lune-et-soleil');
    await page.getByTestId('password-confirm').fill('lune-et-soleil');
    await page.getByTestId('password-ok').click();
    await expect.poll(() => writes(page)).toBe(2);
    await expect(section.getByTestId('auto-backup-encrypt')).toBeChecked();
    const drive = await driveFiles(page);
    const [uri, saved] = Object.entries(drive)[0]!;
    expect(JSON.parse(saved)).toMatchObject({ encrypted: true });
    expect(saved).not.toContain('cours');
    expect(saved).not.toContain('lune-et-soleil');
    expect(await decryptBackup(saved, 'lune-et-soleil')).toMatchObject({ includesBooks: false, books: [{ title: 'cours' }] });

    // Téléphone 2 : rien dessus, même compte Google Drive.
    const context = await browser.newContext({ baseURL });
    const phone = await context.newPage();
    const phoneErrors = watchErrors(phone);
    await simulateAndroid(phone, drive, [uri]);
    await phone.goto('/');
    await phone.getByTestId('open-data').click();
    await phone.getByTestId('auto-backup-restore-pick').click();
    await phone.getByTestId('password').fill('lune-et-soleil');
    await phone.getByTestId('password-ok').click();
    const report = phone.getByTestId('info-dialog');
    await expect(report).toContainText('Ces livres ne sont pas dans le fichier : réimporte-les pour retrouver leurs fiches.');
    await expect(report.getByRole('listitem')).toHaveText(['cours']);
    await phone.getByTestId('info-ok').click();
    const confirm = phone.getByRole('dialog').filter({ hasText: 'Continuer à sauvegarder automatiquement' });
    await expect(confirm).toContainText('dans ce fichier (Google Drive), chiffré avec le même mot de passe ?');
    await confirm.getByRole('button', { name: 'Oui, continuer' }).click();
    await expect.poll(() => writes(phone)).toBe(1);
    // Toujours chiffrée, et le livre à réimporter y reste décrit.
    const continued = (await driveFiles(phone))[uri]!;
    expect(continued).not.toBe(saved);
    expect(await decryptBackup(continued, 'lune-et-soleil')).toMatchObject({ books: [{ title: 'cours' }] });
    await phone.getByTestId('open-data').click();
    const phoneSection = phone.getByTestId('auto-backup');
    await expect(phoneSection.getByTestId('auto-backup-encrypt')).toBeChecked();
    await expect(phoneSection.getByTestId('auto-backup-auto')).toBeChecked();
    expect(phoneErrors).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('nouveau téléphone qui choisit le fichier existant dans Drive : rien n’est effacé', async ({ page, browser, baseURL }) => {
    // Téléphone 1 : un livre et sa sauvegarde automatique.
    await simulateAndroid(page);
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from('# Un\n\nPremier chapitre avec du texte.\n'));
    await page.getByTestId('back').click();
    await page.getByTestId('open-data').click();
    await page.getByTestId('auto-backup-choose').click();
    await expect(page.getByTestId('auto-backup-status')).toContainText('Dernière sauvegarde');
    const drive = await driveFiles(page);
    const [uri] = Object.keys(drive);

    // Téléphone 2, vide : « Choisir l'emplacement », puis le fichier existant (« Remplacer ? » → oui).
    const context = await browser.newContext({ baseURL });
    const phone = await context.newPage();
    const errors = watchErrors(phone);
    await simulateAndroid(phone, drive, [], [uri!]);
    await phone.goto('/');
    await phone.getByTestId('open-data').click();
    await phone.getByTestId('auto-backup-choose').click();
    const warning = phone.getByRole('dialog').filter({ hasText: 'Ce fichier existe déjà' });
    await expect(warning).toContainText('son contenu va d’abord être ajouté à ce téléphone');
    expect(await writes(phone)).toBe(0);
    await warning.getByRole('button', { name: 'Continuer' }).click();
    await expect(phone.getByTestId('info-dialog').getByRole('listitem')).toHaveText(['cours']);
    await phone.getByTestId('info-ok').click();
    await expect.poll(() => writes(phone)).toBe(1);
    // Le fichier garde le livre (à réimporter) et sa progression : il n'a pas été vidé.
    const kept = JSON.parse((await driveFiles(phone))[uri!]!);
    expect(kept.books.map((b: { title: string }) => b.title)).toEqual(['cours']);
    expect(kept.progress).toHaveLength(1);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('fichier supprimé de Drive : signalé au lancement suivant, à choisir de nouveau', async ({ page }) => {
    const errors = watchErrors(page);
    await simulateAndroid(page);
    await page.clock.install();
    await page.goto('/');
    await importFile(page, 'cours.md', 'text/markdown', Buffer.from('# Un\n\nPremier chapitre avec du texte.\n'));
    await page.getByTestId('back').click();
    await page.getByTestId('open-data').click();
    await page.getByTestId('auto-backup-choose').click();
    await expect(page.getByTestId('auto-backup-status')).toContainText('Dernière sauvegarde');
    await page.keyboard.press('Escape');
    await page.clock.fastForward('00:16');

    // Le fichier disparaît de Drive ; la sauvegarde faite en quittant l'app échoue sans bruit…
    await page.evaluate(() => window.__android.files.clear());
    await importFile(page, 'notes.md', 'text/markdown', Buffer.from('# Deux\n\nAutre texte.\n'));
    await page.getByTestId('back').click();
    await page.clock.fastForward('03:00');
    await leaveApp(page);
    await expect.poll(() => page.evaluate(() => window.__android.calls.filter((c) => c === 'BackupFile.write').length)).toBe(2);
    await expect(page.getByTestId('toast').filter({ hasText: 'échoué' })).toHaveCount(0);

    // … et le lancement suivant le dit, une fois.
    await page.reload();
    await page.clock.fastForward('00:16');
    await expect(page.getByTestId('toast')).toHaveText('La sauvegarde automatique ne trouve plus son fichier : choisis de nouveau l’emplacement dans « Mes données ».');
    await page.getByTestId('open-data').click();
    await expect(page.getByTestId('auto-backup-error')).toHaveText('Ce fichier n’est plus accessible (supprimé, déplacé ou droits retirés) : choisis de nouveau l’emplacement.');
    await page.getByTestId('auto-backup-change').click();
    await expect(page.getByTestId('auto-backup-error')).toHaveCount(0);
    await expect(page.getByTestId('auto-backup-status')).toContainText('Dernière sauvegarde : à l’instant');
    expect(errors.filter((e) => !e.includes('introuvable'))).toEqual([]);
  });
});
