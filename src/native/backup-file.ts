import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative } from './platform';

// Fichier de sauvegarde choisi une fois dans le sélecteur d'Android (Google Drive, ou tout autre
// emplacement) et tenu à jour par l'app (android/app/src/main/java/…/BackupFilePlugin.java).
// C'est l'emplacement (l'app Google Drive) qui l'envoie en ligne : l'app ne se connecte à rien.

export interface BackupFileInfo {
  uri: string;
  /** Fournisseur de l'emplacement (« com.google.android.apps.docs.storage » pour Google Drive). */
  provider?: string;
  name?: string;
  size?: number;
  lastModified?: number;
  readable?: boolean;
  writable?: boolean;
  /** Faux : le fichier a été supprimé ou déplacé. */
  exists?: boolean;
  /** Octets écrits (après une sauvegarde). */
  written?: number;
}

interface BackupFilePlugin {
  create(options: { fileName: string }): Promise<BackupFileInfo>;
  open(): Promise<BackupFileInfo>;
  info(options: { uri: string }): Promise<BackupFileInfo>;
  write(options: { uri: string; from: string }): Promise<BackupFileInfo>;
  release(options: { uri: string }): Promise<void>;
}

const BackupFile = registerPlugin<BackupFilePlugin>('BackupFile');

/** Sauvegarde dans un fichier choisi (Google Drive…) : seulement dans l'app Android. */
export const backupFileSupported = (): boolean => isNative();

/** L'emplacement est Google Drive. */
export const isGoogleDrive = (info: Pick<BackupFileInfo, 'provider'>): boolean => /google\.android\.apps\.docs/.test(info.provider ?? '');

/** L'utilisateur a fermé le sélecteur sans rien choisir. */
export const pickCancelled = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'CANCELLED';

/** Erreur d'écriture due au fichier lui-même (supprimé, déplacé, droits retirés) : il faut le choisir de nouveau. */
export const fileLost = (err: unknown): boolean => ['ACCESS_LOST', 'NOT_FOUND'].includes((err as { code?: string } | null)?.code ?? '');

export function createBackupFile(fileName: string): Promise<BackupFileInfo> {
  return BackupFile.create({ fileName });
}

export function openBackupFile(): Promise<BackupFileInfo> {
  return BackupFile.open();
}

export function backupFileInfo(uri: string): Promise<BackupFileInfo> {
  return BackupFile.info({ uri });
}

export function releaseBackupFile(uri: string): Promise<void> {
  return BackupFile.release({ uri });
}

/** Remplace le contenu du fichier choisi (préparé d'abord dans le cache de l'app). */
export async function writeBackupFile(uri: string, text: string): Promise<BackupFileInfo> {
  const path = 'sauvegarde-automatique.json';
  const { uri: from } = await Filesystem.writeFile({ path, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    return await BackupFile.write({ uri, from });
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}

/** Écriture de la sauvegarde automatique (storage/auto-backup.ts) dans le fichier choisi. */
export const autoBackupDeps = {
  write: writeBackupFile,
  lost: fileLost,
};

/** Lit le fichier choisi (restauration). */
export async function readBackupFile(uri: string): Promise<string> {
  const res = await fetch(Capacitor.convertFileSrc(uri));
  if (!res.ok) throw new Error('Le fichier de sauvegarde n’a pas pu être lu.');
  return res.text();
}
