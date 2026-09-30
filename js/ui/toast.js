/**
 * toast.js – Kurze Meldungen am unteren Bildschirmrand, optional mit Aktion („Rückgängig“).
 */
import { h } from './dom.js';

const DEFAULT_DURATION_MS = 5000;

/**
 * Offene modale Dialoge liegen über allem anderen. Damit Meldungen sichtbar bleiben,
 * kommen sie in den obersten offenen Dialog, sonst in den Seitenkörper.
 */
function container() {
  const host = [...document.querySelectorAll('dialog[open]')].pop() ?? document.body;
  let element = host.querySelector(':scope > .toasts');
  if (!element) {
    element = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    host.append(element);
  }
  return element;
}

/**
 * @param {string} message
 * @param {object} [options] { tone: 'info'|'error', action: { label, onClick }, duration }
 */
export function showToast(message, { tone = 'info', action = null, duration = DEFAULT_DURATION_MS } = {}) {
  const toast = h('div', { class: `toast toast-${tone}` }, h('span', { class: 'toast-text' }, message));
  const dismiss = () => toast.remove();
  if (action) {
    toast.append(
      h(
        'button',
        {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label,
      ),
    );
  }
  toast.append(
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Meldung schließen', onclick: dismiss }, '×'),
  );
  container().append(toast);
  setTimeout(dismiss, tone === 'error' ? duration * 2 : duration);
  return dismiss;
}

/** Zeigt einen Fehler verständlich an, statt die App still abstürzen zu lassen. */
export function showError(error, context = '') {
  const message = error?.message || String(error);
  console.error(context || 'Fehler', error);
  showToast(context ? `${context}: ${message}` : message, { tone: 'error' });
}
