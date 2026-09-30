/**
 * storage.js – Sicherer Zugriff auf localStorage.
 * Im privaten Modus oder bei vollem Speicher werfen Browser Fehler; hier werden sie abgefangen.
 */

export function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Speichert einen Wert als JSON. Liefert false, wenn der Browser das Speichern verweigert. */
export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
