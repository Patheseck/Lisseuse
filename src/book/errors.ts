/** Fichier refusé à l'import ; le message s'adresse à l'utilisateur. */
export class ImportError extends Error {}

/** Import abandonné par l'utilisateur (mot de passe non saisi) : rien d'autre à signaler. */
export class ImportCancelled extends Error {
  constructor() {
    super('Import annulé.');
  }
}

/** PDF dont les pages ne sont que des images (livre scanné) : aucun texte à lire. */
export class ScannedPdfError extends ImportError {
  constructor() {
    super('Ce PDF ne contient pas de texte : ses pages sont des images (livre scanné).');
  }
}
