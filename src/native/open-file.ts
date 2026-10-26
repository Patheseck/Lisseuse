import { App } from '@capacitor/app';
import { Filesystem } from '@capacitor/filesystem';
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
  if (/\.(epub|md|markdown|txt)$/i.test(last)) return last;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  return isZip ? `${last || 'livre'}.epub` : `${last || 'document'}.md`;
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
      const { data } = await Filesystem.readFile({ path: url });
      const bytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
      onFile(new File([bytes], fileNameFromUri(url, bytes)));
    } catch (err) {
      logError('ouverture de fichier', err);
      throw err;
    }
  };
  await App.addListener('appUrlOpen', ({ url }) => void handle(url).catch(() => undefined));
  const launch = await App.getLaunchUrl();
  await handle(launch?.url);
}
