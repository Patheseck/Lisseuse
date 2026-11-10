# Liseuse V6 — Cahier des charges

Reconstruction complète de la V5.7 (`legacy/v5.7`). Objectif : **une liseuse
d'apprentissage hors ligne, simple, fiable, fondée sur la recherche** (voir
[RECHERCHE.md](RECHERCHE.md)). Aucune donnée d'utilisateur V5.7 ne doit être perdue.

## 1. Principes

1. **Fiabilité avant fonctionnalités.** Aucune version ne sort si un parcours essentiel
   échoue en test automatique.
2. **Hors ligne, sans compte, sans serveur.** Aucune requête réseau applicative.
3. **L'utilisateur génère, l'app planifie.** Il écrit ses questions et ses réponses ; l'app
   choisit le bon moment pour les lui reposer.
4. **Moins d'écrans, chacun complet.** Une fonction à moitié faite est retirée.

## 2. Fonctions

### 2.1 Conservées (refaites proprement)

| Domaine | Fonction |
|---|---|
| Lecture | Import EPUB 2/3 et Markdown, table des matières, reprise à la position exacte, recherche dans le livre, thème auto/clair/sombre, taille, police, interligne, marges, plein écran immersif |
| Bibliothèque | Liste avec couverture, progression réelle (%), recherche, suppression (avec nettoyage complet des données liées) |
| Fiches | Créées depuis une sélection, surlignage persistant (y compris sélection sur plusieurs éléments), édition, suppression |
| Révision | FSRS-6 (ts-fsrs), rappel écrit/dicté avant correction, 4 boutons Encore / Difficile / Bien / Facile |
| Mnémotechnique | Table Mojor (import JSON), association image/lieu/action optionnelle sur une fiche, coach d'encodage |
| Données | Sauvegarde / restauration **par fusion**, avec option « inclure les livres » ; chiffrement optionnel (AES-GCM) ; sur Android, sauvegarde automatique dans un fichier choisi une fois dans Google Drive (sélecteur de documents d'Android, sans API Google ni permission Internet), refaite en quittant l'app si les données ont changé (sans les fichiers des livres), et restauration depuis Drive |
| Accessibilité | Lecture audio (synthèse vocale native), navigation clavier, contrastes AA |

### 2.2 Ajoutées (fondées sur la recherche)

| Fonction | Principe |
|---|---|
| Fiche **question → réponse** avec modèles (« Pourquoi… ? », « Quelle différence… ? », « Quelles étapes… ? ») | Récupération + génération |
| **Confiance** avant la correction, alerte sur erreur à forte confiance | Hypercorrection, métacognition |
| **Réapprentissage dans la séance** pour les fiches ratées | Réapprentissage successif |
| File de révision **entrelacée** (livres et chapitres mélangés) | Entrelacement |
| **Aperçu du chapitre** (intertitres, gras, italique, listes, figures) puis **question directrice**, rappelée en haut pendant la lecture | Pré-questions, lecture orientée par un but (méthode SQ3R, « Lire ») |
| **Restitution de fin de chapitre** (minuteur 3 min) : réponse à la question, idée principale en une phrase, arguments, explication avec ses mots | Récupération après lecture, auto-explication (« Poser ») |
| **Tri des idées en 3 niveaux** (retrouvé / revenu en relisant / mal compris) : fiches proposées, fiches « mal comprises » remontées en révision, liste « À approfondir » ; fiche automatique « question directrice → idée principale » | Repérage des lacunes, illusion de compétence (« Récupérer ») |
| **Chapitres choisis** pour son objectif : la progression ne compte qu'eux | Lecture sélective guidée par un but |
| **Objectif du livre** (de quoi il parle, pourquoi le lire, type d'objectif, « je serai capable de… », ce que je sais déjà), relié aux questions des chapitres, à la restitution et aux fiches | But de lecture, utilité personnelle, K-W-L, intentions de mise en œuvre |
| **Mes fiches** : toutes les fiches hors des livres (recherche, filtres, tris), détail et historique, pause, révision immédiate, remise à zéro | Pratique de récupération à la demande ; la pause retire une fiche sans perdre son historique |
| **PDF en pages originales** (par défaut) : pages telles qu'imprimées, défilement continu ou page par page, zoom, sommaire du PDF, signets, recherche surlignée, couleurs du thème ; bascule vers le texte adapté ; texte des pages vérifié à l'ouverture (dessin de secours automatique si la WebView ne le dessine pas) | Comme dans toute liseuse : la mise en page d'origine (tableaux, schémas, formules) reste intacte |
| **PDF numériques** convertis en livre (option « texte adapté ») (chapitres d'après les signets, les titres ou des tranches de pages ; paragraphes recollés, mots coupés réparés, vers gardés, en-têtes, numéros de page et notes sortis du texte) ; **livres scannés** dont le texte vient d'un OCR : signalés, bruit des illustrations retiré, tailles irrégulières tolérées : toutes les fonctions du lecteur et de la méthode s'y appliquent | Beaucoup de livres n'existent qu'en PDF ; un texte qui se réagence se lit sur téléphone sans zoomer |
| **Idées centrales et liens** : à la restitution, une idée par ligne, puis les relier (entraîne, découle de, s'oppose à, est un exemple de, est nécessaire à, précède, fait partie de, ressemble à), livre fermé ; fiches « idées centrales » et « lien » | Cartes de concepts construites par l'apprenant, de mémoire (carte « par récupération ») |
| **Bilan du livre** en fin de lecture (de quoi il parle vraiment, comparé à l'hypothèse ; idées et liens du livre ; objectif atteint ; et maintenant) et **carte des idées** (le livre puis chaque chapitre), partageable | Le « ce que j'ai appris » de K-W-L ; vue d'ensemble pour relier les chapitres |
| **Pré-questions** en rouvrant un chapitre qui a des fiches | Pré-test |
| **Rappel quotidien** à heure choisie (notification locale) | Espacement, habitude |
| Fiche **séquence** : étapes à remettre dans l'ordre, option palais mental | Méthode des lieux |
| Limite de **nouvelles fiches par jour** (réglable, 20 par défaut) | Charge de révision soutenable |

### 2.3 Retirées

Valeur d'apprentissage /100, classement automatique des passages, « compréhension
prouvée » par similarité de mots, suggestions automatiques TextRank, mode professeur
séparé (fusionné dans la révision), mode « Pages » non fonctionnel. Justifications dans
RECHERCHE.md.

### 2.4 Tableau de bord (4 indicateurs au lieu de 10+)

1. **À réviser aujourd'hui** (+ prévision des 7 prochains jours)
2. **Rétention réelle** : % de « Bien/Facile » sur les révisions espacées, comparé à la
   cible FSRS (90 %)
3. **Calibration** : réussite réelle selon la confiance annoncée
4. **Régularité** : jours actifs sur les 30 derniers jours (pas de « série » punitive)

## 3. Architecture

```
src/
  main.ts                 démarrage, routage entre écrans
  core/                   logique pure, sans DOM — testée unitairement
    scheduler.ts          enveloppe ts-fsrs (paramètres, file entrelacée, réapprentissage)
    cards.ts              modèle de fiche, validation
    stats.ts              rétention, calibration, régularité
    mnemonic.ts           table Mojor, coach d'encodage
  book/
    epub.ts               lecture EPUB (JSZip), TOC NAV/NCX, couverture
    markdown.ts           Markdown → HTML
    sanitize.ts           DOMPurify (inclus dans l'app, pas de CDN)
    highlight.ts          ancrage des surlignages (texte + contexte, multi-nœuds)
  storage/
    db.ts                 IndexedDB unique (livres, chapitres en cache, fiches, journal, réglages)
    migrate-v5.ts         import des données V5.7 (localStorage + liseuse-db v2)
    backup.ts             export / restauration par fusion, chiffrement
  native/                 Capacitor, avec repli navigateur
    share.ts              export de fichier (Filesystem + Share)
    tts.ts                synthèse vocale
    notify.ts             rappel quotidien
    open-file.ts          ouverture d'un EPUB depuis le gestionnaire de fichiers
  ui/                     un module par écran
    library.ts  reader.ts  card-editor.ts  review.ts  chapter-recall.ts  dashboard.ts  settings.ts
  styles/                 tokens.css + un fichier par écran
tests/
  unit/                   Vitest (core, book, storage)
  e2e/                    Playwright : parcours complets
  fixtures/               EPUB 2, EPUB 3, Markdown, export V5.7
android/                  projet Capacitor (régénéré, appId inchangé)
```

**Outils :** Vite + TypeScript strict, sans framework d'interface (application légère,
démarrage rapide). Dépendances d'exécution limitées à : `ts-fsrs`, `jszip`, `dompurify`,
plugins Capacitor officiels (`filesystem`, `share`, `local-notifications`) et
`@capacitor-community/text-to-speech`.

## 4. Données

Une seule base IndexedDB `liseuse` (fin de `localStorage` pour les données importantes) :

| Magasin | Contenu |
|---|---|
| `books` | id (SHA-256), titre, format, fichier original, couverture, nombre de chapitres, dates |
| `chapters` | cache des chapitres analysés (ouverture rapide, supprimable) |
| `cards` | id, bookId, chapitre, passage, ancre de surlignage, type, question, réponse, étapes, aide-mémoire, état FSRS, dates |
| `reviews` | journal : fiche, date, note, confiance, durée, réponse écrite, état FSRS avant/après |
| `progress` | bookId → chapitre, position, pourcentage |
| `settings` | préférences de lecture, rappel, table Mojor ; `auto-backup` (fichier de la sauvegarde automatique, mot de passe éventuel) reste propre à l'appareil : jamais exporté, jamais remplacé par une restauration |

Chaque enregistrement porte un `schemaVersion` ; les migrations sont testées.

### Migration V5.7 → V6 (automatique au premier lancement)

L'**appId `com.patheseck.liseuse` est conservé** : la V6 retrouve le même stockage de la
WebView et lit les données V5.7 sur place.

| V5.7 | V6 |
|---|---|
| `liseuse-db` v2 / `books` | `books` (+ calcul du nombre de chapitres) |
| `liseuse:cards:<id>` | `cards` : passage = `text` ; réponse = `reformulation` sinon `text` ; question générée selon le mode (« Quelle est l'idée de ce passage ? », « Quelles sont les étapes… ? ») et marquée « à reformuler » ; association Mojor conservée |
| `review.fsrs` (stabilité, difficulté, échéance, reps, lapses) | état ts-fsrs équivalent (state = Review si reps > 0) |
| `liseuse:review-log` | `reviews` |
| `liseuse:progress`, `liseuse:prefs`, `liseuse:mojor` | `progress`, `settings` |

Les données V5 d'origine ne sont **jamais modifiées ni supprimées** par la migration : elles
restent sur l'appareil comme filet de sécurité. Une sauvegarde V5 (chiffrée ou non) peut aussi
être restaurée depuis « Mes données ».

## 5. Qualité

- **Unitaires (Vitest)** : planification (cas limites FSRS), migration V5.7 sur un export
  réel, sauvegarde/restauration par fusion, Markdown, nettoyage HTML (vecteurs XSS),
  ancrage des surlignages.
- **Parcours (Playwright)**, bloquants avant chaque version :
  1. démarrage sans erreur console ;
  2. import EPUB → lecture → chapitre suivant → reprise après rechargement ;
  3. sélection → fiche → révision → note → échéance future ;
  4. sauvegarde → restauration → livres et fiches intacts ;
  5. migration d'un profil V5.7 réel.
- **CI GitHub Actions** : lint, types, tests, build web, build APK debug.

## 6. Étapes

| Étape | Contenu | Livrable |
|---|---|---|
| 1 | Socle : Vite + TS, CI, tokens de design, écran bibliothèque + import, tests de démarrage | App qui démarre et importe |
| 2 | Lecteur complet (TOC, reprise, recherche, réglages, surlignage) | Lecture au niveau V5.7, sans les bugs |
| 3 | Fiches + révision FSRS + confiance + réapprentissage | Cœur de l'apprentissage |
| 4 | Stockage unifié + migration V5.7 + sauvegarde par fusion | Données sûres |
| 5 | Rappel de fin de chapitre, pré-questions, mnémotechnique, tableau de bord | Fonctions fondées sur la recherche |
| 6 | Natif Android : partage, synthèse vocale, notifications, ouverture d'EPUB ; APK signé | V6.0.0 |
