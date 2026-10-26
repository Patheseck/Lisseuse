/**
 * Enregistre un fichier pour l'utilisateur. Dans un navigateur : téléchargement.
 * L'étape 6 (Android) remplacera ce comportement par le partage natif.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
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
