/**
 * info.js (Ansicht) – Das kleine „i“ an Zaubern, Zaubertricks, Vorteilen, Gegenständen usw.: klappt
 * eine Beschreibung auf – Kurzfassung in eigenen Worten (falls vorhanden), Link zum offiziellen
 * Eintrag im Regel-Wiki und ein eigenes Textfeld (wird mit dem Helden gespeichert).
 */
import { h } from '../dom.js';
import { field, textArea } from '../fields.js';
import { actionButton, derived } from './parts.js';

/** Schlüssel für den Auf-/Zu-Zustand (wie bei den Bearbeiten-Bereichen). */
export const infoKey = (listKey, id) => `info:${listKey}:${id}`;

/** Kleines „i“: Beschreibung auf- und zuklappen. */
export function infoToggle(key, isOpen, label = 'Eintrag') {
  const button = actionButton('toggle-editor', key, h('span', { class: 'info-icon', 'aria-hidden': 'true' }, 'i'), {
    className: `info-toggle ${isOpen ? 'active' : ''}`.trim(),
    label: `Beschreibung zu ${label} ${isOpen ? 'zuklappen' : 'aufklappen'}`,
  });
  button.setAttribute('aria-expanded', String(isOpen));
  button.title = 'Beschreibung';
  return button;
}

/**
 * Aufgeklappte Beschreibung. Kurzfassung und Link folgen dem Namen im Helden (auch beim Tippen).
 * @param {{ kinds: string, namePath: string, notePath: string, placeholder?: string }} options
 *        kinds: Katalog-Arten (siehe DESCRIPTION_KINDS), namePath/notePath: Pfade im Helden
 */
export function infoPanel({
  kinds,
  namePath,
  notePath,
  placeholder = 'z. B. Text aus dem Regelbuch oder eigene Notiz',
}) {
  const arg = `${kinds}|${namePath}`;
  return h(
    'div',
    { class: 'info-panel' },
    derived('info-summary', arg, { tag: 'p', className: 'info-summary' }),
    h(
      'a',
      { class: 'info-link', target: '_blank', rel: 'noopener', dataset: { link: `info-link:${arg}` } },
      derived('info-link-text', arg),
    ),
    field(
      'Eigene Beschreibung (für euch, wird mit dem Helden gespeichert)',
      textArea(notePath, { rows: 3, placeholder }),
    ),
  );
}
