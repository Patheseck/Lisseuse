# Liseuse mnémotechnique — V2 intégrée

## Améliorations intégrées

- Sécurisation du HTML importé depuis les EPUB : suppression des scripts, iframes, formulaires, gestionnaires `on*` et schémas `javascript:`.
- Identifiant de livre basé sur SHA-256 du fichier, avec solution de repli.
- Progression persistante au niveau chapitre + position de défilement exacte.
- Restauration de la position à la réouverture d'un livre.
- Recherche plein texte dans le livre.
- Lecture audio via Text-to-Speech Android/navigateur lorsqu'elle est disponible.
- Mode concentration sans en-tête/pied de page/outils.
- Bibliothèque enrichie avec recherche, progression et nombre de sections.
- Export complet des données en JSON.
- Import/restauration d'une sauvegarde JSON.
- Synchronisation de la version `www/` avec les assets Android Capacitor.

## Vérifications

- Syntaxe JavaScript vérifiée avec `node --check`.
- La compilation Gradle/APK n'a pas pu être exécutée dans l'environnement de travail car Gradle doit télécharger sa distribution depuis `services.gradle.org` et l'accès réseau de cet environnement est indisponible.

## Utilisation de la sauvegarde

Dans **Réglages** :

1. **Exporter mes données** crée un fichier `liseuse-sauvegarde-AAAA-MM-JJ.json`.
2. **Restaurer une sauvegarde** permet de réimporter les livres, fiches, progression, préférences et table Mojor.
