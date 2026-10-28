import { registerPlugin } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { ReaderSettings } from '../storage/settings';
import { isNative } from './platform';

// Pont vers le module natif Android de l'app (android/app/src/main/java/…/ReaderNativePlugin.java).

interface ReaderNativePlugin {
  setVolumeKeys(options: { enabled: boolean }): Promise<void>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  setImmersive(options: { enabled: boolean }): Promise<void>;
  setCustomSelection(options: { enabled: boolean }): Promise<void>;
}

const ReaderNative = registerPlugin<ReaderNativePlugin>('ReaderNative');

/** Applique les options Android du lecteur ; `null` les désactive (sortie du lecteur). */
export async function applyReaderNative(settings: ReaderSettings | null): Promise<void> {
  if (!isNative()) return;
  await Promise.all([
    ReaderNative.setVolumeKeys({ enabled: settings?.volumeKeys ?? false }),
    ReaderNative.setKeepAwake({ enabled: settings?.keepAwake ?? false }),
  ]).catch(() => undefined);
}

/** Masque les barres système d'Android pendant la lecture (elles réapparaissent d'un glisser). */
export async function setImmersive(enabled: boolean): Promise<void> {
  if (!isNative()) return;
  await ReaderNative.setImmersive({ enabled }).catch(() => undefined);
}

/** Légère vibration au changement de chapitre. */
export async function chapterTick(): Promise<void> {
  if (!isNative()) return;
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

/** Touches de volume : bas = page suivante, haut = page précédente. Renvoie la fonction de désabonnement. */
export function onVolumeKey(handler: (dir: 1 | -1) => void): () => void {
  const listener = (e: Event) => handler((e as Event & { direction?: string }).direction === 'prev' ? -1 : 1);
  window.addEventListener('liseuseVolume', listener);
  return () => window.removeEventListener('liseuseVolume', listener);
}

/**
 * Pendant la lecture, le menu de sélection d'Android (Copier, Partager…) est masqué :
 * la barre de l'app le remplace, sans superposition. Il reste actif dans les champs de saisie.
 */
export async function setCustomSelectionMenu(enabled: boolean): Promise<void> {
  if (!isNative()) return;
  await ReaderNative.setCustomSelection({ enabled }).catch(() => undefined);
}
