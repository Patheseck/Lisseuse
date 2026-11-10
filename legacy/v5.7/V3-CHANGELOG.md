# Liseuse Mnémotechnique — V3

## Moteur de mémorisation
- Remplacement de SM-2 par une implémentation locale **FSRS-6** (21 paramètres par défaut).
- Rétention cible : 90 %.
- États mémoriels : stabilité, difficulté, récupérabilité, répétitions et oublis.
- Migration automatique des anciennes fiches SM-2 vers un état FSRS approximatif tout en conservant leur échéance existante.
- Historique des révisions conservé localement (`liseuse:review-log`).

## Révision active
- Quatre évaluations : Encore / Difficile / Bien / Facile.
- Affichage de la prochaine échéance calculée par FSRS.
- Lecture audio du parcours mnémotechnique via SpeechSynthesis lorsque disponible.
- Trois modes : Concept, Séquence, Verbatim.
- Champ de reformulation personnelle recommandé pour le mode Concept.

## Suggestions
- Remplacement de l’heuristique chiffres/majuscules par un **TextRank hybride** local, combiné à des indices pédagogiques (dates, définitions, principes, etc.).

## Tableau de bord
- Taux de rappel global et par livre.
- Fiches maîtrisées / fragiles.
- Fiches dues.
- Série de jours actifs.
- Historique récent des révisions.

## Données
- Export JSON version 3 incluant l’historique FSRS.
- Import compatible avec les sauvegardes précédentes.
- Fonctionnement offline-first, sans dépendance réseau pour le moteur FSRS/TextRank.

## Vérification
- Syntaxe JavaScript vérifiée avec `node --check`.
- Asset Android synchronisé avec `www/index.html`.


## V3.1 — Compatibilité des anciens identifiants
- Migration automatique des anciens IDs `nom+taille` vers le nouvel ID SHA-256 lors d'une réimportation.
- Prise en charge du format intermédiaire `nom+taille+lastModified`.
- Migration des fiches, de la progression et de l'historique de révision associés.
- Fusion sans doublons si le livre SHA-256 existe déjà.
- Suppression du code mort dans `saveProgress`.
