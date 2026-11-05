import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { isPdf } from '../book/import';
import { base64ToBytes } from '../core/base64';
import { logError } from '../core/errors';
import { isNative } from './platform';

/** Nom lisible d'un fichier à partir de son adresse Android (content://… ou file://…). */
export function fileNameFromUri(uri: string, bytes: Uint8Array): string {
  let last = uri.split(/[?#]/)[0]!.split('/').pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // nom laissé tel quel
  }
  last = last.split(/[:/]/).pop() ?? '';
  if (/\.(epub|pdf|md|markdown|txt)$/i.test(last)) return last;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const pdf = isPdf(bytes);
  // Sans extension connue : EPUB si c'est une archive, PDF à sa signature, sinon texte (vérifié à l'import).
  return isZip ? `${last || 'livre'}.epub` : pdf ? `${last || 'document'}.pdf` : `${last || 'document'}.md`;
}

/**
 * Lit un fichier transmis par Android. D'abord par le serveur local de l'app (le fichier arrive
 * tel quel, même un PDF de plusieurs centaines de Mo) ; sinon par le module Filesystem, qui le
 * fait passer en base64 (trois copies en mémoire : réservé aux cas où la première voie échoue).
 */
async function readSharedFile(url: string): Promise<Blob> {
  try {
    const res = await fetch(Capacitor.convertFileSrc(url));
    if (res.ok) return await res.blob();
  } catch {
    // voie suivante
  }
  const { data } = await Filesystem.readFile({ path: url });
  return typeof data === 'string' ? new Blob([base64ToBytes(data) as BlobPart]) : data;
}

/**
 * « Ouvrir avec Liseuse » : reçoit le fichier transmis par Android, au lancement de l'app
 * ou pendant qu'elle tourne, et le confie à `onFile`.
 */
export async function listenForOpenedFiles(onFile: (file: File) => void): Promise<void> {
  if (!isNative()) return;
  const handle = async (url: string | undefined) => {
    if (!url || !/^(content|file):/i.test(url)) return;
    try {
      const blob = await readSharedFile(url);
      const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
      onFile(new File([blob], fileNameFromUri(url, head)));
    } catch (err) {
      logError('ouverture de fichier', err);
      throw err;
    }
  };
  await App.addListener('appUrlOpen', ({ url }) => void handle(url).catch(() => undefined));
  const launch = await App.getLaunchUrl();
  await handle(launch?.url);
}
