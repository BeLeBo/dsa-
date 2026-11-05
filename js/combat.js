/**
 * combat.js – Kampfreihenfolge (Initiative) als reine Funktionen, ohne DOM und ohne Server.
 *
 * Ein Kampf ist ein JSON-Objekt, das im Raum gespeichert und live geteilt wird:
 *   { round, currentId, entries: [{ id, kind, name, characterId, base, roll, modifier, total, tiebreak }] }
 * Die Reihenfolge ergibt sich immer frisch aus sortInitiative (rules.js); `currentId`
 * merkt sich, wer am Zug ist – so bleibt der Zug stabil, wenn jemand nachträglich dazukommt.
 * Alle Funktionen liefern einen neuen Kampf und verändern den übergebenen nicht.
 */
import { initiativeTotal, sortInitiative, toInt } from './rules.js';
import { newId } from './util.js';

export const ENTRY_KINDS = Object.freeze({ HERO: 'held', NPC: 'nsc' });
const MAX_NPC_COUNT = 20;
const NEVER = () => false;

/** LeP auf 0 oder weniger (bei bekanntem Maximum)? Leere Werte zählen nicht. */
function lifeIsGone(current, max) {
  if (current === null || current === undefined || current === '') return false;
  const value = Number(current);
  const maximum = Number(max);
  return Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0 && value <= 0;
}

/**
 * Tot bzw. kampfunfähig (LeP 0 oder weniger)? Solche Einträge kommen im Kampf nicht dran.
 * Helden: aus dem Heldenbogen, wenn das Gerät ihn kennt, sonst aus ihrer Figur (die Datenbank
 * spiegelt die LeP der Helden auf die Figuren). Gegner/NSC: über ihre Figur(en) gleichen Namens –
 * erst wenn alle am Boden sind. Ohne eingetragene LeP ist niemand tot.
 * @param {object} entry
 * @param {{ hero?: object|null, tokens?: object[] }} known
 */
export function isEntryDown(entry, { hero = null, tokens = [] } = {}) {
  if (!entry) return false;
  const pool = entry.kind === ENTRY_KINDS.HERO ? hero?.base?.le : null;
  if (pool) return lifeIsGone(pool.current, pool.max);
  const own = tokens.filter((token) =>
    entry.kind === ENTRY_KINDS.HERO
      ? token.character_id === entry.characterId
      : !token.character_id && token.name === entry.name,
  );
  const tracked = own.filter((token) => Number(token.le_max) > 0 && token.le_current !== null);
  return tracked.length > 0 && tracked.every((token) => lifeIsGone(token.le_current, token.le_max));
}

/** Überspringen nur, solange noch jemand übrig ist – sonst ginge es reihum wie immer. */
function skipper(order, isOut) {
  return order.length > 0 && order.every((entry) => isOut(entry)) ? NEVER : isOut;
}

export function startCombat() {
  return { round: 1, currentId: null, entries: [] };
}

export function heroEntryId(characterId) {
  return `held:${characterId}`;
}

/** Reihenfolge: höchste Initiative zuerst (Gleichstand: INI-Basis, dann Stechwurf). */
export function orderedEntries(combat) {
  return sortInitiative(combat?.entries ?? []);
}

export function currentEntry(combat) {
  return combat?.entries.find((entry) => entry.id === combat.currentId) ?? null;
}

/**
 * Zugwechsel zu einem Helden? Dann dessen ID – der Meister springt mit Werten und Proben zu ihm.
 * Sonst null: gleicher Zug wie vorher, Gegner/NSC am Zug, Kampf vorbei oder gerade erst geladen
 * (beim Öffnen des Raums bleibt der zuletzt gewählte Held).
 * @param {object|null} previous  Kampf vor der Änderung
 * @param {object|null} next      Kampf danach
 */
export function heroOnTurnChange(previous, next) {
  if (!previous || !next) return null;
  const entry = currentEntry(next);
  if (!entry || entry.id === previous.currentId) return null;
  return entry.kind === ENTRY_KINDS.HERO ? entry.characterId : null;
}

function makeEntry({ id, kind, name, characterId = null, base, roll, modifier = 0, tiebreak }) {
  return {
    id,
    kind,
    name,
    characterId,
    base: toInt(base),
    roll,
    modifier: toInt(modifier),
    total: initiativeTotal(base, roll, modifier),
    tiebreak,
  };
}

/**
 * Eintrag aus einem Initiative-Wurf eines Helden (Protokolleintrag aus checks.js).
 * @param {object} record     Protokolleintrag vom Typ „initiative“
 * @param {string} characterId ID des Helden auf dem Server
 * @param {number} tiebreak    Stechwurf für Gleichstand
 */
export function entryFromInitiativeRoll(record, characterId, tiebreak) {
  const { base, roll, modifier } = record.result;
  return makeEntry({
    id: heroEntryId(characterId),
    kind: ENTRY_KINDS.HERO,
    name: record.actor,
    characterId,
    base,
    roll,
    modifier,
    tiebreak,
  });
}

/**
 * Nichtspielercharaktere (z. B. „Ork“ × 3 → „Ork 1“, „Ork 2“, „Ork 3“), jeder mit eigenem 1W6.
 * @param {object} npc   { name, base, count }
 * @param {(sides: number) => number} roll  Würfelfunktion
 */
export function createNpcEntries({ name, base, count = 1 }, roll) {
  const label = String(name ?? '').trim() || 'Gegner';
  const amount = Math.min(MAX_NPC_COUNT, Math.max(1, toInt(count, 1)));
  return Array.from({ length: amount }, (_, index) =>
    makeEntry({
      id: `nsc:${newId()}`,
      kind: ENTRY_KINDS.NPC,
      name: amount > 1 ? `${label} ${index + 1}` : label,
      base,
      roll: roll(6),
      tiebreak: roll(20),
    }),
  );
}

/** Fügt einen Eintrag hinzu oder ersetzt den mit gleicher ID (z. B. neuer Initiative-Wurf). */
export function upsertEntry(combat, newEntry) {
  const exists = combat.entries.some((item) => item.id === newEntry.id);
  const entries = exists
    ? combat.entries.map((item) => (item.id === newEntry.id ? newEntry : item))
    : [...combat.entries, newEntry];
  return { ...combat, entries };
}

/** Ändert den Initiative-Modifikator eines Eintrags (z. B. durch Zustände oder Sonderfertigkeiten). */
export function adjustEntry(combat, id, delta) {
  const entries = combat.entries.map((item) =>
    item.id === id ? makeEntry({ ...item, modifier: item.modifier + toInt(delta) }) : item,
  );
  return { ...combat, entries };
}

/**
 * Entfernt einen Eintrag; war er am Zug, ist der Nächste dran (ohne neue Runde, Tote übersprungen –
 * am Ende der Reihe der Letzte davor).
 */
export function removeEntry(combat, id, isOut = NEVER) {
  const order = orderedEntries(combat);
  const index = order.findIndex((item) => item.id === id);
  if (index === -1) return combat;
  const remaining = order.filter((item) => item.id !== id);
  const skip = skipper(remaining, isOut);
  const after = remaining.slice(index).find((item) => !skip(item));
  const before = remaining
    .slice(0, index)
    .reverse()
    .find((item) => !skip(item));
  const currentId = combat.currentId === id ? ((after ?? before)?.id ?? null) : combat.currentId;
  return { ...combat, entries: combat.entries.filter((item) => item.id !== id), currentId };
}

/**
 * Nächster ist dran; nach dem Letzten beginnt eine neue Kampfrunde. Wer tot ist (`isOut`),
 * kommt nicht dran.
 */
export function advanceTurn(combat, isOut = NEVER) {
  const order = orderedEntries(combat);
  if (order.length === 0) return combat;
  const skip = skipper(order, isOut);
  const start = order.findIndex((item) => item.id === combat.currentId);
  let index = start;
  let round = combat.round;
  for (let step = 0; step < order.length; step += 1) {
    index += 1;
    if (index === order.length) {
      index = 0;
      if (start !== -1) round += 1;
    }
    if (!skip(order[index])) break;
  }
  return { ...combat, currentId: order[index].id, round };
}

/** Ist gerade dieser Held am Zug? Dann darf sein Spieler den Zug selbst beenden. */
export function isHeroTurn(combat, characterId) {
  const entry = currentEntry(combat);
  return Boolean(characterId) && entry?.kind === ENTRY_KINDS.HERO && entry.characterId === characterId;
}

/**
 * Zurück zum Vorigen; vor dem Ersten geht es in die vorige Runde (nicht vor Runde 1). Tote werden
 * übersprungen.
 */
export function previousTurn(combat, isOut = NEVER) {
  const order = orderedEntries(combat);
  let index = order.findIndex((item) => item.id === combat.currentId);
  if (index === -1) return combat;
  const skip = skipper(order, isOut);
  let round = combat.round;
  for (let step = 0; step < order.length; step += 1) {
    index -= 1;
    if (index < 0) {
      if (round <= 1) return combat;
      round -= 1;
      index = order.length - 1;
    }
    if (!skip(order[index])) return { ...combat, currentId: order[index].id, round };
  }
  return combat;
}

/** Ist dieser Protokolleintrag ein Initiative-Wurf eines Helden (für den laufenden Kampf)? */
export function isHeroInitiativeRoll(record) {
  return record?.type === 'initiative' && Boolean(record.characterId);
}
