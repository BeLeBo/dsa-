/**
 * menu.js – Menü (⋮): Einträge des jeweiligen Modus plus Darstellung (Hell/Dunkel).
 */
import { h, setChildren } from './dom.js';
import { openDialog } from './dialog.js';
import { showError } from './toast.js';
import { THEMES, currentTheme, setTheme } from './theme.js';

function themeSelector() {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'Darstellung' },
    THEMES.map(({ id, name }) =>
      h(
        'button',
        {
          type: 'button',
          class: id === currentTheme() ? 'active' : '',
          'aria-pressed': String(id === currentTheme()),
          onclick: (event) => {
            setTheme(id);
            for (const button of event.currentTarget.parentElement.children) {
              const active = button === event.currentTarget;
              button.classList.toggle('active', active);
              button.setAttribute('aria-pressed', String(active));
            }
          },
        },
        name,
      ),
    ),
  );
}

/**
 * Öffnet das Menü.
 * @param {object} options
 * @param {{ label: string, onClick: Function, danger?: boolean }[]} options.items
 * @param {string} [options.note]  Hinweis unter den Einträgen
 */
export function openMenu({ items, note = '' }) {
  const dialog = openDialog({ title: 'Menü', className: 'dialog-small' });
  const buttons = items.map(({ label, onClick, danger = false }) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn menu-item ${danger ? 'btn-danger-outline' : ''}`.trim(),
        onclick: async () => {
          dialog.close();
          try {
            await onClick();
          } catch (error) {
            showError(error, label);
          }
        },
      },
      label,
    ),
  );

  setChildren(
    dialog.body,
    h('div', { class: 'menu-list' }, buttons),
    h('h3', {}, 'Darstellung'),
    themeSelector(),
    note ? h('p', { class: 'section-hint' }, note) : null,
    h(
      'p',
      { class: 'section-hint' },
      h('a', { href: 'tests/rules.test.html', target: '_blank', rel: 'noopener' }, 'Regeltests öffnen'),
    ),
  );
}
