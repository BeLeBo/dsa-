/**
 * visibility-control.js – Auswahl, wer einen Wurf sehen darf (nur im Raum).
 * Die zuletzt gewählte Sichtbarkeit merkt sich das Gerät.
 */
import { h } from './dom.js';
import { VISIBILITY, VISIBILITY_OPTIONS } from '../log.js';
import { readJson, writeJson } from '../storage.js';

const VISIBILITY_KEY = 'dsa5.ui.sichtbarkeit';

export function lastVisibility() {
  const stored = readJson(VISIBILITY_KEY, VISIBILITY.PUBLIC);
  return VISIBILITY_OPTIONS.some(({ id }) => id === stored) ? stored : VISIBILITY.PUBLIC;
}

/**
 * Knopfleiste „Öffentlich / Nur Meister / Verdeckt“ mit Erklärung.
 * @param {string} value  aktuelle Sichtbarkeit
 * @param {(value: string) => void} onChange
 */
export function visibilityControl(value, onChange) {
  const hint = h('p', { class: 'section-hint visibility-hint' });
  const buttons = VISIBILITY_OPTIONS.map((option) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(option.id === value),
        class: option.id === value ? 'active' : '',
        onclick: () => {
          writeJson(VISIBILITY_KEY, option.id);
          for (const button of buttons) {
            const active = button === buttons[VISIBILITY_OPTIONS.indexOf(option)];
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
          }
          hint.textContent = option.hint;
          onChange(option.id);
        },
      },
      option.name,
    ),
  );
  hint.textContent = VISIBILITY_OPTIONS.find(({ id }) => id === value)?.hint ?? '';
  return h(
    'div',
    { class: 'visibility' },
    h('span', { class: 'field-label' }, 'Wer sieht den Wurf?'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Sichtbarkeit des Wurfs' }, buttons),
    hint,
  );
}
