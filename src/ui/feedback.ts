import { h } from './dom';

let toastRegion: HTMLElement | null = null;

/** Message bref non bloquant (remplace les alert() de la V5). */
export function toast(message: string, kind: 'info' | 'error' = 'info', durationMs = 4000): void {
  if (!toastRegion) {
    toastRegion = h('div', { className: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const item = h('div', { className: `toast toast-${kind}`, 'data-testid': 'toast' }, message);
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), durationMs);
}

/** Boîte de confirmation accessible, basée sur <dialog>. */
export function confirmDialog(options: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const cancel = h('button', { type: 'button', className: 'btn', value: 'cancel' }, 'Annuler');
    const ok = h('button', { type: 'button', className: options.danger ? 'btn btn-danger' : 'btn btn-primary', value: 'ok' }, options.confirmLabel);
    const dialog = h(
      'dialog',
      { className: 'dialog', 'aria-labelledby': 'dialog-title' },
      h('h2', { id: 'dialog-title' }, options.title),
      h('p', {}, options.message),
      h('div', { className: 'dialog-actions' }, cancel, ok),
    );
    const finish = (result: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

let busyEl: HTMLElement | null = null;

/** Écran d'attente pendant une opération longue (import, ouverture). */
export async function withBusy<T>(message: string, fn: () => Promise<T>): Promise<T> {
  busyEl ??= h('div', { className: 'busy', role: 'alert', 'aria-busy': 'true' });
  busyEl.textContent = message;
  document.body.append(busyEl);
  try {
    return await fn();
  } finally {
    busyEl.remove();
  }
}
