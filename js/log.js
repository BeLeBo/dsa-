/**
 * log.js – Würfelprotokoll: Sichtbarkeit von Würfen und das Protokoll dieses Geräts
 * (Modus „Ohne Raum“). Das gemeinsame Protokoll im Raum steht in room-log.js und
 * bietet dieselben Funktionen: entries(), add(record), clear(), canClear(), clearQuestion, subscribe(listener).
 * Listener erhalten (einträge, änderung) mit änderung = { added, remote }.
 */
import { readJson, writeJson } from './storage.js';

export const MAX_LOG_ENTRIES = 200;

/** Speicherschlüssel des Protokolls auf diesem Gerät. */
export const LOG_KEY = 'dsa5.protokoll';

export const VISIBILITY = Object.freeze({ PUBLIC: 'public', MASTER: 'master', SECRET: 'secret' });

export const VISIBILITY_OPTIONS = Object.freeze([
  { id: VISIBILITY.PUBLIC, name: 'Öffentlich', hint: 'Alle im Raum sehen den Wurf.' },
  { id: VISIBILITY.MASTER, name: 'Nur Meister', hint: 'Nur du und der Meister sehen den Wurf.' },
  { id: VISIBILITY.SECRET, name: 'Verdeckt', hint: 'Nur der Meister sieht das Ergebnis – du nicht.' },
]);

export const VISIBILITY_LABELS = Object.freeze({
  [VISIBILITY.PUBLIC]: 'öffentlich',
  [VISIBILITY.MASTER]: 'nur Meister',
  [VISIBILITY.SECRET]: 'verdeckt',
});

/**
 * Darf diese Person den Wurf sehen? (Gleiche Regel wie die Datenbank, siehe schema.sql.)
 * @param {object} record  Protokolleintrag mit visibility und userId
 * @param {object} viewer  { isMaster, userId }
 */
export function canSee(record, { isMaster = false, userId = null } = {}) {
  const visibility = record.visibility ?? VISIBILITY.PUBLIC;
  if (visibility === VISIBILITY.PUBLIC || isMaster) return true;
  return visibility === VISIBILITY.MASTER && record.userId === userId;
}

/** Protokoll nur auf diesem Gerät (im Browser gespeichert). */
export function createLocalLog(storageKey) {
  const stored = readJson(storageKey, []);
  let entries = Array.isArray(stored) ? stored : [];
  const listeners = new Set();

  function commit(change) {
    writeJson(storageKey, entries);
    for (const listener of listeners) listener(entries, change);
  }

  return {
    entries: () => entries,
    add(record) {
      entries = [record, ...entries].slice(0, MAX_LOG_ENTRIES);
      commit({ added: record, remote: false });
    },
    async clear() {
      entries = [];
      commit({ added: null, remote: false });
    },
    canClear: () => true,
    clearQuestion: 'Alle Einträge im Protokoll dieses Geräts löschen?',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
