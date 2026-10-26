export interface Screen {
  el: HTMLElement;
  /** Libère les ressources (URL d'objets, écouteurs globaux). */
  destroy(): void;
}

export type Route = { name: 'library' } | { name: 'reader'; bookId: string } | { name: 'review' };

export type Navigate = (route: Route) => void;
