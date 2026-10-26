# Liseuse mnémotechnique

Liseuse EPUB / Markdown hors ligne pour apprendre en lisant : fiches question-réponse,
répétition espacée (FSRS-6), rappel actif et aide-mémoire (palais mental, table Mojor).
Application Android via Capacitor.

- Cahier des charges : [docs/CAHIER-DES-CHARGES-V6.md](docs/CAHIER-DES-CHARGES-V6.md)
- Fondements scientifiques : [docs/RECHERCHE.md](docs/RECHERCHE.md)
- `legacy/v5.7/` : version d'origine, conservée comme référence (bugs connus, ne pas modifier).

## Avancement V6

- [x] Étape 1 — Socle : Vite + TypeScript, IndexedDB, bibliothèque, import EPUB/Markdown, lecteur minimal, tests, CI
- [x] Étape 2 — Lecteur complet (sommaire, recherche, réglages, surlignage, mode concentration)
- [ ] Étape 3 — Fiches et révision FSRS
- [ ] Étape 4 — Migration V5.7 et sauvegarde
- [ ] Étape 5 — Rappel de fin de chapitre, pré-questions, mnémotechnique, tableau de bord
- [ ] Étape 6 — Android natif et APK

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
src/book/      analyse EPUB et Markdown, nettoyage HTML (DOMPurify)
src/reader/    logique du lecteur : ancrage des surlignages, recherche
src/storage/   base IndexedDB (livres, chapitres, progression, surlignages, réglages)
src/ui/        écrans (bibliothèque, lecteur) et composants
src/styles/    jetons de design (thème clair/sombre) et styles par écran
tests/unit/    tests Vitest
tests/e2e/     parcours Playwright
```
