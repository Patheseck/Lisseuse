# Liseuse Mnémotechnique — V4.0

## Consolidation performance / robustesse

### Intégré
- JSZip chargé à la demande lors de l'ouverture d'un EPUB (lazy-load).
- Images EPUB converties en Blob URL au lieu de data URI Base64.
- Stockage IndexedDB privilégiant le fichier source EPUB/Markdown brut ; les chapitres HTML restent utilisés comme compatibilité pour les anciennes entrées sans fichier source.
- Couverture EPUB extraite depuis l'OPF lorsqu'elle est déclarée.
- Recherche avec debounce de 180 ms.
- TreeWalker borné pour les recherches/surlignages afin d'éviter les parcours DOM pathologiques.
- Journal d'erreurs local avec bouton Diagnostics.
- `formatVersion: 4` dans les sauvegardes, avec lecture rétrocompatible des anciens champs `version`.
- Export JSON standard et export JSON chiffré optionnel (AES-GCM + PBKDF2-SHA256).
- Réglages de lecture : police serif/sans-serif, interligne, marges.
- Mode de lecture continu / pages.
- `prefers-reduced-motion` respecté.
- ARIA sur les fenêtres de recherche et tableau de bord, avec `aria-live` pour les résultats.
- Préparation d'une API de notification locale : utilise `Capacitor.Plugins.LocalNotifications` lorsqu'un plugin natif est présent, sans casser le fonctionnement offline si le plugin n'est pas installé.

### Sécurité
- Sanitisation défensive conservée et renforcée.
- IMPORTANT : DOMPurify n'a pas été ajouté comme dépendance externe dans cette archive car l'environnement de construction n'a pas d'accès réseau et aucun bundle local DOMPurify fiable n'était disponible. La V4 conserve donc le sanitizer local ; pour la release de production, intégrer une copie locale versionnée de DOMPurify avant distribution.

### FSRS
- Le moteur FSRS-6 compatible de la V3 reste utilisé et est isolé comme moteur de révision. La V4 n'ajoute pas `ts-fsrs` automatiquement, car son paquet ne pouvait pas être téléchargé dans l'environnement de construction hors ligne. Les données exportées indiquent `reviewEngine: FSRS-6-compatible`.

### Non intégré nativement dans cette archive
- `@capacitor/local-notifications` comme dépendance npm : nécessite l'installation du plugin et une régénération Capacitor/Gradle dans un environnement avec accès aux paquets.
- `ts-fsrs` : nécessite le bundle npm officiel pour remplacer proprement l'implémentation FSRS existante.

## Compatibilité
- Les anciennes bibliothèques avec identifiant legacy et les sauvegardes précédentes restent prises en charge.
- Le stockage brut devient progressivement la source de vérité pour les nouveaux imports.
