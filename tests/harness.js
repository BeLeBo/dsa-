/**
 * harness.js – Minimales Testwerkzeug für die Testseite (ohne externe Abhängigkeiten).
 */

const registeredTests = [];

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Registriert einen Test in einer Gruppe. */
export function test(group, name, fn) {
  registeredTests.push({ group, name, fn });
}

function describe(value) {
  return JSON.stringify(value) ?? String(value);
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
}

/** Vergleicht tief (Objekte, Arrays, Zahlen …). */
export function assertEqual(actual, expected, label = '') {
  if (!deepEqual(actual, expected)) {
    const prefix = label ? `${label}: ` : '';
    throw new AssertionError(`${prefix}erwartet ${describe(expected)}, erhalten ${describe(actual)}`);
  }
}

export function assertTrue(condition, label) {
  if (!condition) throw new AssertionError(label);
}

/** Erwartet, dass fn einen Fehler (optional einer bestimmten Klasse) wirft. */
export function assertThrows(fn, ErrorClass = Error, label = 'Fehler erwartet') {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorClass) return error;
    throw new AssertionError(`${label}: falscher Fehlertyp ${error.name}`);
  }
  throw new AssertionError(`${label}: es wurde kein Fehler geworfen`);
}

/** Führt alle registrierten Tests nacheinander aus (auch asynchrone) und liefert die Ergebnisse. */
export async function runTests() {
  const results = [];
  for (const { group, name, fn } of registeredTests) {
    try {
      await fn();
      results.push({ group, name, ok: true });
    } catch (error) {
      results.push({ group, name, ok: false, error: error.message });
    }
  }
  return results;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Stellt die Ergebnisse gruppiert dar und setzt data-status am <body> ("pass"/"fail"). */
export function renderResults(results, container, summary) {
  const failed = results.filter((result) => !result.ok);
  document.body.dataset.status = failed.length === 0 ? 'pass' : 'fail';
  summary.className = `summary ${failed.length === 0 ? 'pass' : 'fail'}`;
  summary.textContent =
    failed.length === 0
      ? `Alle ${results.length} Tests bestanden ✓`
      : `${failed.length} von ${results.length} Tests fehlgeschlagen ✗`;

  const groups = [...new Set(results.map((result) => result.group))];
  for (const group of groups) {
    const section = element('section');
    section.append(element('h2', '', group));
    const list = element('ul');
    for (const result of results.filter((entry) => entry.group === group)) {
      const item = element('li', result.ok ? 'pass' : 'fail');
      item.append(element('span', 'mark', result.ok ? '✓' : '✗'), element('span', '', result.name));
      if (!result.ok) item.append(element('div', 'error', result.error));
      list.append(item);
    }
    section.append(list);
    container.append(section);
  }
}
