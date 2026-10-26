# Signature release — V5.7

La clé privée n'est volontairement pas incluse dans le projet.

## 1. Créer une clé une seule fois

Exemple :

```bash
keytool -genkeypair -v \
  -keystore liseuse-release.jks \
  -alias liseuse-release \
  -keyalg RSA -keysize 2048 -validity 10000
```

Conserver `liseuse-release.jks` hors du dépôt et faire une sauvegarde sécurisée.

## 2. Fournir les secrets au build

Variables attendues :

- `RELEASE_STORE_FILE`
- `RELEASE_STORE_PASSWORD`
- `RELEASE_KEY_ALIAS`
- `RELEASE_KEY_PASSWORD`

Ou propriétés Gradle `-P...` équivalentes.

## 3. Générer le release

```bash
cd android
./gradlew assembleRelease
```

Si les quatre paramètres de signature sont fournis, le variant `release` est signé.
Sans eux, la configuration reste testable mais produit un artefact non signé.

## Version

- versionName : `5.7.0`
- versionCode : `57`

Ne jamais committer le `.jks`, les mots de passe ou un fichier de secrets.
