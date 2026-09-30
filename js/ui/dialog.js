/**
 * dialog.js – Modale Dialoge (auf dem Handy als Blatt von unten) auf Basis von <dialog>.
 */
import { h, icon, ICONS } from './dom.js';

/**
 * Öffnet einen Dialog.
 * @param {object} options { title, className, onClose }
 * @returns {{ element, body, footer, setTitle, close }}
 */
export function openDialog({ title = '', className = '', onClose = null } = {}) {
  const titleElement = h('h2', { class: 'dialog-title' }, title);
  const body = h('div', { class: 'dialog-body' });
  const footer = h('div', { class: 'dialog-footer' });
  const dialog = h(
    'dialog',
    { class: `dialog ${className}`.trim(), 'aria-label': title },
    h(
      'div',
      { class: 'dialog-header' },
      titleElement,
      h(
        'button',
        { class: 'icon-button', type: 'button', 'aria-label': 'Schließen', onclick: () => close() },
        icon(ICONS.close),
      ),
    ),
    body,
    footer,
  );

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  // Tipp auf den abgedunkelten Hintergrund schließt den Dialog.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  document.body.append(dialog);
  dialog.showModal();
  return {
    element: dialog,
    body,
    footer,
    setTitle(text) {
      titleElement.textContent = text;
      dialog.setAttribute('aria-label', text);
    },
    close,
  };
}

/** Rückfrage mit Ja/Nein. Liefert ein Promise<boolean>. */
export function confirmDialog(message, { title = 'Bitte bestätigen', confirmLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = openDialog({ title, className: 'dialog-small', onClose: () => resolve(confirmed) });
    dialog.body.append(h('p', {}, message));
    dialog.footer.append(
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Abbrechen'),
      h(
        'button',
        {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
          type: 'button',
          onclick: () => {
            confirmed = true;
            dialog.close();
          },
        },
        confirmLabel,
      ),
    );
  });
}
