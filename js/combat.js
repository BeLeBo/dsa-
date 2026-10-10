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

/** Entfernt einen Eintrag; war er am Zug, ist der Nächste dran (ohne neue Runde). */
export function removeEntry(combat, id) {
  const order = orderedEntries(combat);
  const index = order.findIndex((item) => item.id === id);
  if (index === -1) return combat;
  const remaining = order.filter((item) => item.id !== id);
  const currentId =
    combat.currentId === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null) : combat.currentId;
  return { ...combat, entries: combat.entries.filter((item) => item.id !== id), currentId };
}

/** Nächster ist dran; nach dem Letzten beginnt eine neue Kampfrunde. */
export function advanceTurn(combat) {
  const order = orderedEntries(combat);
  if (order.length === 0) return combat;
  const index = order.findIndex((item) => item.id === combat.currentId);
  if (index === -1) return { ...combat, currentId: order[0].id };
  if (index === order.length - 1) return { ...combat, currentId: order[0].id, round: combat.round + 1 };
  return { ...combat, currentId: order[index + 1].id };
}

/** Zurück zum Vorigen; vor dem Ersten geht es in die vorige Runde (nicht vor Runde 1). */
export function previousTurn(combat) {
  const order = orderedEntries(combat);
  const index = order.findIndex((item) => item.id === combat.currentId);
  if (index === -1) return combat;
  if (index > 0) return { ...combat, currentId: order[index - 1].id };
  if (combat.round > 1) return { ...combat, currentId: order.at(-1).id, round: combat.round - 1 };
  return combat;
}

/** Ist dieser Protokolleintrag ein Initiative-Wurf eines Helden (für den laufenden Kampf)? */
export function isHeroInitiativeRoll(record) {
  return record?.type === 'initiative' && Boolean(record.characterId);
}
