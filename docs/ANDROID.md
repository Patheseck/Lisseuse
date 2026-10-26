# Application Android

L'application Android est la même application web, empaquetée avec Capacitor (`android/`).
Identifiant : `com.patheseck.liseuse`. Elle fonctionne entièrement hors ligne (aucune
permission Internet).

## Installer la version de test

À chaque envoi sur GitHub, la CI construit un APK de test :

1. Onglet **Actions** du dépôt → dernière exécution verte de **CI**.
2. En bas de la page, **Artifacts** → `liseuse-test-apk` (fichier zip contenant `app-debug.apk`).
3. Copie l'APK sur le téléphone et ouvre-le. Android demande d'autoriser l'installation
   d'applications de cette source : accepte pour ton gestionnaire de fichiers ou ton navigateur.

La version de test s'appelle **« Liseuse (test) »** et s'installe **à côté** de la version
publiée (identifiant `com.patheseck.liseuse.debug`) : tester ne touche jamais à tes vraies données.

## Créer ta clé de signature (une seule fois)

La clé prouve à Android que les mises à jour viennent bien de toi. **Si tu la perds, tu ne
pourras plus mettre l'application à jour** (il faudrait désinstaller, donc exporter puis
restaurer tes données). Garde le fichier et les mots de passe dans un endroit sûr
(gestionnaire de mots de passe + copie hors du téléphone).

Avec Java installé (Android Studio l'inclut) :

```bash
keytool -genkeypair -v -keystore liseuse.jks -alias liseuse -keyalg RSA -keysize 4096 -validity 10000
```

Puis encode-la pour GitHub :

```bash
base64 -w0 liseuse.jks > liseuse.jks.b64     # macOS : base64 -i liseuse.jks -o liseuse.jks.b64
```

## Ajouter la clé à GitHub

Dépôt → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**,
quatre secrets :

| Nom | Valeur |
|---|---|
| `LISEUSE_KEYSTORE_BASE64` | le contenu de `liseuse.jks.b64` |
| `LISEUSE_KEYSTORE_PASSWORD` | le mot de passe du fichier |
| `LISEUSE_KEY_ALIAS` | `liseuse` |
| `LISEUSE_KEY_PASSWORD` | le mot de passe de la clé (souvent le même) |

Dès lors, chaque exécution de la CI produit aussi `liseuse-apk-signe` : c'est la version
à installer au quotidien (« Liseuse »). Les suivantes s'installeront par-dessus, données conservées.

## Construire sur son ordinateur

Prérequis : Node.js 22, JDK 21, Android SDK (Android Studio ou outils en ligne de commande).

```bash
npm install
npm run android:debug          # → android/app/build/outputs/apk/debug/app-debug.apk
# Version signée :
LISEUSE_KEYSTORE_FILE=/chemin/liseuse.jks LISEUSE_KEYSTORE_PASSWORD=… \
LISEUSE_KEY_ALIAS=liseuse LISEUSE_KEY_PASSWORD=… npm run android:release
```

Pour ouvrir le projet dans Android Studio : `npm run android:sync` puis `npx cap open android`.

## Fonctions propres à Android

| Fonction | Fonctionnement |
|---|---|
| Ouvrir un EPUB depuis un gestionnaire de fichiers | « Ouvrir avec → Liseuse » importe le livre et l'ouvre |
| Exporter une sauvegarde | menu de partage d'Android (Drive, e-mail, Fichiers…) |
| Écouter un chapitre | synthèse vocale du téléphone, à partir du paragraphe visible |
| Rappel quotidien | notification locale à l'heure choisie (Ma mémoire → Réglages) |
| Bouton retour | ferme le panneau ouvert, puis revient à la bibliothèque |

## Note technique : CSP et Capacitor

Capacitor insère son script de liaison, en ligne, juste après `<head>`. La politique de
sécurité (CSP) de `index.html` est déclarée ensuite ; or une CSP en `<meta>` ne s'applique
qu'aux éléments qui la suivent : le script de Capacitor s'exécute, tout autre script en ligne
reste interdit. Le test `tests/e2e/android-shell.spec.ts` vérifie ce comportement.
