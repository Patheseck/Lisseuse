import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { bytesToBase64 } from '../core/base64';
import { isNative } from './platform';

/**
 * Remet un fichier à l'utilisateur. Android : menu de partage (Drive, e-mail, Fichiers…),
 * car la WebView ne sait pas télécharger. Navigateur : téléchargement classique.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (isNative()) {
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const { uri } = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    try {
      await Share.share({ title: fileName, files: [uri], dialogTitle: 'Enregistrer ou envoyer la sauvegarde' });
    } catch (err) {
      // Fermer le menu de partage n'est pas une erreur.
      if (!/cancel/i.test(String((err as Error)?.message ?? err))) throw err;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
