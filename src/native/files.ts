import { Clipboard } from '@capacitor/clipboard';
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

/** Partage un texte : menu de partage d'Android, Web Share si disponible, sinon copie. */
export async function shareText(text: string): Promise<void> {
  if (isNative()) {
    try {
      await Share.share({ text, dialogTitle: 'Partager ce passage' });
    } catch (err) {
      if (!/cancel/i.test(String((err as Error)?.message ?? err))) throw err;
    }
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') throw err;
    }
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** Copie un texte : presse-papiers d'Android (fiable dans l'app), sinon celui du navigateur. */
export async function copyText(text: string): Promise<void> {
  if (isNative()) await Clipboard.write({ string: text });
  else await navigator.clipboard.writeText(text);
}
