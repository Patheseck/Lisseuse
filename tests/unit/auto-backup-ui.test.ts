import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBook } from '../../src/book/service';
import { loadAutoBackup, saveAutoBackup, type AutoBackup } from '../../src/storage/auto-backup';
import { decrypt } from '../../src/storage/backup';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { autoBackupSection, formatSize, formatWhen, type RestoredBackup } from '../../src/ui/auto-backup-section';

// Le sélecteur d'Android et l'écriture dans le fichier choisi sont simulés ; le reste (réglage,
// contenu de la sauvegarde, chiffrement, fenêtres) est le vrai code.
const native = vi.hoisted(() => ({
  create: vi.fn(),
  open: vi.fn(),
  release: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock('../../src/native/backup-file', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/native/backup-file')>();
  return {
    ...real,
    createBackupFile: native.create,
    openBackupFile: native.open,
    releaseBackupFile: native.release,
    readBackupFile: native.read,
    autoBackupDeps: { write: native.write, lost: real.fileLost },
  };
});

const DRIVE_PROVIDER = 'com.google.android.apps.docs.storage';
const DRIVE_FILE = { uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D42', provider: DRIVE_PROVIDER, name: 'Liseuse - sauvegarde.json', readable: true, writable: true, exists: true };
const CONFIG: AutoBackup = { uri: DRIVE_FILE.uri, name: DRIVE_FILE.name, provider: DRIVE_PROVIDER, auto: true };

let writes: { uri: string; text: string }[] = [];

beforeAll(() => {
  // jsdom ne connaît pas encore les fenêtres modales.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal !== 'function') proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  if (typeof proto.close !== 'function') proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

beforeEach(() => {
  writes = [];
  for (const fn of Object.values(native)) fn.mockReset();
  native.release.mockResolvedValue(undefined);
  native.write.mockImplementation(async (uri: string, text: string) => {
    writes.push({ uri, text });
    return { ...DRIVE_FILE, written: new TextEncoder().encode(text).length };
  });
});

afterEach(async () => {
  for (const el of [...document.body.children]) if (!el.classList.contains('toast-region')) el.remove();
  document.querySelector('.toast-region')?.replaceChildren();
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const byTestId = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const text = (id: string) => byTestId(id)?.textContent ?? '';
const toasts = () => [...document.querySelectorAll('[data-testid="toast"]')].map((t) => t.textContent);

function mount(restore = vi.fn(async (_text: string): Promise<RestoredBackup | null> => ({ kind: 'v6', includesBooks: false }))) {
  const section = autoBackupSection(restore);
  document.body.append(section);
  return { section, restore };
}

async function click(id: string): Promise<void> {
  await vi.waitFor(() => expect(byTestId(id)).not.toBeNull());
  byTestId(id)!.click();
}

/** Bouton d'une fenêtre de confirmation ouverte. */
async function answer(value: 'ok' | 'cancel'): Promise<void> {
  await vi.waitFor(() => expect(document.querySelector(`dialog[open] button[value="${value}"]`)).not.toBeNull());
  document.querySelector<HTMLButtonElement>(`dialog[open] button[value="${value}"]`)!.click();
}

describe('formats lisibles', () => {
  it('taille et moment', () => {
    expect(formatSize(512)).toBe('512 o');
    expect(formatSize(12_400)).toBe('12 Ko');
    expect(formatSize(3_565_158)).toBe('3,4 Mo');
    const now = Date.parse('2026-11-10T15:00:00');
    expect(formatWhen(now - 20_000, now)).toBe('à l’instant');
    expect(formatWhen(now - 5 * 60_000, now)).toBe('il y a 5 min');
    expect(formatWhen(Date.parse('2026-11-10T09:05:00'), now)).toBe('aujourd’hui à 09:05');
    expect(formatWhen(Date.parse('2026-11-02T09:05:00'), now)).toBe('2 nov. à 09:05');
  });
});

describe('section « Sauvegarde automatique (Google Drive) »', () => {
  it('choisir l’emplacement : le fichier est créé dans Drive et la première sauvegarde écrite', async () => {
    await importBook(new File(['# Un\n\nDu texte.\n'], 'cours.md', { type: 'text/markdown' }));
    native.create.mockResolvedValue(DRIVE_FILE);
    mount();
    await click('auto-backup-choose');
    await vi.waitFor(() => expect(text('auto-backup-status')).toMatch(/^Dernière sauvegarde : à l’instant \(\d+ (o|Ko)\)\.$/));
    expect(native.create).toHaveBeenCalledWith('Liseuse - sauvegarde.json');
    expect(text('auto-backup-file')).toBe('Fichier « Liseuse - sauvegarde.json », dans Google Drive.');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.uri).toBe(DRIVE_FILE.uri);
    expect(JSON.parse(writes[0]!.text)).toMatchObject({ app: 'liseuse', includesBooks: false });
    expect(toasts()).toContain('Sauvegarde enregistrée dans Google Drive.');
    expect(await loadAutoBackup()).toMatchObject({ uri: DRIVE_FILE.uri, provider: DRIVE_PROVIDER, auto: true });
    expect(text('auto-backup-books-hint')).toContain('Les fichiers des livres n’y sont pas');
    expect(byTestId<HTMLInputElement>('auto-backup-auto')!.checked).toBe(true);
    expect(byTestId<HTMLInputElement>('auto-backup-encrypt')!.checked).toBe(false);
  });

  it('sélecteur fermé sans choisir : rien ne change, pas de message d’erreur', async () => {
    native.create.mockRejectedValue(Object.assign(new Error('Aucun emplacement choisi.'), { code: 'CANCELLED' }));
    mount();
    await click('auto-backup-choose');
    await vi.waitFor(() => expect(native.create).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(byTestId('auto-backup-choose')).not.toBeNull();
    expect(toasts()).toEqual([]);
    expect(await loadAutoBackup()).toBeNull();
  });

  it('emplacement en lecture seule : refusé et rendu', async () => {
    native.create.mockResolvedValue({ ...DRIVE_FILE, writable: false });
    mount();
    await click('auto-backup-choose');
    await vi.waitFor(() => expect(toasts()).toContain('Liseuse ne peut pas écrire à cet emplacement. Choisis un dossier de ton Google Drive.'));
    expect(native.release).toHaveBeenCalledWith(DRIVE_FILE.uri);
    expect(writes).toEqual([]);
    expect(await loadAutoBackup()).toBeNull();
  });

  it('chiffrer : mot de passe demandé deux fois, sauvegarde refaite chiffrée', async () => {
    await saveAutoBackup({ ...CONFIG, lastAt: Date.now() - 3_600_000, lastSize: 2048 });
    mount();
    await vi.waitFor(() => expect(text('auto-backup-status')).toBe(`Dernière sauvegarde : ${formatWhen(Date.now() - 3_600_000)} (2 Ko).`));
    await click('auto-backup-encrypt');
    await vi.waitFor(() => expect(byTestId('password-confirm')).not.toBeNull());
    byTestId<HTMLInputElement>('password')!.value = 'lune-et-soleil';
    byTestId<HTMLInputElement>('password-confirm')!.value = 'lune-et-soleil';
    byTestId('password-ok')!.click();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const written = JSON.parse(writes[0]!.text) as { encrypted: true };
    expect(written).toMatchObject({ encrypted: true });
    expect(JSON.parse(await decrypt(written as never, 'lune-et-soleil'))).toMatchObject({ app: 'liseuse' });
    await vi.waitFor(() => expect(byTestId<HTMLInputElement>('auto-backup-encrypt')!.checked).toBe(true));
    expect((await loadAutoBackup())!.password).toBe('lune-et-soleil');
  });

  it('chiffrement annulé : la case reste décochée et rien ne s’écrit', async () => {
    await saveAutoBackup(CONFIG);
    mount();
    await click('auto-backup-encrypt');
    await vi.waitFor(() => expect(byTestId('password')).not.toBeNull());
    [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent === 'Annuler')!.click();
    await vi.waitFor(() => expect(byTestId<HTMLInputElement>('auto-backup-encrypt')!.checked).toBe(false));
    expect(writes).toEqual([]);
    expect((await loadAutoBackup())!.password).toBeUndefined();
  });

  it('décocher « automatiquement » : gardé sans rien écrire', async () => {
    await saveAutoBackup(CONFIG);
    mount();
    await click('auto-backup-auto');
    await vi.waitFor(async () => expect((await loadAutoBackup())!.auto).toBe(false));
    expect(writes).toEqual([]);
  });

  it('fichier perdu : expliqué, et « Sauvegarder maintenant » qui échoue le signale', async () => {
    await saveAutoBackup({ ...CONFIG, lastError: 'Le fichier de sauvegarde est introuvable (supprimé ou déplacé).', lost: true });
    native.write.mockRejectedValue(Object.assign(new Error('Le fichier de sauvegarde est introuvable (supprimé ou déplacé).'), { code: 'NOT_FOUND' }));
    mount();
    await vi.waitFor(() => expect(text('auto-backup-error')).toBe('Ce fichier n’est plus accessible (supprimé, déplacé ou droits retirés) : choisis de nouveau l’emplacement.'));
    expect(byTestId('auto-backup-change')!.className).toBe('btn btn-primary');
    expect(text('auto-backup-change')).toBe('Choisir de nouveau l’emplacement');
    expect(byTestId('auto-backup-now')!.className).toBe('btn');
    await click('auto-backup-now');
    await vi.waitFor(() => expect(toasts()).toContain('Sauvegarde impossible : Le fichier de sauvegarde est introuvable (supprimé ou déplacé).'));
    expect(byTestId('auto-backup-error')).not.toBeNull();
  });

  it('changer d’emplacement : l’ancien fichier est rendu, les réglages gardés', async () => {
    await saveAutoBackup({ ...CONFIG, password: 'lune-et-soleil', auto: false });
    const other = { ...DRIVE_FILE, uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D77', name: 'Liseuse - sauvegarde (1).json' };
    native.create.mockResolvedValue(other);
    mount();
    await click('auto-backup-change');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(native.release).toHaveBeenCalledWith(CONFIG.uri);
    expect(writes[0]!.uri).toBe(other.uri);
    expect(await loadAutoBackup()).toMatchObject({ uri: other.uri, name: other.name, password: 'lune-et-soleil', auto: false });
    await vi.waitFor(() => expect(text('auto-backup-file')).toBe('Fichier « Liseuse - sauvegarde (1).json », dans Google Drive.'));
  });

  it('arrêter : confirmé, le droit sur le fichier est rendu', async () => {
    await saveAutoBackup(CONFIG);
    mount();
    await click('auto-backup-stop');
    await answer('cancel');
    expect(await loadAutoBackup()).not.toBeNull();
    await click('auto-backup-stop');
    await answer('ok');
    await vi.waitFor(() => expect(byTestId('auto-backup-choose')).not.toBeNull());
    expect(native.release).toHaveBeenCalledWith(CONFIG.uri);
    expect(await loadAutoBackup()).toBeNull();
    expect(toasts()).toContain('Sauvegarde automatique arrêtée.');
  });

  it('nouveau téléphone : restaurer depuis Drive puis continuer à sauvegarder dans le même fichier', async () => {
    native.open.mockResolvedValue(DRIVE_FILE);
    native.read.mockResolvedValue('{"app":"liseuse"}');
    const { restore } = mount();
    await click('auto-backup-restore-pick');
    await answer('ok');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(native.read).toHaveBeenCalledWith(DRIVE_FILE.uri);
    expect(restore).toHaveBeenCalledWith('{"app":"liseuse"}');
    expect(await loadAutoBackup()).toMatchObject({ uri: DRIVE_FILE.uri, auto: true });
    expect(JSON.parse(writes[0]!.text)).toMatchObject({ app: 'liseuse' });
    expect(native.release).not.toHaveBeenCalled();
  });

  it('fichier chiffré : il le reste sur le nouveau téléphone', async () => {
    native.open.mockResolvedValue(DRIVE_FILE);
    native.read.mockResolvedValue('{"encrypted":true}');
    mount(vi.fn(async () => ({ kind: 'v6' as const, includesBooks: false, password: 'lune-et-soleil' })));
    await click('auto-backup-restore-pick');
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')?.textContent).toContain('dans ce fichier (Google Drive), chiffré avec le même mot de passe ?'));
    await answer('ok');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const written = JSON.parse(writes[0]!.text);
    expect(written).toMatchObject({ encrypted: true });
    expect(JSON.parse(await decrypt(written, 'lune-et-soleil'))).toMatchObject({ app: 'liseuse', includesBooks: false });
    expect(await loadAutoBackup()).toMatchObject({ uri: DRIVE_FILE.uri, password: 'lune-et-soleil' });
    await vi.waitFor(() => expect(byTestId<HTMLInputElement>('auto-backup-encrypt')?.checked).toBe(true));
  });

  it('export complet (avec les livres) restauré : gardé tel quel, la suite va dans un nouveau fichier', async () => {
    const full = { ...DRIVE_FILE, uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D9', name: 'liseuse-sauvegarde-2026-11-01.json' };
    native.open.mockResolvedValue(full);
    native.read.mockResolvedValue('{"encrypted":true}');
    native.create.mockResolvedValue(DRIVE_FILE);
    mount(vi.fn(async () => ({ kind: 'v6' as const, includesBooks: true, password: 'lune-et-soleil' })));
    await click('auto-backup-restore-pick');
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')?.textContent).toContain('dans un nouveau fichier de ton Google Drive, chiffré avec le même mot de passe ? Le fichier restauré reste tel quel.'));
    await answer('ok');
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(native.release).toHaveBeenCalledWith(full.uri);
    expect(writes[0]!.uri).toBe(DRIVE_FILE.uri);
    expect(JSON.parse(writes[0]!.text)).toMatchObject({ encrypted: true });
    expect(await loadAutoBackup()).toMatchObject({ uri: DRIVE_FILE.uri, password: 'lune-et-soleil' });
  });

  it('sauvegarde de la V5 restaurée : jamais remplacée, pas de proposition', async () => {
    native.open.mockResolvedValue(DRIVE_FILE);
    native.read.mockResolvedValue('{"cards":[]}');
    const { restore } = mount(vi.fn(async () => ({ kind: 'v5' as const, includesBooks: false })));
    await click('auto-backup-restore-pick');
    await vi.waitFor(() => expect(native.release).toHaveBeenCalledWith(DRIVE_FILE.uri));
    expect(restore).toHaveBeenCalled();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(writes).toEqual([]);
  });

  it('restauration sans continuer : le droit sur le fichier est rendu', async () => {
    native.open.mockResolvedValue(DRIVE_FILE);
    native.read.mockResolvedValue('{"app":"liseuse"}');
    mount();
    await click('auto-backup-restore-pick');
    await answer('cancel');
    await vi.waitFor(() => expect(native.release).toHaveBeenCalledWith(DRIVE_FILE.uri));
    expect(writes).toEqual([]);
    expect(await loadAutoBackup()).toBeNull();
  });

  it('restauration ratée (mauvais mot de passe…) : rien d’autre ne se passe', async () => {
    native.open.mockResolvedValue(DRIVE_FILE);
    native.read.mockResolvedValue('{}');
    const { restore } = mount(vi.fn(async () => null));
    await click('auto-backup-restore-pick');
    await vi.waitFor(() => expect(restore).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(writes).toEqual([]);
  });

  it('« Restaurer cette sauvegarde » lit le fichier tenu à jour, sans redemander l’emplacement', async () => {
    await saveAutoBackup(CONFIG);
    native.read.mockResolvedValue('{"app":"liseuse"}');
    const { restore } = mount();
    await click('auto-backup-restore');
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith('{"app":"liseuse"}'));
    expect(native.read).toHaveBeenCalledWith(CONFIG.uri);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(native.open).not.toHaveBeenCalled();
  });
});
