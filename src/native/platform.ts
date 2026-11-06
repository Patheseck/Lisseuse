import { Capacitor } from '@capacitor/core';

/** Vrai dans l'application Android, faux dans un navigateur (développement, tests). */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
