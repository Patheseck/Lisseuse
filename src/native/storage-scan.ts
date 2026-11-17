import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from './platform';

// « Rechercher dans le téléphone » : liste les fichiers à importer trouvés dans la mémoire du
// téléphone et la carte SD (android/app/src/main/java/…/StorageScanPlugin.java), avec
// l'autorisation de l'utilisateur. Google Drive ne se parcourt pas ainsi (Android ne donne accès
// qu'aux fichiers choisis un par un) : il reste accessible par le sélecteur de fichiers.

export interface FoundFile {
  path: string;
  name: string;
  size: number;
  /** Date de modification (ms). */
  modified: number;
  /** Dossier, relatif à la racine du volume (« Download/Telegram »), vide à la racine. */
  folder: string;
  volume: 'interne' | 'sd';
}

interface StorageScanPlugin {
  status(): Promise<{ granted: boolean }>;
  request(): Promise<{ granted: boolean }>;
  scan(options: { extensions: string[]; namePattern?: string; maxResults?: number }): Promise<{ files: FoundFile[]; truncated: boolean }>;
}

const StorageScan = registerPlugin<StorageScanPlugin>('StorageScan');

/** Recherche dans la mémoire du téléphone : seulement dans l'app Android. */
export const scanSupported = (): boolean => isNative();

export function scanStatus(): Promise<{ granted: boolean }> {
  return StorageScan.status();
}

/** Ouvre la page d'autorisation d'Android ; résout avec l'état au retour. */
export function requestScanAccess(): Promise<{ granted: boolean }> {
  return StorageScan.request();
}

export function scanFiles(options: { extensions: string[]; namePattern?: string; maxResults?: number }): Promise<{ files: FoundFile[]; truncated: boolean }> {
  return StorageScan.scan(options);
}

/** Lit un fichier trouvé, par le serveur local de l'app (sans copie en base64, même un gros PDF). */
export async function readFoundFile(f: FoundFile): Promise<File> {
  const res = await fetch(Capacitor.convertFileSrc(`file://${f.path.split('/').map(encodeURIComponent).join('/')}`));
  if (!res.ok) throw new Error(`« ${f.name} » n’a pas pu être lu.`);
  return new File([await res.blob()], f.name);
}
