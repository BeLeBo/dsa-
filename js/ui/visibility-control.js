/**
 * visibility-control.js – Auswahl, wer einen Wurf sehen darf (nur im Raum).
 * Die zuletzt gewählte Sichtbarkeit merkt sich das Gerät.
 */
import { h } from './dom.js';
import { segmentedControl } from './segmented.js';
import { VISIBILITY, VISIBILITY_OPTIONS } from '../log.js';
import { readJson, writeJson } from '../storage.js';

const VISIBILITY_KEY = 'dsa5.ui.sichtbarkeit';

export function lastVisibility() {
  const stored = readJson(VISIBILITY_KEY, VISIBILITY.PUBLIC);
  return VISIBILITY_OPTIONS.some(({ id }) => id === stored) ? stored : VISIBILITY.PUBLIC;
}

function hintFor(value) {
  return VISIBILITY_OPTIONS.find(({ id }) => id === value)?.hint ?? '';
}

/**
 * Knopfleiste „Öffentlich / Nur Meister / Verdeckt“ mit Erklärung.
 * @param {string} value  aktuelle Sichtbarkeit
 * @param {(value: string) => void} onChange
 */
export function visibilityControl(value, onChange) {
  const hint = h('p', { class: 'section-hint visibility-hint' }, hintFor(value));
  const control = segmentedControl(
    VISIBILITY_OPTIONS,
    value,
    (id) => {
      writeJson(VISIBILITY_KEY, id);
      hint.textContent = hintFor(id);
      onChange(id);
    },
    'Sichtbarkeit des Wurfs',
  );
  return h('div', { class: 'visibility' }, h('span', { class: 'field-label' }, 'Wer sieht den Wurf?'), control, hint);
}
