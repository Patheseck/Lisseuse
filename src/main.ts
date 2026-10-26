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

import { logError } from './core/errors';
import { applyReaderSettings, loadReaderSettings } from './storage/settings';
import { toast } from './ui/feedback';
import { libraryScreen } from './ui/library';
import { readerScreen } from './ui/reader';
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
  screen = route.name === 'reader' ? readerScreen(route.bookId, navigate) : libraryScreen(navigate);
  root!.replaceChildren(screen.el);
  document.documentElement.dataset.screen = route.name;
}

// Réglages (thème, taille…) appliqués avant le premier écran ; en cas d'échec, valeurs par défaut.
loadReaderSettings()
  .then(applyReaderSettings)
  .catch((err: unknown) => logError('réglages', err))
  .finally(() => navigate({ name: 'library' }));
