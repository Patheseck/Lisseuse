# Construire l'APK — Liseuse Mnémotechnique

Ce dossier est un projet Capacitor complet et fonctionnel, généré à partir du prototype web (lecteur EPUB/MD, fiches, palais, répétition espacée, bibliothèque). Il ne contient **pas** de SDK Android ni de `node_modules` (à régénérer chez toi).

## Prérequis (que tu as déjà via SECK 5D)
- Node.js + npm
- Android SDK + variable `ANDROID_HOME` configurée
- JDK 17+ (Capacitor 8 le demande)

## Étapes

```bash
# 1. Décompresser puis se placer dans le dossier
cd liseuse-app

# 2. Réinstaller les dépendances (Capacitor, JSZip)
npm install

# 3. Vérifier que tout est synchronisé (au cas où)
npx cap sync android

# 4a. Option Android Studio (le plus simple pour signer et déboguer)
npx cap open android
# → Build > Build Bundle(s) / APK(s) > Build APK(s)

# 4b. Option ligne de commande (APK de debug, non signé pour le Play Store)
cd android
./gradlew assembleDebug
# APK généré dans : android/app/build/outputs/apk/debug/app-debug.apk
```

## Ce qui a été préconfiguré
- `appId` : `com.patheseck.liseuse` (modifiable dans `capacitor.config.ts` puis `npx cap sync`)
- `appName` : "Liseuse Mnemotechnique"
- JSZip est servi en local (`www/jszip.min.js`), donc plus aucune dépendance réseau pour la lecture EPUB — fonctionne 100% hors-ligne
- IndexedDB (bibliothèque), localStorage (fiches, progression, table Mojor) fonctionnent nativement dans la WebView Capacitor, aucun changement nécessaire

## Ce qui reste à faire (à toi de trancher, pas bloquant pour un premier test)
- **Icône et splash screen** : Capacitor a mis les icônes par défaut. `npx cap` ne les génère pas automatiquement — il faut soit les remplacer manuellement dans `android/app/src/main/res/`, soit utiliser `@capacitor/assets` (package séparé) si tu veux automatiser.
- **Polices Google Fonts** : actuellement chargées via CDN (`fonts.googleapis.com`). Sans connexion, l'app bascule proprement sur les polices système (Georgia / sans-serif) — fonctionnel mais pas exactement le rendu prévu. Si tu veux du 100% offline visuel dès le premier lancement, il faudra héberger les fichiers de police en local (je peux le faire si tu veux).
- **Sélecteur de fichier natif** : le `<input type="file">` HTML fonctionne dans la WebView Capacitor (contrairement au navigateur in-app de Claude), mais un vrai plugin (`@capacitor/filesystem` + un picker) donnerait un accès plus fiable au stockage Android (Téléchargements, Google Drive, etc.). À voir après un premier test si le comportement actuel te suffit.
- **Permissions Android** : aucune permission spéciale n'est requise pour l'instant (tout est en local). Si tu ajoutes des notifications de révision plus tard, il faudra déclarer `POST_NOTIFICATIONS` (Android 13+) dans le manifeste.
## V5.7 — release Android

- `versionCode`: 57
- `versionName`: 5.7.0
- R8/minification + resource shrinking activés en release
- signature pilotée par variables d’environnement : voir `RELEASE-SIGNING.md`
- `POST_NOTIFICATIONS` déclaré pour Android 13+
- `INTERNET` retiré du manifeste
- intent-filter EPUB déclaré (`application/epub+zip`)

> Important : `POST_NOTIFICATIONS` ne rend pas les notifications fonctionnelles sans le plugin natif `@capacitor/local-notifications`. V5.7 prépare le manifeste sans ajouter une dépendance non synchronisée.

