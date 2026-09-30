/**
 * log.js – Würfelprotokoll dieses Geräts (neueste Einträge zuerst), im Browser gespeichert.
 */
import { readJson, writeJson } from './storage.js';

export const MAX_LOG_ENTRIES = 200;

export function createLocalLog(storageKey) {
  const stored = readJson(storageKey, []);
  let entries = Array.isArray(stored) ? stored : [];
  const listeners = new Set();

  function commit() {
    writeJson(storageKey, entries);
    for (const listener of listeners) listener(entries);
  }

  return {
    entries: () => entries,
    add(record) {
      entries = [record, ...entries].slice(0, MAX_LOG_ENTRIES);
      commit();
    },
    clear() {
      entries = [];
      commit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
