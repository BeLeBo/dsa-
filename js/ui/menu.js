/**
 * menu.js – Menü (⋮): Einträge des jeweiligen Modus, dazu Geräteeinstellungen:
 * App installieren, Darstellung (Hell/Dunkel, Schriftgröße) und „Bildschirm anlassen“.
 */
import { h, setChildren } from './dom.js';
import { openDialog } from './dialog.js';
import { showError, showToast } from './toast.js';
import { segmentedControl } from './segmented.js';
import { THEMES, TEXT_SIZES, currentTheme, currentTextSize, setTheme, setTextSize } from './theme.js';
import { canPromptInstall, promptInstall, installHint, canKeepAwake, keepAwakeEnabled, setKeepAwake } from '../pwa.js';

function menuButton(dialog, { label, onClick, danger = false }) {
  return h(
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
  );
}

function deviceSettings() {
  return [
    h('h3', {}, 'Darstellung'),
    segmentedControl(THEMES, currentTheme(), setTheme, 'Farbmodus'),
    h('span', { class: 'field-label menu-label' }, 'Schriftgröße'),
    segmentedControl(TEXT_SIZES, currentTextSize(), setTextSize, 'Schriftgröße'),
    canKeepAwake()
      ? h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: keepAwakeEnabled(),
            onchange: (event) => setKeepAwake(event.target.checked),
          }),
          h('span', {}, 'Bildschirm nicht ausschalten (am Spieltisch)'),
        )
      : null,
  ];
}

/**
 * Öffnet das Menü.
 * @param {object} options
 * @param {{ label: string, onClick: Function, danger?: boolean }[]} options.items
 * @param {string} [options.note]  Hinweis unter den Einträgen
 */
export function openMenu({ items, note = '' }) {
  const dialog = openDialog({ title: 'Menü', className: 'dialog-small' });
  const install = canPromptInstall()
    ? [
        {
          label: 'App auf dem Startbildschirm installieren',
          onClick: async () => {
            if (await promptInstall()) showToast('App installiert – du findest sie jetzt auf dem Startbildschirm.');
          },
        },
      ]
    : [];
  const hint = installHint();

  setChildren(
    dialog.body,
    h(
      'div',
      { class: 'menu-list' },
      [...install, ...items].map((item) => menuButton(dialog, item)),
    ),
    hint ? h('p', { class: 'section-hint' }, hint) : null,
    deviceSettings(),
    note ? h('p', { class: 'section-hint' }, note) : null,
    h(
      'p',
      { class: 'section-hint' },
      h('a', { href: 'tests/rules.test.html', target: '_blank', rel: 'noopener' }, 'Regeltests öffnen'),
    ),
  );
}
