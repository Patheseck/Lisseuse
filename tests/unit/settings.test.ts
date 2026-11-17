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
    expect(s.fontSize).toBe(32);
    expect(s.leading).toBe(1.3);
    expect(normalizeReaderSettings({ fontSize: 2 }).fontSize).toBe(14);
    expect(normalizeReaderSettings({ brightness: 0 }).brightness).toBe(0.3);
  });

  it('accepte les nouveaux thèmes, polices et modes ; rejette le reste', () => {
    const s = normalizeReaderSettings({ theme: 'sepia', font: 'dyslexic', layout: 'scroll', justify: false, paragraph: 'airy', volumeKeys: false });
    expect(s).toMatchObject({ theme: 'sepia', font: 'dyslexic', layout: 'scroll', justify: false, paragraph: 'airy', volumeKeys: false, keepAwake: true });
    expect(normalizeReaderSettings({ theme: 'rose', layout: 'flip', paragraph: 9 })).toMatchObject({ theme: 'auto', layout: 'paged', paragraph: 'normal' });
  });
});

describe('applyReaderSettings', () => {
  it('pose les variables CSS et le thème', () => {
    const root = document.createElement('div');
    applyReaderSettings({ ...DEFAULT_READER_SETTINGS, fontSize: 20, font: 'sans', leading: 1.9, width: 'wide', theme: 'dark', justify: false, indent: true, brightness: 0.6 }, root);
    expect(root.style.getPropertyValue('--reader-size')).toBe('20px');
    expect(root.style.getPropertyValue('--reader-measure')).toBe('52rem');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--reader-align')).toBe('start');
    expect(root.style.getPropertyValue('--para-indent')).toBe('1.5em');
    expect(root.style.getPropertyValue('--dim')).toBe('0.4');
    applyReaderSettings({ ...DEFAULT_READER_SETTINGS, theme: 'auto' }, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
