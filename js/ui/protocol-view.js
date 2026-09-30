/**
 * protocol-view.js – Tab „Protokoll“: alle Würfe, neueste zuerst, zum Aufklappen.
 * (Nicht „log-view.js“ nennen: Dieser Name steht in Tracker-Sperrlisten wie EasyPrivacy.)
 * Funktioniert mit dem Geräteprotokoll (log.js) und dem Raumprotokoll (room-log.js).
 */
import { h, setChildren } from './dom.js';
import { renderLogEntry } from './roll-view.js';
import { confirmDialog } from './dialog.js';
import { showError } from './toast.js';

export function createLogView(root, log) {
  const list = h('div', { class: 'log-list' });

  const clearButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onclick: async () => {
        if (!(await confirmDialog(log.clearQuestion, { confirmLabel: 'Leeren', danger: true }))) return;
        try {
          await log.clear();
        } catch (error) {
          showError(error, 'Protokoll leeren fehlgeschlagen');
        }
      },
    },
    'Protokoll leeren',
  );

  function render(entries) {
    // Aufgeklappte Einträge bleiben offen, wenn neue Würfe dazukommen.
    const openIds = new Set([...list.querySelectorAll('details[open]')].map((entry) => entry.dataset.id));
    setChildren(
      list,
      entries.length
        ? entries.map(renderLogEntry)
        : h(
            'p',
            { class: 'empty-hint' },
            'Noch keine Würfe. Tippe im Heldenbogen auf ein Talent oder würfle im Tab „Würfeln“.',
          ),
    );
    for (const entry of list.querySelectorAll('details')) entry.open = openIds.has(entry.dataset.id);
    clearButton.hidden = !log.canClear();
  }

  setChildren(root, h('div', { class: 'log-toolbar' }, h('h2', {}, 'Protokoll'), clearButton), list);
  log.subscribe(render);
  render(log.entries());
  return { render: () => render(log.entries()) };
}
