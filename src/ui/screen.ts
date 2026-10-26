export interface Screen {
  el: HTMLElement;
  /** Libère les ressources (URL d'objets, écouteurs globaux). */
  destroy(): void;
  /** Bouton retour d'Android : true si l'écran l'a traité lui-même (sinon retour à la bibliothèque). */
  onBack?(): boolean;
}

export type Route = { name: 'library' } | { name: 'reader'; bookId: string } | { name: 'review' } | { name: 'stats' };

export type Navigate = (route: Route) => void;
