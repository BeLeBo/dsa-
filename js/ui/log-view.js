/**
 * log-view.js – Tab „Protokoll“: alle Würfe, neueste zuerst, zum Aufklappen.
 */
import { h, setChildren } from './dom.js';
import { renderLogEntry } from './roll-view.js';
import { confirmDialog } from './dialog.js';

export function createLogView(root, log) {
  const list = h('div', { class: 'log-list' });

  function render(entries) {
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
  }

  const clearButton = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onclick: async () => {
        if (
          await confirmDialog('Alle Einträge im Protokoll dieses Geräts löschen?', {
            confirmLabel: 'Löschen',
            danger: true,
          })
        ) {
          log.clear();
        }
      },
    },
    'Protokoll leeren',
  );

  setChildren(root, h('div', { class: 'log-toolbar' }, h('h2', {}, 'Protokoll'), clearButton), list);
  log.subscribe(render);
  render(log.entries());
}
