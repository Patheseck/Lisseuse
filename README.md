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
- [x] Fiches 1 (6.6) : « Mes fiches », toutes les fiches sans ouvrir de livre (recherche, filtres livre / type / état, tris), détail avec historique et mémorisation estimée, et actions : modifier, réviser maintenant, aller au passage (puis revenir à sa lecture), mettre en pause, recommencer à zéro, supprimer
- [x] Sauvegarde Google Drive (6.10, 6.10.1) : sauvegarde automatique dans un fichier choisi une fois dans Google Drive (sélecteur d'Android, sans compte à relier ni accès Internet pour l'app), refaite en quittant l'app si quelque chose a changé (fiches, révisions, progression, notes, réglages et liste des livres ; les fichiers des livres restent dans l'export manuel) ; chiffrement en option ; état et erreurs dans « Mes données » ; restauration depuis Drive sur un nouveau téléphone, puis sauvegarde continuée dans le même fichier avec le même mot de passe ; un fichier existant choisi dans le sélecteur n'est jamais écrasé avant d'avoir été restauré ; les livres pas encore réimportés après une restauration restent décrits dans les sauvegardes suivantes
- [x] PDF 3 (6.9.2) : texte adapté des livres scannés (texte reconnu par OCR) : reconnus à l'import et signalés, lignes de bruit des illustrations retirées, faux titres écartés, paragraphes recollés malgré les tailles irrégulières, titres d'un même style réunis ; pour tous les PDF, numéros de chapitre « I », « V » gardés (plus pris pour des lettrines), vers des poèmes et des fables avec leurs retours à la ligne, mot coupé en fin de ligne toujours recollé, titre du livre jamais pris pour un chapitre ; textes adaptés plus anciens refaits à l'ouverture s'ils sont encore vierges (sans fiche ni signet)
- [x] PDF 2 correctif (6.9.1) : pages blanches corrigées sur les téléphones à WebView ancienne (Chrome 119 à 124, Android 7 notamment : pages de hauteur nulle, recherche et texte adapté en panne) ; réglages de la visionneuse de pdf.js sur Android (polices standard et décodeurs d'images livrés avec l'app, dessin accéléré) ; texte des pages vérifié à l'ouverture, avec dessin de secours automatique et diagnostic dans le journal d'erreurs
- [x] PDF 2 (6.9) : les PDF se lisent tels quels, en pages originales comme dans une liseuse (visionneuse de pdf.js : défilement continu ou page par page, zoom à deux doigts et double appui, sommaire du PDF, signets de page, recherche surlignée, aller à la page, couleurs des pages selon le thème, texte sélectionnable, liens) ; le texte adapté (PDF 1) devient une option, à un geste, pour le surlignage, les fiches et la méthode ; les PDF scannés s'importent et se lisent
- [x] PDF 1 (6.8) : import des PDF numériques, convertis en livre (chapitres d'après les signets, les titres ou par tranches de pages ; paragraphes recollés, mots coupés réparés, en-têtes et numéros de page retirés, notes regroupées en fin de chapitre ; couverture, titre, auteur, langue) ; mot de passe demandé sans être gardé ; PDF scannés et protégés par DRM refusés avec une explication ; « Ouvrir avec » sur Android
- [x] Questions 2 et 3 (6.7) : idées centrales du chapitre et liens entre elles (8 relations), construits livre fermé et repris en fiches ; bilan de fin de livre (de quoi il parle vraiment, comparé à l'hypothèse de départ ; idées et liens du livre ; objectif atteint ; et maintenant) ; carte des idées du livre, partageable en texte
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
