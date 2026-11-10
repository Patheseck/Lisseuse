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

Dès lors, chaque exécution de la CI produit aussi :

- `liseuse-apk-signe` : la version à installer au quotidien (« Liseuse »). Les suivantes
  s'installeront par-dessus, données conservées ;
- `liseuse-aab-signe` : le même programme au format **Android App Bundle** (`.aab`), le seul
  accepté par Google Play pour une publication.

## Numéro de version

La version vient uniquement de `package.json` (`"version": "6.3.0"`) : Android en déduit
`versionName` (6.3.0) et `versionCode` (60300 = majeure × 10 000 + mineure × 100 + correctif).
Pour publier une nouvelle version, il suffit d'augmenter ce numéro ; « À propos » l'affiche aussi.

## Construire sur son ordinateur

Prérequis : Node.js 22, JDK 21, Android SDK (Android Studio ou outils en ligne de commande).

```bash
npm install
npm run android:debug          # → android/app/build/outputs/apk/debug/app-debug.apk
# Version signée :
LISEUSE_KEYSTORE_FILE=/chemin/liseuse.jks LISEUSE_KEYSTORE_PASSWORD=… \
LISEUSE_KEY_ALIAS=liseuse LISEUSE_KEY_PASSWORD=… npm run android:release
# Format Google Play (.aab), mêmes variables :
cd android && ./gradlew bundleRelease    # → android/app/build/outputs/bundle/release/app-release.aab
```

Pour ouvrir le projet dans Android Studio : `npm run android:sync` puis `npx cap open android`.

## Fonctions propres à Android

| Fonction | Fonctionnement |
|---|---|
| Ouvrir un livre depuis un gestionnaire de fichiers | « Ouvrir avec → Liseuse » importe le livre et l'ouvre (EPUB, PDF, Markdown, texte, y compris les fichiers reçus sans type précis ; un livre protégé par DRM ou un PDF scanné est refusé avec une explication) |
| Livres PDF | lus en pages originales (visionneuse de pdf.js, sur le téléphone, sans Internet) : zoom à deux doigts, page par page ou défilement, touches de volume ; en option, « texte adapté » (le PDF converti en livre) ; un PDF protégé par mot de passe le demande à chaque ouverture, sans le garder. Demande une WebView Android de version 119 au moins (celle d'Android 7 à jour) ; voir « Note technique : PDF » |
| Sauvegarde automatique sur Google Drive | « Mes données » : un fichier choisi une fois dans le sélecteur d'Android (☰ → Drive → dossier → Enregistrer), réécrit en quittant l'app si quelque chose a changé (au plus toutes les 2 min) : fiches, révisions, progression, notes, réglages et liste des livres, sans les fichiers des livres ; chiffrement en option ; « Restaurer une sauvegarde de Google Drive » sur un nouveau téléphone, qui peut ensuite continuer dans le même fichier. Voir « Note technique : sauvegarde Google Drive » |
| Exporter une sauvegarde | menu de partage d'Android (Drive, e-mail, Fichiers…) |
| Écouter un chapitre | synthèse vocale du téléphone, à partir du paragraphe visible |
| Rappel quotidien | notification locale à l'heure choisie (Ma mémoire → Réglages) |
| Bouton retour | ferme le panneau ouvert, puis revient à la bibliothèque |
| Touches de volume | tournent les pages pendant la lecture (désactivable dans « Aa ») |
| Écran toujours allumé | pendant la lecture uniquement (désactivable dans « Aa ») |
| Plein écran | les barres d'Android se masquent avec les menus ; un glisser depuis le bord les fait réapparaître |
| Vibration | légère, au passage d'un chapitre à l'autre |
| Sélection de texte | le menu d'Android est remplacé par celui de l'app (Surligner, Fiche, Copier, Partager, Rechercher) ; il reste actif dans les champs de saisie |
| Copier un passage | presse-papiers d'Android (module officiel Capacitor) |
| Barres système | icônes claires sur un thème sombre ; fond de fenêtre de la couleur du thème |
| Lecture à voix haute | dans la langue du livre (déclarée par l'EPUB, ou devinée pour un texte) |
| Musique d'ambiance | bouton ♪ : une ambiance par livre (16 au choix), avec tes MP3 ; s'arrête quand l'écran s'éteint ou qu'on quitte le livre, et reprend au retour là où elle en était (même morceau, même seconde, même après un redémarrage de l'app) |

## Note technique : PDF

- La visionneuse de pdf.js est réglée comme sur Android chez Firefox : polices standard des PDF
  (Times, Helvetica…) livrées avec l'app plutôt que celles du système, décodeurs d'images JPEG 2000
  et JBIG2 (livres numérisés) livrés aussi (`pdfjs/` dans l'app, voir `vite.config.ts`), dessin
  accéléré par le processeur graphique.
- WebView de Chrome 119 à 124 (Android 7 en reste à 119) : pdf.js dimensionne les pages avec la
  fonction CSS `round()` (Chrome 125) ; sans elle, les pages auraient une hauteur nulle (écran
  blanc). La construction remplace l'arrondi par un simple calcul là où il manque, et l'app ajoute
  le parcours de flux `for await` (Chrome 124) dont pdf.js a besoin pour lire le texte des pages.
  En dessous de Chrome 119, pdf.js ne fonctionne pas (son worker utilise `Promise.withResolvers`).
- À l'ouverture d'un PDF, la première page de texte est vérifiée : si ses lettres ne sont pas
  dessinées, le PDF est rouvert en dessin de secours (lettres tracées une à une, sans police chargée
  ni accélération graphique), gardé pour les PDF suivants jusqu'à la prochaine version. L'incident,
  une page non dessinée ou un dessin bloqué, est noté au journal d'erreurs (« Mes données ») avec la
  version de la WebView, pour le diagnostic.

## Note technique : sauvegarde Google Drive

- Pas d'API Google ni de compte à relier : le fichier est créé avec le sélecteur de documents
  d'Android (`ACTION_CREATE_DOCUMENT`, ou `ACTION_OPEN_DOCUMENT` pour reprendre une sauvegarde
  existante), et l'app garde le droit d'y écrire (`takePersistableUriPermission`). C'est le
  fournisseur de documents de l'app Google Drive qui envoie le fichier en ligne : Liseuse reste
  sans permission Internet. Tout emplacement du sélecteur qui accepte l'écriture durable convient
  (Drive, stockage du téléphone, autre cloud).
- Code : `android/app/src/main/java/…/BackupFilePlugin.java` (sélecteur, droits, écriture en
  remplaçant le contenu, mode `wt`), `src/native/backup-file.ts`, `src/storage/auto-backup.ts`
  (quand sauvegarder), `src/ui/auto-backup-section.ts` (« Mes données »).
- La sauvegarde est préparée dans le cache de l'app puis copiée dans le fichier par un fil
  d'exécution à part. Elle part quand l'app passe en arrière-plan (et 15 s après son ouverture,
  pour rattraper une sortie brutale), seulement si les données ont changé (empreinte SHA-256), au
  plus toutes les deux minutes.
- Les fichiers des livres n'en font pas partie : une bibliothèque de plusieurs centaines de Mo,
  passée en mémoire et envoyée en arrière-plan à chaque fois, ferait fermer l'app par Android et
  consommerait les données mobiles. La liste des livres y est, y compris ceux d'une restauration
  pas encore réimportés : en les réimportant, on retrouve leurs fiches. L'export manuel, lui, peut
  inclure les livres.
- Après une restauration depuis Drive, la sauvegarde automatique reprend dans le même fichier,
  avec le même mot de passe ; si le fichier restauré est un export complet (avec les livres), il est
  gardé tel quel et la suite va dans un nouveau fichier.
- Le réglage (adresse du fichier, mot de passe éventuel) est propre à l'appareil : il n'est jamais
  exporté et une restauration ne le remplace pas. Si le fichier est supprimé ou ses droits retirés,
  la sauvegarde automatique s'arrête et « Mes données » demande de choisir de nouveau l'emplacement.
- À vérifier sur un vrai téléphone (l'émulateur de test n'a pas l'app Google Drive) : création du
  fichier dans Drive, réécriture après une lecture, restauration sur un autre appareil.

## Note technique : CSP et Capacitor

Capacitor insère son script de liaison, en ligne, juste après `<head>`. La politique de
sécurité (CSP) de `index.html` est déclarée ensuite ; or une CSP en `<meta>` ne s'applique
qu'aux éléments qui la suivent : le script de Capacitor s'exécute, tout autre script en ligne
reste interdit. Le test `tests/e2e/android-shell.spec.ts` vérifie ce comportement.
