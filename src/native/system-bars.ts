import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { setWindowBackground } from './reader-native';
import { isNative } from './platform';

// Barres d'Android (heure, batterie, navigation) accordées au thème de l'app : icônes claires sur
// un thème sombre, et fond de fenêtre de la couleur du thème (visible derrière les barres quand la
// WebView du téléphone ne dessine pas sous elles).

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Vrai si la couleur de fond est sombre (les icônes des barres doivent alors être claires). */
export function isDarkBackground(color: string): boolean {
  const l = luminance(color);
  return l !== null && l < 0.3;
}

export async function syncSystemBars(): Promise<void> {
  if (!isNative()) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  await SystemBars.setStyle({ style: isDarkBackground(bg) ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
  // Après setStyle, qui remet le fond de fenêtre par défaut.
  if (/^#[0-9a-f]{6}$/i.test(bg)) await setWindowBackground(bg);
}

/** Resynchronise quand le thème « Auto » change avec le téléphone, ou après une rotation. */
export function watchSystemBars(): void {
  if (!isNative()) return;
  let timer: number | undefined;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncSystemBars(), 150);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', later);
  window.addEventListener('resize', later);
  void syncSystemBars();
}
