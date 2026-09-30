/**
 * segmented.js – Knopfleiste mit genau einer aktiven Wahl (z. B. Hell/Dunkel, Sichtbarkeit).
 */
import { h } from './dom.js';

/**
 * @param {{ id: string, name: string }[]} options
 * @param {string} value            aktuelle Wahl
 * @param {(id: string) => void} onChange
 * @param {string} label            Beschriftung für Screenreader
 */
export function segmentedControl(options, value, onChange, label) {
  const buttons = options.map((option) =>
    h(
      'button',
      {
        type: 'button',
        class: option.id === value ? 'active' : '',
        'aria-pressed': String(option.id === value),
        onclick: () => {
          for (const [index, button] of buttons.entries()) {
            const active = options[index].id === option.id;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
          }
          onChange(option.id);
        },
      },
      option.name,
    ),
  );
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label }, buttons);
}
