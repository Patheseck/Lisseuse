import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-400-italic.css';
import '@fontsource/literata/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-400-italic.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/opendyslexic/latin-400.css';
import '@fontsource/opendyslexic/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/library.css';
import './styles/reader.css';
import './styles/sheet.css';
import './styles/review.css';
import './styles/stats.css';

import { logError } from './core/errors';
import { applyReaderSettings, loadReaderSettings } from './storage/settings';
import { migrateDeviceIfNeeded, type ImportReport } from './storage/migrate-v5';
import { showImportReport } from './ui/data-sheet';
import { App } from '@capacitor/app';
import { listenForOpenedFiles } from './native/open-file';
import { isNative } from './native/platform';
import { applyReminder, loadReminder } from './native/reminder';
import { watchSystemBars } from './native/system-bars';
import { importAndOpen } from './ui/import-flow';
import { toast, withBusy } from './ui/feedback';
import { libraryScreen } from './ui/library';
import { readerScreen } from './ui/reader';
import { reviewScreen } from './ui/review';
import { statsScreen } from './ui/stats';
import type { Route, Screen } from './ui/screen';

window.addEventListener('error', (e) => {
  logError('erreur', e.error ?? e.message);
  toast('Une erreur inattendue est survenue. Elle a été notée dans le journal.', 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  logError('promesse', e.reason);
  toast('Une erreur inattendue est survenue. Elle a été notée dans le journal.', 'error');
});

const root = document.getElementById('app');
if (!root) throw new Error('#app introuvable');

let screen: Screen | null = null;

function navigate(route: Route): void {
  screen?.destroy();
  screen = route.name === 'reader' ? readerScreen(route.bookId, navigate) : route.name === 'review' ? reviewScreen(navigate) : route.name === 'stats' ? statsScreen(navigate) : libraryScreen(navigate);
  // Transition douce : on entre dans un écran en avançant, on revient à la bibliothèque en reculant.
  const from = document.documentElement.dataset.screen;
  if (from) screen.el.classList.add(route.name === 'library' ? 'enter-back' : 'enter-forward');
  screen.el.addEventListener('animationend', () => screen?.el.classList.remove('enter-back', 'enter-forward'), { once: true });
  root!.replaceChildren(screen.el);
  document.documentElement.dataset.screen = route.name;
}

async function start(): Promise<void> {
  // Premier lancement après la V5.7 : reprise automatique de ses données (jamais modifiées).
  let report: ImportReport | null = null;
  try {
    report = await withBusy('Reprise de tes données de la version précédente…', migrateDeviceIfNeeded);
  } catch (err) {
    logError('migration V5', err);
    toast('Une partie des données de la version précédente n’a pas pu être reprise. Elles restent intactes sur l’appareil.', 'error', 8000);
  }
  // Réglages (thème, taille…) appliqués avant le premier écran ; en cas d'échec, valeurs par défaut.
  try {
    applyReaderSettings(await loadReaderSettings());
  } catch (err) {
    logError('réglages', err);
  }
  // Demande que les livres et fiches ne soient jamais effacés pour libérer de la place.
  void navigator.storage?.persist?.().catch(() => false);
  navigate({ name: 'library' });
  void setupNative();
  if (report) {
    await showImportReport('Bienvenue dans la nouvelle version', 'Tes données de la V5.7 ont été reprises :', report);
    if (report.cards) toast('Les questions des fiches reprises ont été générées automatiquement : personnalise-les depuis le lecteur.', 'info', 7000);
  }
}

/** Intégrations Android : bouton retour, « Ouvrir avec Liseuse », rappel quotidien. */
async function setupNative(): Promise<void> {
  if (!isNative()) return;
  watchSystemBars();
  await App.addListener('backButton', () => {
    // 1. Une fenêtre ou un panneau ouvert se ferme (comme avec Échap).
    const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
    const top = dialogs.at(-1);
    if (top) {
      const cancel = new Event('cancel', { cancelable: true });
      if (top.dispatchEvent(cancel)) top.close();
      return;
    }
    // 2. L'écran gère lui-même (menus, sélection…), sinon retour à la bibliothèque.
    if (screen?.onBack?.()) return;
    if (document.documentElement.dataset.screen !== 'library') navigate({ name: 'library' });
    else void App.minimizeApp();
  });
  await listenForOpenedFiles((file) => void importAndOpen(file, navigate)).catch(() => {
    toast('Ce fichier n’a pas pu être ouvert.', 'error');
  });
  // Reprogramme le rappel (Android peut l'avoir perdu après une mise à jour de l'app).
  await loadReminder().then((r) => applyReminder(r)).catch((err: unknown) => logError('rappel', err));
}

void start();
