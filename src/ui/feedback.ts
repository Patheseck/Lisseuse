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

/** Avancement affiché sous le message d'attente (0 à 1), avec un nouveau message au besoin. */
export type BusyUpdate = (progress: number, message?: string) => void;

/**
 * Écran d'attente pendant une opération longue (import, ouverture). Le message est annoncé une
 * fois ; l'avancement (barre et détail) se met à jour sans être relu à chaque étape.
 */
export async function withBusy<T>(message: string, fn: (update: BusyUpdate) => Promise<T>): Promise<T> {
  const detail = h('p', { className: 'busy-detail', 'aria-hidden': 'true', 'data-testid': 'busy-detail' });
  const bar = h('progress', { className: 'busy-progress', max: 1, value: 0, hidden: true, 'aria-label': message, 'data-testid': 'busy-progress' });
  busyEl ??= h('div', { className: 'busy', role: 'alert', 'aria-busy': 'true', 'data-testid': 'busy' });
  busyEl.replaceChildren(h('div', { className: 'busy-box' }, h('p', { className: 'busy-text' }, message), bar, detail));
  document.body.append(busyEl);
  const update: BusyUpdate = (progress, next) => {
    bar.hidden = false;
    bar.value = Math.min(1, Math.max(0, progress));
    if (next && detail.textContent !== next) detail.textContent = next;
  };
  try {
    return await fn(update);
  } finally {
    busyEl.remove();
  }
}

/**
 * Demande un mot de passe. Avec `confirm`, le fait saisir deux fois (création d'une sauvegarde chiffrée).
 * Résout avec le mot de passe, ou null si l'utilisateur annule.
 */
export function passwordDialog(options: { title: string; message: string; confirm?: boolean; confirmLabel: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const first = h('input', { type: 'password', className: 'input', autocomplete: options.confirm ? 'new-password' : 'current-password', 'aria-label': 'Mot de passe', placeholder: 'Mot de passe', 'data-testid': 'password' });
    const second = h('input', { type: 'password', className: 'input', autocomplete: 'new-password', 'aria-label': 'Confirme le mot de passe', placeholder: 'Confirme le mot de passe', 'data-testid': 'password-confirm' });
    const error = h('p', { className: 'form-error', role: 'alert', hidden: true });
    const cancel = h('button', { type: 'button', className: 'btn' }, 'Annuler');
    const ok = h('button', { type: 'submit', className: 'btn btn-primary', 'data-testid': 'password-ok' }, options.confirmLabel);
    const form = h('form', { className: 'dialog-form' },
      h('h2', { id: 'dialog-title' }, options.title),
      h('p', {}, options.message),
      first,
      options.confirm ? second : null,
      error,
      h('div', { className: 'dialog-actions' }, cancel, ok),
    );
    const dialog = h('dialog', { className: 'dialog', 'aria-labelledby': 'dialog-title' }, form);
    const finish = (value: string | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const problem = first.value.length < 8 && options.confirm ? 'Choisis au moins 8 caractères.' : !first.value ? 'Saisis le mot de passe.' : options.confirm && first.value !== second.value ? 'Les deux mots de passe sont différents.' : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      finish(first.value);
    });
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();
    first.focus();
  });
}

/** Message d'information détaillé (bilan d'une migration ou d'une restauration). */
export function infoDialog(title: string, paragraphs: (string | HTMLElement | null)[]): Promise<void> {
  return new Promise((resolve) => {
    const ok = h('button', { type: 'button', className: 'btn btn-primary', 'data-testid': 'info-ok' }, 'Compris');
    const dialog = h('dialog', { className: 'dialog', 'aria-labelledby': 'dialog-title', 'data-testid': 'info-dialog' },
      h('h2', { id: 'dialog-title' }, title),
      ...paragraphs.filter((p): p is string | HTMLElement => p !== null).map((p) => (typeof p === 'string' ? h('p', {}, p) : p)),
      h('div', { className: 'dialog-actions' }, ok),
    );
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    ok.addEventListener('click', finish);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish();
    });
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}
