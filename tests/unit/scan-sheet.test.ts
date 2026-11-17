import { describe, expect, it } from 'vitest';
import type { FoundFile } from '../../src/native/storage-scan';
import { describeFound, fileKey, friendlyFolder, sortFound } from '../../src/ui/scan-sheet';

const found = (over: Partial<FoundFile>): FoundFile => ({ path: '/storage/emulated/0/Download/a.epub', name: 'a.epub', size: 2_516_582, modified: Date.parse('2026-11-03T10:00:00Z'), folder: 'Download', volume: 'interne', ...over });

describe('fichiers trouvés dans le téléphone', () => {
  it('emplacement, taille et date lisibles', () => {
    expect(describeFound(found({ folder: 'Download/Telegram' }))).toBe('Download › Telegram · 2,4 Mo · 3 nov. 2026');
    expect(describeFound(found({ folder: '', size: 900 }))).toBe('Mémoire interne · 900 o · 3 nov. 2026');
    expect(describeFound(found({ folder: 'Livres', volume: 'sd' }))).toBe('Carte SD › Livres · 2,4 Mo · 3 nov. 2026');
  });

  it('dossiers d’applis raccourcis (WhatsApp, autres applis)', () => {
    expect(friendlyFolder('Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents')).toBe('WhatsApp/Documents');
    expect(friendlyFolder('Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/Private')).toBe('WhatsApp/Documents/Private');
    expect(friendlyFolder('Android/media/com.whatsapp.w4b/WhatsApp Business/Media/WhatsApp Business Documents')).toBe('WhatsApp Business/Documents');
    expect(friendlyFolder('Android/media/org.telegram.messenger/Telegram/Telegram Documents')).toBe('Telegram/Telegram Documents');
    expect(friendlyFolder('Download/Telegram')).toBe('Download/Telegram');
  });

  it('les plus récents d’abord, puis par nom', () => {
    const files = [found({ name: 'b.pdf', modified: 1 }), found({ name: 'c.pdf', modified: 5 }), found({ name: 'a.pdf', modified: 1 })];
    expect(sortFound(files).map((f) => f.name)).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
  });

  it('déjà importé : même nom (sans tenir compte de la casse) et même taille', () => {
    expect(fileKey('Cours.EPUB', 10)).toBe(fileKey('cours.epub', 10));
    expect(fileKey('cours.epub', 10)).not.toBe(fileKey('cours.epub', 11));
  });
});
