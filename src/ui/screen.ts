export interface Screen {
  el: HTMLElement;
  /** Libère les ressources (URL d'objets, écouteurs globaux). */
  destroy(): void;
  /** Bouton retour d'Android : true si l'écran l'a traité lui-même (sinon retour à la bibliothèque). */
  onBack?(): boolean;
}

export type Route =
  | { name: 'library' }
  /** `cardId` : ouvre le livre au passage de cette fiche (depuis « Mes fiches »). */
  | { name: 'reader'; bookId: string; cardId?: string }
  /** `cardIds` : révision de ces fiches seulement, même si elles ne sont pas encore à revoir. */
  | { name: 'review'; cardIds?: string[]; back?: 'cards' }
  | { name: 'stats' }
  | { name: 'cards'; book?: string };

export type Navigate = (route: Route) => void;
