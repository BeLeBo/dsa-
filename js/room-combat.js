/**
 * room-combat.js – Kampf im Raum: hält den Kampfstand (rooms.combat), speichert Änderungen
 * des Meisters, übernimmt Initiative-Würfe der Helden aus dem Protokoll und meldet
 * Spielern „Du bist am Zug!“.
 */
import {
  startCombat,
  advanceTurn,
  previousTurn,
  adjustEntry,
  removeEntry,
  upsertEntry,
  createNpcEntries,
  entryFromInitiativeRoll,
  currentEntry,
  heroEntryId,
  isHeroInitiativeRoll,
} from './combat.js';
import { rollInitiative } from './checks.js';
import { rollDie } from './dice.js';
import { updateCombat } from './room.js';
import { VISIBILITY } from './log.js';

/**
 * @param {object} options
 * @param {string} options.roomId
 * @param {object} options.room            Observable mit { combat, characters }
 * @param {object} options.log             Raumprotokoll (room-log.js)
 * @param {() => boolean} options.isMaster
 * @param {(characterId: string) => object|null} options.heroFor   Heldendaten zu einer ID
 * @param {() => string|null} options.myCharacterId               eigener Held (Spieler)
 * @param {(message: string) => void} options.onYourTurn
 * @param {(error: Error) => void} options.onError
 * @param {Function} [options.save]        (roomId, combat) => Promise – austauschbar für Tests
 */
export function createCombatController({
  roomId,
  room,
  log,
  isMaster,
  heroFor,
  myCharacterId,
  onYourTurn,
  onError,
  save = updateCombat,
}) {
  let writesInFlight = 0;
  const combat = () => room.get().combat ?? null;

  /** Zeigt den neuen Stand sofort und speichert ihn für alle. */
  async function saveCombat(next) {
    room.update({ combat: next });
    writesInFlight += 1;
    try {
      await save(roomId, next);
    } catch (error) {
      onError(error);
    } finally {
      writesInFlight -= 1;
    }
  }

  function notifyTurn(before, after) {
    const current = currentEntry(after);
    const mine = myCharacterId();
    if (!current || !mine || current.characterId !== mine || before?.currentId === after.currentId) return;
    onYourTurn(`Du bist am Zug! (Kampfrunde ${after.round})`);
  }

  /** Neuer Stand des Raums per Realtime; eigene, noch laufende Speichervorgänge haben Vorrang. */
  function handleRoomRow(row) {
    if (!Object.hasOwn(row, 'combat') || writesInFlight > 0) return;
    const before = combat();
    room.update({ combat: row.combat });
    if (row.combat) notifyTurn(before, row.combat);
  }

  /** Neuer Protokolleintrag: Initiative-Würfe von Helden landen beim Meister im Kampf. */
  function handleRecord(record) {
    if (!isMaster() || !combat() || !isHeroInitiativeRoll(record)) return;
    saveCombat(upsertEntry(combat(), entryFromInitiativeRoll(record, record.characterId, rollDie(20))));
  }

  /** Meister würfelt Initiative für einen Helden – der Wurf geht ins Protokoll und von dort in den Kampf. */
  function rollHero(characterId) {
    const hero = heroFor(characterId);
    if (hero) log.add({ ...rollInitiative(hero), characterId, visibility: VISIBILITY.PUBLIC });
  }

  function change(update) {
    const current = combat();
    if (current) saveCombat(update(current));
  }

  const actions = {
    start: () => saveCombat(startCombat()),
    end: () => saveCombat(null),
    next: () => change(advanceTurn),
    previous: () => change(previousTurn),
    adjust: (id, delta) => change((current) => adjustEntry(current, id, delta)),
    remove: (id) => change((current) => removeEntry(current, id)),
    addNpc: (npc) => change((current) => createNpcEntries(npc, rollDie).reduce(upsertEntry, current)),
    /** Mehrere einzelne Gegner mit festem Namen (z. B. „Ork 1“, „Ork 3“ von der Karte). */
    addNpcs: (npcs) =>
      change((current) =>
        npcs
          .flatMap(({ name, base }) => createNpcEntries({ name, base, count: 1 }, rollDie))
          .reduce(upsertEntry, current),
      ),
    rollHero,
    rollAllHeroes: () => {
      const current = combat();
      if (!current) return;
      for (const character of room.get().characters) {
        if (!current.entries.some((entry) => entry.id === heroEntryId(character.id))) rollHero(character.id);
      }
    },
  };

  return { actions, handleRoomRow, handleRecord };
}
