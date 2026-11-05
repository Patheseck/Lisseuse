export interface Screen {
  el: HTMLElement;
  /** Libère les ressources (URL d'objets, écouteurs globaux). */
  destroy(): void;
  /** Bouton retour d'Android : true si l'écran l'a traité lui-même (sinon retour à la bibliothèque). */
  onBack?(): boolean;
}

export type Route =
  | { name: 'library' }
  /**
   * `cardId` : ouvre le livre au passage de cette fiche (depuis « Mes fiches »).
   * `view` : pour un PDF, pages originales ou texte adapté (sinon le choix enregistré du livre).
   */
  | { name: 'reader'; bookId: string; cardId?: string; view?: 'pages' | 'text' }
  /** `cardIds` : révision de ces fiches seulement, même si elles ne sont pas encore à revoir. */
  | { name: 'review'; cardIds?: string[]; back?: 'cards' }
  | { name: 'stats' }
  | { name: 'cards'; book?: string };

export type Navigate = (route: Route) => void;
