import { errorMessage, logError } from '../core/errors';
import { autoBackupDeps, createBackupFile, isGoogleDrive, openBackupFile, pickCancelled, readBackupFile, releaseBackupFile, type BackupFileInfo } from '../native/backup-file';
import { autoBackupIdle, loadAutoBackup, runAutoBackup, saveAutoBackup, type AutoBackup } from '../storage/auto-backup';
import { h } from './dom';
import { confirmDialog, passwordDialog, toast, withBusy } from './feedback';

// « Mes données » : sauvegarde automatique dans un fichier choisi une fois dans Google Drive (par
// le sélecteur d'Android). L'app Google Drive du téléphone l'envoie en ligne ; Liseuse ne se
// connecte à rien et ne voit rien d'autre du Drive. Sans les fichiers des livres (voir
// storage/auto-backup.ts) : l'export manuel les inclut sur demande.

const FILE_NAME = 'Liseuse - sauvegarde.json';

/** Taille lisible : « 12 Ko », « 3,4 Mo ». */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

/** Moment lisible : « à l'instant », « il y a 5 min », « aujourd'hui à 14:05 », « 12 nov. à 14:05 ». */
export function formatWhen(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const date = new Date(at);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return `aujourd’hui à ${time}`;
  return `${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`;
}

const place = (c: { provider?: string }) => (isGoogleDrive(c) ? 'Google Drive' : 'l’emplacement choisi');

/** Sauvegarde restaurée : sa version, si elle contenait les livres, et le mot de passe saisi pour l'ouvrir. */
export interface RestoredBackup {
  kind: 'v5' | 'v6';
  includesBooks: boolean;
  password?: string;
}

/** Rend le droit sur un fichier, une fois finies les sauvegardes qui y écrivent encore. */
const releaseLater = (uri: string) => void autoBackupIdle().then(() => releaseBackupFile(uri)).catch(() => undefined);

/**
 * Section « Sauvegarde automatique ». `restore` lit et restaure un texte de sauvegarde (mot de
 * passe demandé au besoin) ; null si la restauration n'a pas eu lieu.
 */
export function autoBackupSection(restore: (text: string) => Promise<RestoredBackup | null>): HTMLElement {
  const section = h('section', { className: 'data-section auto-backup', 'data-testid': 'auto-backup' });

  async function backupNow(): Promise<void> {
    try {
      await withBusy('Sauvegarde en cours…', () => runAutoBackup('now', autoBackupDeps));
      const config = await loadAutoBackup();
      toast(`Sauvegarde enregistrée dans ${config ? place(config) : 'le fichier choisi'}.`);
    } catch (err) {
      logError('sauvegarde automatique', err);
      toast(`Sauvegarde impossible : ${errorMessage(err)}`, 'error', 6000);
    }
    await render();
  }

  /**
   * Nouveau fichier (ou fichier existant après une restauration) : il devient la sauvegarde
   * automatique, avec le mot de passe en cours, ou celui de la sauvegarde restaurée (`keep`).
   */
  async function adopt(info: BackupFileInfo, keep?: Pick<AutoBackup, 'password'>): Promise<boolean> {
    if (!info.writable) {
      toast('Liseuse ne peut pas écrire à cet emplacement. Choisis un dossier de ton Google Drive.', 'error', 6000);
      await releaseBackupFile(info.uri).catch(() => undefined);
      return false;
    }
    const previous = await loadAutoBackup();
    const password = keep ? keep.password : previous?.password;
    await saveAutoBackup({
      uri: info.uri,
      name: info.name ?? FILE_NAME,
      provider: info.provider ?? '',
      auto: previous?.auto ?? true,
      ...(password ? { password } : {}),
    });
    if (previous && previous.uri !== info.uri) releaseLater(previous.uri);
    return true;
  }

  async function choose(keep?: Pick<AutoBackup, 'password'>): Promise<void> {
    let info: BackupFileInfo;
    try {
      info = await createBackupFile(FILE_NAME);
    } catch (err) {
      if (!pickCancelled(err)) {
        logError('sauvegarde automatique', err);
        toast(`Emplacement impossible : ${errorMessage(err)}`, 'error');
      }
      return;
    }
    if (!(await adopt(info, keep))) return render();
    await backupNow();
  }

  async function restoreFrom(info: BackupFileInfo, fromConfig: boolean): Promise<void> {
    let text: string;
    try {
      text = await withBusy('Lecture de la sauvegarde…', () => readBackupFile(info.uri));
    } catch (err) {
      logError('restauration', err);
      toast(`Lecture impossible : ${errorMessage(err)}`, 'error', 6000);
      return;
    }
    const restored = await restore(text);
    if (fromConfig) return;
    // Sauvegarde de Liseuse retrouvée (nouveau téléphone) : la sauvegarde automatique peut reprendre,
    // chiffrée avec le même mot de passe. Dans le même fichier s'il vient d'elle ; un export complet
    // (avec les livres) est gardé tel quel, la suite va dans un nouveau fichier. Une sauvegarde de
    // la V5 n'est jamais remplacée.
    if (restored?.kind === 'v6') {
      const keep = restored.password ? { password: restored.password } : {};
      const encrypted = restored.password ? ', chiffré avec le même mot de passe' : '';
      if (!restored.includesBooks && info.writable) {
        if (await confirmDialog({ title: 'Sauvegarde automatique', message: `Continuer à sauvegarder automatiquement dans ce fichier (${place(info)})${encrypted} ?`, confirmLabel: 'Oui, continuer' })) {
          if (await adopt(info, keep)) await backupNow();
          return;
        }
      } else if (await confirmDialog({ title: 'Sauvegarde automatique', message: `Sauvegarder automatiquement dans un nouveau fichier${isGoogleDrive(info) ? ' de ton Google Drive' : ''}${encrypted} ? Le fichier restauré reste tel quel.`, confirmLabel: 'Choisir l’emplacement' })) {
        await releaseBackupFile(info.uri).catch(() => undefined);
        await choose(keep);
        return;
      }
    }
    await releaseBackupFile(info.uri).catch(() => undefined);
  }

  async function restorePicked(): Promise<void> {
    let info: BackupFileInfo;
    try {
      info = await openBackupFile();
    } catch (err) {
      if (!pickCancelled(err)) {
        logError('restauration', err);
        toast(`Fichier impossible à ouvrir : ${errorMessage(err)}`, 'error');
      }
      return;
    }
    await restoreFrom(info, false);
  }

  async function update(patch: Partial<AutoBackup>, write: boolean): Promise<void> {
    const config = await loadAutoBackup();
    if (!config) return render();
    const next = { ...config, ...patch };
    if (!next.password) delete next.password;
    await saveAutoBackup(next);
    if (write) await backupNow();
    else await render();
  }

  async function setPassword(enabled: boolean): Promise<void> {
    if (!enabled) return update({ password: undefined }, true);
    const password = await passwordDialog({
      title: 'Chiffrer la sauvegarde automatique',
      message: 'Il te sera demandé pour la restaurer, sur ce téléphone ou un autre : conserve-le précieusement. Il est gardé sur ce téléphone pour les prochaines sauvegardes.',
      confirm: true,
      confirmLabel: 'Chiffrer',
    });
    if (!password) return render();
    await update({ password }, true);
  }

  async function stop(): Promise<void> {
    const config = await loadAutoBackup();
    if (!config) return render();
    const ok = await confirmDialog({ title: 'Arrêter la sauvegarde automatique', message: `Le fichier déjà enregistré reste dans ${place(config)} ; Liseuse ne le mettra plus à jour.`, confirmLabel: 'Arrêter' });
    if (!ok) return;
    await saveAutoBackup(null);
    releaseLater(config.uri);
    toast('Sauvegarde automatique arrêtée.');
    await render();
  }

  const button = (label: string, testId: string, onclick: () => Promise<void>, primary = false) =>
    h('button', { type: 'button', className: primary ? 'btn btn-primary' : 'btn', 'data-testid': testId, onclick: () => void onclick() }, label);
  const check = (id: string, checked: boolean, label: string, hint: string, onchange: (value: boolean) => Promise<void>) => {
    const input = h('input', { type: 'checkbox', id, 'data-testid': id, checked });
    input.addEventListener('change', () => void onchange(input.checked));
    return h('label', { className: 'check', for: id }, input, h('span', {}, label, h('small', {}, hint)));
  };

  const booksHint = () => h('p', { className: 'hint', 'data-testid': 'auto-backup-books-hint' }, 'Les fichiers des livres n’y sont pas (trop lourds) : la liste des livres suffit pour retrouver leurs fiches en les réimportant. Pour tout garder d’un coup, exporte une sauvegarde complète ci-dessous.');

  async function render(): Promise<void> {
    const config = await loadAutoBackup().catch((err: unknown) => (logError('sauvegarde automatique', err), null));
    section.replaceChildren(h('h3', {}, 'Sauvegarde automatique (Google Drive)'));
    if (!config) {
      section.append(
        h('p', { className: 'hint' }, 'Choisis une fois un dossier de ton Google Drive : Liseuse y tient ensuite à jour, toute seule, une sauvegarde de tes fiches, révisions, progression et notes, quand tu quittes l’app. C’est l’app Google Drive du téléphone qui l’envoie en ligne (plus tard si tu es hors connexion) ; Liseuse ne voit rien d’autre de ton Drive.'),
        h('p', { className: 'hint' }, 'Dans la fenêtre qui s’ouvre : touche ☰, choisis « Drive », un dossier, puis « Enregistrer ».'),
        booksHint(),
        button('Choisir l’emplacement dans Google Drive', 'auto-backup-choose', choose, true),
        button('Restaurer une sauvegarde de Google Drive', 'auto-backup-restore-pick', restorePicked),
      );
      return;
    }
    const status = config.lastAt !== undefined
      ? `Dernière sauvegarde : ${formatWhen(config.lastAt)}${config.lastSize !== undefined ? ` (${formatSize(config.lastSize)})` : ''}.`
      : 'Pas encore de sauvegarde.';
    section.append(
      h('p', { className: 'hint', 'data-testid': 'auto-backup-file' }, `Fichier « ${config.name} », dans ${place(config)}.`),
      h('p', { 'data-testid': 'auto-backup-status' }, status),
      booksHint(),
      ...(config.lastError
        ? [h('p', { className: 'error-box', 'data-testid': 'auto-backup-error' }, config.lost
          ? 'Ce fichier n’est plus accessible (supprimé, déplacé ou droits retirés) : choisis de nouveau l’emplacement.'
          : `La dernière sauvegarde a échoué : ${config.lastError}`)]
        : []),
      check('auto-backup-auto', config.auto, 'Sauvegarder automatiquement', 'Quand tu quittes l’app, si quelque chose a changé.', (auto) => update({ auto }, false)),
      check('auto-backup-encrypt', !!config.password, 'Chiffrer avec un mot de passe', 'Le mot de passe reste sur ce téléphone ; il sera demandé pour restaurer.', setPassword),
      // Fichier perdu : le choisir de nouveau passe en premier (« Sauvegarder maintenant » échouerait).
      ...(config.lost
        ? [button('Choisir de nouveau l’emplacement', 'auto-backup-change', choose, true), button('Sauvegarder maintenant', 'auto-backup-now', backupNow)]
        : [button('Sauvegarder maintenant', 'auto-backup-now', backupNow, true)]),
      button('Restaurer cette sauvegarde', 'auto-backup-restore', () => restoreFrom({ uri: config.uri, provider: config.provider }, true)),
      ...(config.lost ? [] : [button('Changer d’emplacement', 'auto-backup-change', choose)]),
      button('Arrêter la sauvegarde automatique', 'auto-backup-stop', stop),
    );
  }

  void render();
  return section;
}
