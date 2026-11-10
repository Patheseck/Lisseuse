import { afterEach, describe, expect, it, vi } from 'vitest';
import { importBook } from '../../src/book/service';
import { anchorFromOffsets } from '../../src/reader/anchor';
import { AUTO_GAP_MS, autoBackupIdle, loadAutoBackup, normalizeAutoBackup, runAutoBackup, saveAutoBackup, type AutoBackup } from '../../src/storage/auto-backup';
import { decrypt, exportBackup, readBackup, restoreBackup } from '../../src/storage/backup';
import { newCard, putCard } from '../../src/storage/cards';
import { closeDb, DB_NAME } from '../../src/storage/db';
import { getSetting } from '../../src/storage/settings';

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const DRIVE: AutoBackup = { uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D42', name: 'Liseuse - sauvegarde.json', provider: 'com.google.android.apps.docs.storage', auto: true };

/** Fichier choisi simulé : garde ce qui y est écrit. */
function fakeFile(fail?: Error & { code?: string }) {
  const writes: string[] = [];
  let now = Date.parse('2026-11-10T10:00:00Z');
  return {
    writes,
    advance(ms: number) {
      now += ms;
    },
    deps: {
      write: async (uri: string, text: string) => {
        if (fail) throw fail;
        expect(uri).toBe(DRIVE.uri);
        writes.push(text);
        return { written: new TextEncoder().encode(text).length };
      },
      lost: (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
      now: () => now,
    },
  };
}

async function seedBook(): Promise<string> {
  const { book } = await importBook(new File(['# Un\n\nPremier chapitre avec du texte.\n'], 'cours.md', { type: 'text/markdown' }));
  return book.id;
}

describe('sauvegarde automatique dans un fichier choisi (Google Drive)', () => {
  it('rien de choisi : rien ne s’écrit', async () => {
    const file = fakeFile();
    expect(await runAutoBackup('auto', file.deps)).toBe('off');
    expect(await runAutoBackup('now', file.deps)).toBe('off');
    expect(file.writes).toEqual([]);
  });

  it('« maintenant » écrit une sauvegarde complète ; l’emplacement n’y figure pas', async () => {
    const id = await seedBook();
    await saveAutoBackup(DRIVE);
    const file = fakeFile();
    expect(await runAutoBackup('now', file.deps)).toBe('written');
    const parsed = await readBackup(file.writes[0]!, async () => null);
    expect(parsed.kind).toBe('v6');
    if (parsed.kind !== 'v6') return;
    expect(parsed.data.books.map((b) => b.id)).toEqual([id]);
    expect(parsed.data.books[0]!.file).toBeUndefined();
    expect(parsed.data.settings.map((s) => s.key)).not.toContain('auto-backup');
    expect(await loadAutoBackup()).toMatchObject({ lastAt: Date.parse('2026-11-10T10:00:00Z'), lastSize: new TextEncoder().encode(file.writes[0]!).length });
  });

  it('en quittant l’app : seulement si quelque chose a changé, et pas plus d’une fois toutes les deux minutes', async () => {
    const id = await seedBook();
    await saveAutoBackup(DRIVE);
    const file = fakeFile();
    expect(await runAutoBackup('auto', file.deps)).toBe('written');
    expect(await runAutoBackup('auto', file.deps)).toBe('unchanged');
    // Une fiche de plus : à sauvegarder, mais pas tout de suite.
    await putCard(newCard(id, 0, anchorFromOffsets('Premier chapitre avec du texte.', 0, 7)));
    file.advance(30_000);
    expect(await runAutoBackup('auto', file.deps)).toBe('too-soon');
    file.advance(AUTO_GAP_MS);
    expect(await runAutoBackup('auto', file.deps)).toBe('written');
    expect(file.writes).toHaveLength(2);
    // Sauvegarde automatique désactivée : seul « maintenant » écrit.
    await saveAutoBackup({ ...(await loadAutoBackup())!, auto: false });
    await putCard(newCard(id, 0, anchorFromOffsets('Premier chapitre avec du texte.', 8, 16)));
    file.advance(AUTO_GAP_MS);
    expect(await runAutoBackup('auto', file.deps)).toBe('off');
    expect(await runAutoBackup('now', file.deps)).toBe('written');
  });

  it('chiffrée : illisible sans le mot de passe, qui reste sur l’appareil (ni dans le fichier ni dans un export)', async () => {
    await seedBook();
    await saveAutoBackup({ ...DRIVE, password: 'lune-et-soleil' });
    const file = fakeFile();
    await runAutoBackup('now', file.deps);
    const written = file.writes[0]!;
    expect(written).not.toContain('lune-et-soleil');
    expect(JSON.parse(written)).toMatchObject({ encrypted: true });
    expect(JSON.parse(await decrypt(JSON.parse(written), 'lune-et-soleil'))).toMatchObject({ app: 'liseuse' });
    const { blob } = await exportBackup({ includeBooks: false });
    expect(await blob.text()).not.toContain('lune-et-soleil');
  });

  it('échec : noté ; fichier perdu, plus d’essai automatique jusqu’à un nouveau choix', async () => {
    await seedBook();
    await saveAutoBackup(DRIVE);
    const lost = Object.assign(new Error('Le fichier de sauvegarde est introuvable (supprimé ou déplacé).'), { code: 'NOT_FOUND' });
    await expect(runAutoBackup('auto', fakeFile(lost).deps)).rejects.toThrow('introuvable');
    expect(await loadAutoBackup()).toMatchObject({ lastError: 'Le fichier de sauvegarde est introuvable (supprimé ou déplacé).', lost: true });
    expect(await runAutoBackup('auto', fakeFile().deps)).toBe('off');
    // Une sauvegarde réussie efface l'erreur.
    expect(await runAutoBackup('now', fakeFile().deps)).toBe('written');
    const config = (await loadAutoBackup())!;
    expect(config.lastError).toBeUndefined();
    expect(config.lost).toBeUndefined();
  });

  it('deux sauvegardes demandées en même temps : l’une après l’autre, une seule écriture', async () => {
    await seedBook();
    await saveAutoBackup(DRIVE);
    const file = fakeFile();
    expect(await Promise.all([runAutoBackup('auto', file.deps), runAutoBackup('auto', file.deps)])).toEqual(['written', 'unchanged']);
    expect(file.writes).toHaveLength(1);
  });

  it('emplacement changé ou sauvegarde arrêtée pendant une écriture : le nouveau réglage est gardé', async () => {
    await seedBook();
    await saveAutoBackup(DRIVE);
    let finish!: () => void;
    const slow = { write: () => new Promise<{ written: number }>((resolve) => (finish = () => resolve({ written: 10 }))) };
    const running = runAutoBackup('now', slow);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const other: AutoBackup = { ...DRIVE, uri: 'content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D77' };
    await saveAutoBackup(other);
    finish();
    expect(await running).toBe('written');
    expect(await loadAutoBackup()).toEqual(other);
    // Arrêtée pendant l'écriture, même en échec : elle reste arrêtée.
    let fail!: () => void;
    const failing = { write: () => new Promise<{ written: number }>((_, reject) => (fail = () => reject(new Error('Écriture impossible')))) };
    const again = runAutoBackup('now', failing);
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    await saveAutoBackup(null);
    fail();
    await expect(again).rejects.toThrow('Écriture impossible');
    expect(await loadAutoBackup()).toBeNull();
    await expect(autoBackupIdle()).resolves.toBeUndefined();
  });

  it('une restauration ne remplace pas l’emplacement choisi sur cet appareil', async () => {
    await seedBook();
    await saveAutoBackup(DRIVE);
    const other = { app: 'liseuse', format: 6, exportedAt: new Date().toISOString(), includesBooks: false, books: [], cards: [], reviews: [], progress: [], settings: [{ key: 'auto-backup', value: { ...DRIVE, uri: 'content://autre/document/1' } }] };
    await restoreBackup(await readBackup(JSON.stringify(other), async () => null));
    expect(((await getSetting('auto-backup')) as AutoBackup).uri).toBe(DRIVE.uri);
  });

  it('réglage lu tel quel ou rejeté s’il est abîmé', () => {
    expect(normalizeAutoBackup(null)).toBeNull();
    expect(normalizeAutoBackup({ name: 'x' })).toBeNull();
    // Champ inconnu (« includeBooks ») ignoré.
    expect(normalizeAutoBackup({ uri: 'content://x', auto: 'oui', includeBooks: true, password: '' })).toEqual({ uri: 'content://x', name: 'Sauvegarde', provider: '', auto: true });
  });
});
