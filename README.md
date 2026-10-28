# Liseuse mnémotechnique

Liseuse EPUB / Markdown hors ligne pour apprendre en lisant : fiches question-réponse,
répétition espacée (FSRS-6), rappel actif et aide-mémoire (palais mental, table Mojor).
Application Android via Capacitor.

- Cahier des charges : [docs/CAHIER-DES-CHARGES-V6.md](docs/CAHIER-DES-CHARGES-V6.md)
- Fondements scientifiques : [docs/RECHERCHE.md](docs/RECHERCHE.md)
- Android (installation, signature, construction) : [docs/ANDROID.md](docs/ANDROID.md)
- `legacy/v5.7/` : version d'origine, conservée comme référence (bugs connus, ne pas modifier).

## Avancement V6

- [x] Étape 1 — Socle : Vite + TypeScript, IndexedDB, bibliothèque, import EPUB/Markdown, lecteur minimal, tests, CI
- [x] Étape 2 — Lecteur complet (sommaire, recherche, réglages, surlignage)
- [x] Étape 3 — Fiches question-réponse et étapes, révision FSRS-6 (confiance, réapprentissage, entrelacement)
- [x] Étape 4 — Reprise automatique des données V5.7, sauvegarde/restauration par fusion (livres inclus en option, chiffrement)
- [x] Étape 5 — Rappel libre de fin de chapitre, pré-questions, aide-mémoire (Mojor, palais mental), tableau de bord « Ma mémoire »
- [x] Lot « premium » : pages tournées (glisser, taps, volume), plein écran, barre d'état, 6 thèmes, luminosité, typographie fine
- [x] Lot « méthode » (Lire · Poser · Récupérer) : aperçu du chapitre et question directrice, restitution en 3 couches, tri des idées en 3 niveaux et points « à approfondir », chapitres choisis pour son objectif
- [x] Lot « premium 2 » : étagère en grille avec couvertures générées, tri, « Continuer la lecture », signets, défilement automatique, transitions animées
- [x] Préparation à la vente (6.3) : livres protégés (DRM) détectés, chapitres géants découpés (fiches et positions migrées), langue des livres, presse-papiers natif, contrastes, barres système, « À propos » (version, confidentialité, licences), AAB et versions automatiques
- [x] Ambiance musicale 1 (6.4) : une ambiance par livre parmi 16 traditions, import de ses propres morceaux, fondus et enchaînements, volume, baisse pendant la voix, arrêt écran éteint, recherche dans Spotify / YouTube Music / Deezer
- [x] Questions 1 (6.5) : « Mon objectif pour ce livre » (de quoi il parle, pourquoi le lire, savoir / savoir-faire / compétence / plaisir, « je serai capable de… », ce que je sais déjà, chapitres utiles), rappelé dans l'aperçu, la restitution, les modèles de fiches, le sommaire et « Continuer la lecture »
- [x] Étape 6 — Application Android (Capacitor) : partage, synthèse vocale, rappel quotidien, ouverture d'EPUB, bouton retour ; APK construit par la CI

## Développement

Prérequis : Node.js 22.

```bash
npm install
npm run dev          # serveur de développement
npm run typecheck    # vérification des types
npm test             # tests unitaires (Vitest)
npm run build        # build de production dans dist/
npm run test:e2e     # parcours complets dans Chromium (Playwright, après build)
npm run check        # tout ce qui précède, comme la CI
```

Première exécution des tests de parcours : `npx playwright install chromium`.

## Organisation

```
src/core/      logique pure : planification FSRS (ts-fsrs), construction des séances
src/book/      analyse EPUB et Markdown, nettoyage HTML (DOMPurify)
src/reader/    logique du lecteur : ancrage des surlignages, recherche
src/storage/   base IndexedDB (livres, chapitres, progression, surlignages, réglages)
src/ui/        écrans (bibliothèque, lecteur) et composants
src/styles/    jetons de design (thème clair/sombre) et styles par écran
tests/unit/    tests Vitest
tests/e2e/     parcours Playwright
```
