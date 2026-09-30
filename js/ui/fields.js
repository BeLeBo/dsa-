/**
 * fields.js – Eingabefelder, die über einen Datenpfad (data-path) an den Helden gebunden sind.
 *
 * Die Felder werden ohne Wert erzeugt; `refreshValues` füllt sie aus dem Helden.
 * `bindFields` hört zentral auf Eingaben und schreibt sie in den Helden zurück.
 * So gibt es genau einen Weg für Anzeigen und Speichern – egal ob beim ersten
 * Aufbau, nach einer Probe (AsP-Abzug) oder später bei Live-Änderungen anderer.
 */
import { h } from './dom.js';
import { ROMAN_LEVELS, toInt, toNumber } from '../rules.js';
import { getPath, setPath, formatDecimal } from '../util.js';

// ---------------------------------------------------------------------------
// Lesen & Schreiben
// ---------------------------------------------------------------------------

function readControl(element) {
  switch (element.dataset.type) {
    case 'int':
      return toInt(element.value);
    case 'optional-int':
      return element.value.trim() === '' ? null : toInt(element.value, null);
    case 'number':
      return toNumber(element.value);
    case 'bool':
      return element.checked;
    default:
      return element.value;
  }
}

function writeControl(element, value) {
  switch (element.dataset.type) {
    case 'bool':
      element.checked = value === true;
      break;
    case 'roman':
      element.textContent = ROMAN_LEVELS[toInt(value)] ?? String(value);
      break;
    case 'number':
      element.value = value ? formatDecimal(value, 3) : value === 0 ? '0' : '';
      break;
    default:
      element.value = value ?? '';
  }
}

/**
 * Überträgt alle Werte des Helden in die Felder. Das Feld, in dem gerade getippt wird,
 * bleibt unangetastet, solange es schon den richtigen Wert zeigt – so springt nie der Cursor,
 * aber eine Änderung von außen (z. B. vom Meister) erscheint trotzdem.
 */
export function refreshValues(root, hero) {
  for (const element of root.querySelectorAll('[data-path]')) {
    const value = getPath(hero, element.dataset.path);
    const isEditing = element === document.activeElement && element.dataset.type !== 'roman';
    if (isEditing && Object.is(readControl(element), value ?? null)) continue;
    writeControl(element, value);
  }
}

/**
 * Zentrale Ereignisbehandlung für gebundene Felder und Stepper-Knöpfe.
 * @param {HTMLElement} root
 * @param {object} store  Heldenspeicher (siehe store.js)
 */
export function bindFields(root, store) {
  const onEdit = (event) => {
    const element = event.target.closest('[data-path]');
    if (!element || !root.contains(element) || element.dataset.type === 'roman') return;
    // Auswahllisten und Häkchen melden sich per „change“, Textfelder bei jedem Tastendruck per „input“.
    const reportsOnChange = element.tagName === 'SELECT' || element.type === 'checkbox';
    if (reportsOnChange !== (event.type === 'change')) return;
    setPath(store.hero, element.dataset.path, readControl(element));
    store.changed(element.dataset.structural === undefined ? 'value' : 'structure', element);
  };
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button || !root.contains(button)) return;
    const { stepPath, step, min, max } = button.dataset;
    const next = toInt(getPath(store.hero, stepPath)) + toInt(step);
    const limited = Math.min(
      max === undefined ? Infinity : toInt(max),
      Math.max(min === undefined ? -Infinity : toInt(min), next),
    );
    setPath(store.hero, stepPath, limited);
    store.changed('value', null);
  });
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Beschriftetes Feld. */
export function field(label, control, { className = '', hint = null } = {}) {
  return h(
    'label',
    { class: `field ${className}`.trim() },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint', dataset: hint.dataset ?? {} }, hint.text ?? '') : null,
  );
}

export function textInput(path, { placeholder, label, className } = {}) {
  return h('input', {
    type: 'text',
    class: className,
    placeholder,
    'aria-label': label,
    autocomplete: 'off',
    dataset: { path, type: 'text' },
  });
}

export function textArea(path, { rows = 3, placeholder, label } = {}) {
  return h('textarea', { rows, placeholder, 'aria-label': label, dataset: { path, type: 'text' } });
}

/**
 * Ganzzahl-Feld.
 * signed: auch negative Werte (Handy zeigt dann eine Tastatur mit Minus).
 * optional + auto: leer = automatisch; `auto` benennt den berechneten Platzhalter (data-auto).
 */
export function intInput(path, { label, signed = false, optional = false, auto = null, className } = {}) {
  return h('input', {
    type: 'number',
    step: 1,
    inputmode: signed ? null : 'numeric',
    class: `num ${className ?? ''}`.trim(),
    'aria-label': label,
    dataset: { path, type: optional ? 'optional-int' : 'int', ...(auto ? { auto } : {}) },
  });
}

/** Kommazahl (z. B. Gewicht in Stein); akzeptiert „1,5“. */
export function decimalInput(path, { label } = {}) {
  return h('input', {
    type: 'text',
    inputmode: 'decimal',
    class: 'num',
    'aria-label': label,
    autocomplete: 'off',
    dataset: { path, type: 'number' },
  });
}

/**
 * Auswahlliste; options: [{ value, label }].
 * structural: Die Auswahl ändert den Aufbau (z. B. Nah-/Fernkampf) – Ansicht wird neu aufgebaut.
 */
export function selectInput(path, options, { label, className, structural = false } = {}) {
  return h(
    'select',
    {
      class: className,
      'aria-label': label,
      dataset: { path, type: 'text', ...(structural ? { structural: '' } : {}) },
    },
    options.map((option) => h('option', { value: option.value }, option.label)),
  );
}

export function checkbox(path, label, { className = '' } = {}) {
  return h(
    'label',
    { class: `check ${className}`.trim() },
    h('input', { type: 'checkbox', dataset: { path, type: 'bool' } }),
    h('span', {}, label),
  );
}

function stepButton(path, step, label, { min, max }) {
  return h(
    'button',
    {
      type: 'button',
      class: 'step-button',
      'aria-label': label,
      dataset: { stepPath: path, step, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
    },
    step > 0 ? '+' : '−',
  );
}

/**
 * Wert mit −/+ Knöpfen.
 * display 'input': eingebbares Zahlenfeld; 'roman': nur Anzeige als römische Stufe.
 */
export function stepper(path, { label, min, max, display = 'input', signed = true } = {}) {
  const center =
    display === 'roman'
      ? h('output', { class: 'step-value', 'aria-label': label, dataset: { path, type: 'roman' } })
      : intInput(path, { label, signed });
  return h(
    'div',
    { class: 'stepper' },
    stepButton(path, -1, `${label} verringern`, { min, max }),
    center,
    stepButton(path, 1, `${label} erhöhen`, { min, max }),
  );
}
