import { describe, expect, it } from 'vitest';
import { applyReaderSettings, DEFAULT_READER_SETTINGS, normalizeReaderSettings } from '../../src/storage/settings';

describe('normalizeReaderSettings', () => {
  it('renvoie les valeurs par défaut pour une donnée absente ou invalide', () => {
    expect(normalizeReaderSettings(undefined)).toEqual(DEFAULT_READER_SETTINGS);
    expect(normalizeReaderSettings('x')).toEqual(DEFAULT_READER_SETTINGS);
    expect(normalizeReaderSettings({ fontSize: 'grand', theme: 'violet', font: 1 })).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('borne et arrondit les valeurs numériques', () => {
    const s = normalizeReaderSettings({ fontSize: 99, leading: 1.234 });
    expect(s.fontSize).toBe(28);
    expect(s.leading).toBe(1.3);
    expect(normalizeReaderSettings({ fontSize: 2 }).fontSize).toBe(14);
  });
});

describe('applyReaderSettings', () => {
  it('pose les variables CSS et le thème', () => {
    const root = document.createElement('div');
    applyReaderSettings({ fontSize: 20, font: 'sans', leading: 1.9, width: 'wide', theme: 'dark' }, root);
    expect(root.style.getPropertyValue('--reader-size')).toBe('20px');
    expect(root.style.getPropertyValue('--reader-measure')).toBe('52rem');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyReaderSettings({ ...DEFAULT_READER_SETTINGS, theme: 'auto' }, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
