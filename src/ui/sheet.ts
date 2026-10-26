import { h } from './dom';
import { icon } from './icons';

export interface Sheet {
  el: HTMLDialogElement;
  body: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * Panneau modal (tiroir latéral, feuille du bas ou plein écran) basé sur <dialog> :
 * piège du focus, touche Échap et fond cliquable gérés par le navigateur.
 */
export function createSheet(options: { title: string; kind: 'side' | 'bottom' | 'full'; testId: string; header?: HTMLElement; onClose?: () => void }): Sheet {
  const body = h('div', { className: 'sheet-body' });
  const el = h('dialog', { className: `sheet sheet-${options.kind}`, 'aria-label': options.title, 'data-testid': options.testId },
    options.header ?? h('div', { className: 'sheet-head' },
      h('h2', {}, options.title),
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Fermer', onclick: () => el.close() }, icon('close')),
    ),
    body,
  );
  // Clic sur le fond (hors du contenu) : fermeture.
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  el.addEventListener('close', () => options.onClose?.());
  return {
    el,
    body,
    open() {
      if (!el.isConnected) document.body.append(el);
      if (!el.open) el.showModal();
    },
    close() {
      if (el.open) el.close();
    },
    get isOpen() {
      return el.open;
    },
  };
}
