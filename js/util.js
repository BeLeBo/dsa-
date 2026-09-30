/**
 * util.js – Kleine, allgemeine Hilfsfunktionen ohne Fachlogik.
 */

/** Eindeutige ID für Listeneinträge (Waffen, Zauber, Gegenstände …). */
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tiefe Kopie JSON-fähiger Daten. */
export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/** Tiefer Vergleich JSON-fähiger Daten (Reihenfolge von Objektschlüsseln egal). */
export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
  );
}

function pathSegments(path) {
  return String(path)
    .split('.')
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** Liest einen Wert über einen Pfad wie „talents.3.fw“. */
export function getPath(object, path) {
  return pathSegments(path).reduce((current, key) => (current == null ? undefined : current[key]), object);
}

/** Setzt einen Wert über einen Pfad wie „base.le.current“. Zwischenobjekte müssen existieren. */
export function setPath(object, path, value) {
  const segments = pathSegments(path);
  const last = segments.pop();
  const parent = segments.reduce((current, key) => current?.[key], object);
  if (parent == null || typeof parent !== 'object') {
    throw new Error(`Feld „${path}“ existiert nicht im Heldenbogen.`);
  }
  parent[last] = value;
}

/** Uhrzeit „14:05“ aus einem ISO-Zeitstempel. */
export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Zahl mit deutschem Dezimalkomma, z. B. 12.5 → „12,5“. */
export function formatDecimal(value, maxDigits = 2) {
  return Number(value).toLocaleString('de-DE', { maximumFractionDigits: maxDigits });
}

/** Bietet Text als Datei zum Herunterladen an. */
export function downloadText(filename, text, mimeType = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Macht aus einem Namen einen sicheren Dateinamen. */
export function safeFilename(name, fallback = 'held') {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || fallback;
}
