import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-400-italic.css';
import '@fontsource/literata/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/library.css';
import './styles/reader.css';
import './styles/sheet.css';
import './styles/review.css';

import { logError } from './core/errors';
import { applyReaderSettings, loadReaderSettings } from './storage/settings';
import { migrateDeviceIfNeeded, type ImportReport } from './storage/migrate-v5';
import { showImportReport } from './ui/data-sheet';
import { toast, withBusy } from './ui/feedback';
import { libraryScreen } from './ui/library';
import { readerScreen } from './ui/reader';
import { reviewScreen } from './ui/review';
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
  screen = route.name === 'reader' ? readerScreen(route.bookId, navigate) : route.name === 'review' ? reviewScreen(navigate) : libraryScreen(navigate);
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
  navigate({ name: 'library' });
  if (report) {
    await showImportReport('Bienvenue dans la nouvelle version', 'Tes données de la V5.7 ont été reprises :', report);
    if (report.cards) toast('Les questions des fiches reprises ont été générées automatiquement : personnalise-les depuis le lecteur.', 'info', 7000);
  }
}

void start();
