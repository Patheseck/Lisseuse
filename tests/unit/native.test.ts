import { describe, expect, it } from 'vitest';
import { fileNameFromUri } from '../../src/native/open-file';
import { normalizeReminder } from '../../src/native/reminder';
import { base64ToBytes, bytesToBase64 } from '../../src/core/base64';

const ZIP = Uint8Array.of(0x50, 0x4b, 3, 4);
const TEXT = new TextEncoder().encode('# Titre');

describe('fileNameFromUri', () => {
  it('extrait le nom des adresses Android usuelles', () => {
    expect(fileNameFromUri('content://com.android.providers.downloads.documents/document/msf%3A1234', ZIP)).toBe('1234.epub');
    expect(fileNameFromUri('content://com.android.externalstorage.documents/document/primary%3ADownload%2FMon%20livre.epub', ZIP)).toBe('Mon livre.epub');
    expect(fileNameFromUri('file:///storage/emulated/0/Download/notes.md', TEXT)).toBe('notes.md');
    expect(fileNameFromUri('content://media/external/file/42?x=1', TEXT)).toBe('42.md');
    expect(fileNameFromUri('content://x/%E0%A4%A', ZIP)).toMatch(/\.epub$/);
  });
});

describe('normalizeReminder', () => {
  it('valide heure et minute, désactivé par défaut', () => {
    expect(normalizeReminder(undefined)).toEqual({ enabled: false, hour: 20, minute: 0 });
    expect(normalizeReminder({ enabled: true, hour: 7, minute: 30 })).toEqual({ enabled: true, hour: 7, minute: 30 });
    expect(normalizeReminder({ enabled: 'oui', hour: 25, minute: -1 })).toEqual({ enabled: false, hour: 20, minute: 0 });
  });
});

describe('base64', () => {
  it('aller-retour sur de gros contenus binaires', () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
