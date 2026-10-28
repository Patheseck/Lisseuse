import { add, h } from './dom';
import { createSheet, type Sheet } from './sheet';

/**
 * Adresse de contact affichée dans « À propos ». À renseigner avant la publication ;
 * vide, la ligne de contact n'est pas affichée.
 */
export const SUPPORT_EMAIL = '';

/** Engagements de confidentialité (repris dans docs/CONFIDENTIALITE.md). */
export const PRIVACY_POINTS = [
  'Liseuse fonctionne entièrement hors ligne : l’application n’a pas accès à Internet.',
  'Aucune donnée n’est collectée, transmise ni vendue : pas de compte, pas de publicité, pas de mesure d’audience.',
  'Tes livres, fiches, statistiques et réglages restent dans la mémoire de ton appareil.',
  'Les sauvegardes sont des fichiers que tu exportes toi-même, où tu le décides ; tu peux les chiffrer avec un mot de passe.',
  'Le rappel quotidien est une notification programmée sur l’appareil, sans serveur.',
  'Le journal d’erreurs reste sur l’appareil et n’est envoyé à personne.',
  'Les morceaux de musique que tu ajoutes aux ambiances restent sur l’appareil. Les liens vers Spotify, YouTube Music ou Deezer ouvrent ces applis, qui ont leurs propres règles de confidentialité.',
  'Désinstaller l’application efface ses données de l’appareil : exporte une sauvegarde avant.',
];

/** Panneau « À propos » : version, confidentialité, logiciels libres et leurs licences. */
export function aboutSheet(): Sheet {
  const sheet = createSheet({ title: 'À propos', kind: 'full', testId: 'about-sheet' });
  // tabindex : la zone défile, elle doit être atteignable au clavier.
  const licenses = h('pre', { className: 'licenses-text', tabindex: 0, 'aria-label': 'Textes des licences', 'data-testid': 'licenses-text' }, 'Chargement…');
  const details = h('details', { className: 'data-section', 'data-testid': 'about-licenses' },
    h('summary', {}, 'Logiciels libres et licences'),
    h('p', { className: 'hint' }, 'Liseuse est construite avec des logiciels libres. Leurs licences demandent que ces mentions accompagnent l’application.'),
    licenses,
  );
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    fetch('licenses.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => (licenses.textContent = text))
      .catch(() => {
        loaded = false;
        licenses.textContent = 'La liste des licences n’a pas pu être chargée.';
      });
  });

  add(sheet.body,
    h('section', { className: 'about-head' },
      h('h3', { className: 'about-name' }, 'Liseuse'),
      h('p', { className: 'about-version', 'data-testid': 'about-version' }, `Version ${__APP_VERSION__}`),
      h('p', { className: 'muted' }, 'Liseuse d’apprentissage : lire activement, se poser des questions, retenir durablement grâce à la répétition espacée.'),
    ),
    h('section', { className: 'data-section', 'data-testid': 'about-privacy' },
      h('h3', {}, 'Confidentialité'),
      h('ul', { className: 'about-list' }, ...PRIVACY_POINTS.map((p) => h('li', {}, p))),
    ),
    SUPPORT_EMAIL
      ? h('section', { className: 'data-section' }, h('h3', {}, 'Contact'), h('p', {}, h('a', { href: `mailto:${SUPPORT_EMAIL}` }, SUPPORT_EMAIL)))
      : null,
    details,
  );
  return sheet;
}
