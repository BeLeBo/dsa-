/**
 * merge.js – Führt gleichzeitige Änderungen am selben Helden zusammen (Drei-Wege-Merge).
 *
 *   base   = zuletzt bekannter Serverstand
 *   local  = Stand auf diesem Gerät (evtl. mit ungespeicherten Änderungen)
 *   remote = neuer Serverstand (z. B. der Meister hat LE abgezogen)
 *
 * Regeln:
 *  - Was nur eine Seite geändert hat, wird übernommen.
 *  - Haben beide Seiten denselben Wert unterschiedlich geändert, gewinnt die lokale
 *    Eingabe – sie wird anschließend gespeichert und ist dann für alle sichtbar.
 *  - Listen mit IDs (Waffen, Zauber, Gegenstände …) werden Eintrag für Eintrag
 *    zusammengeführt; neue Einträge beider Seiten bleiben erhalten.
 *  - Ein gelöschter Eintrag bleibt gelöscht, außer die andere Seite hat ihn geändert.
 */
import { isPlainObject, deepEqual, clone } from './util.js';

function isIdList(value) {
  return Array.isArray(value) && value.every((entry) => isPlainObject(entry) && typeof entry.id === 'string');
}

function byId(list) {
  return new Map(list.map((entry) => [entry.id, entry]));
}

/** Übernimmt einen Wert, den nur eine Seite hat – wenn er neu ist oder dort geändert wurde. */
function keepOneSided(baseHas, baseValue, value) {
  return !baseHas || !deepEqual(baseValue, value);
}

function mergeObjects(base, local, remote) {
  const result = {};
  for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const inLocal = Object.hasOwn(local, key);
    const inRemote = Object.hasOwn(remote, key);
    const inBase = Object.hasOwn(base, key);
    if (inLocal && inRemote) result[key] = mergeJson(base[key], local[key], remote[key]);
    else if (inLocal && keepOneSided(inBase, base[key], local[key])) result[key] = clone(local[key]);
    else if (inRemote && keepOneSided(inBase, base[key], remote[key])) result[key] = clone(remote[key]);
  }
  return result;
}

function mergeIdLists(base, local, remote) {
  const baseById = byId(base);
  const localById = byId(local);
  const remoteById = byId(remote);
  const result = [];

  for (const remoteEntry of remote) {
    const localEntry = localById.get(remoteEntry.id);
    const baseEntry = baseById.get(remoteEntry.id);
    if (localEntry) result.push(mergeJson(baseEntry, localEntry, remoteEntry));
    else if (keepOneSided(baseById.has(remoteEntry.id), baseEntry, remoteEntry)) result.push(clone(remoteEntry));
  }
  for (const localEntry of local) {
    if (remoteById.has(localEntry.id)) continue;
    const baseEntry = baseById.get(localEntry.id);
    if (keepOneSided(baseById.has(localEntry.id), baseEntry, localEntry)) result.push(clone(localEntry));
  }
  return result;
}

/** Drei-Wege-Merge beliebiger JSON-Daten (siehe Regeln oben). */
export function mergeJson(base, local, remote) {
  if (deepEqual(local, remote) || deepEqual(local, base)) return clone(remote);
  if (deepEqual(remote, base)) return clone(local);
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjects(isPlainObject(base) ? base : {}, local, remote);
  }
  if (isIdList(local) && isIdList(remote)) {
    return mergeIdLists(isIdList(base) ? base : [], local, remote);
  }
  return clone(local);
}
