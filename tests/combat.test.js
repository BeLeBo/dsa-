/**
 * combat.test.js – Tests für Kampfreihenfolge (combat.js), Sichtbarkeit (log.js),
 * gemeinsames Protokoll (room-log.js) und Kampf-Steuerung (room-combat.js) mit Attrappen.
 */
import { test, assertEqual, assertTrue } from './harness.js';
import { fixedRolls } from './fixtures.js';
import {
  startCombat,
  createNpcEntries,
  entryFromInitiativeRoll,
  upsertEntry,
  adjustEntry,
  removeEntry,
  advanceTurn,
  previousTurn,
  orderedEntries,
  currentEntry,
  heroEntryId,
  isHeroInitiativeRoll,
} from '../js/combat.js';
import { canSee, VISIBILITY } from '../js/log.js';
import { createRoomLog, rowToRecord } from '../js/room-log.js';
import { createCombatController } from '../js/room-combat.js';
import { createObservable } from '../js/store.js';
import { createHero } from '../js/sheet.js';
import { ServerError } from '../js/supabase.js';
import { enemyGroup, enemiesFromTokens } from '../js/ui/play-combat.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function initiativeRecord(actor, base, roll, characterId, modifier = 0) {
  return {
    type: 'initiative',
    actor,
    characterId,
    result: { kind: 'initiative', base, roll, modifier, total: base + roll + modifier },
  };
}

/** Kampf mit Alrik (12+5=17), Bosper (14+2=16) und einem Ork (10+6=16). */
function sampleCombat() {
  let combat = startCombat();
  combat = upsertEntry(combat, entryFromInitiativeRoll(initiativeRecord('Alrik', 12, 5, 'a'), 'a', 3));
  combat = upsertEntry(combat, entryFromInitiativeRoll(initiativeRecord('Bosper', 14, 2, 'b'), 'b', 1));
  const [ork] = createNpcEntries({ name: 'Ork', base: 10 }, fixedRolls([6, 4]));
  return upsertEntry(combat, ork);
}

// ---------------------------------------------------------------------------
// Kampfreihenfolge
// ---------------------------------------------------------------------------

const COMBAT = 'Kampf & Initiative (combat.js)';

test(COMBAT, 'Reihenfolge nach Initiative, Gleichstand nach INI-Basis', () => {
  assertEqual(
    orderedEntries(sampleCombat()).map((entry) => `${entry.name} ${entry.total}`),
    ['Alrik 17', 'Bosper 16', 'Ork 16'],
  );
});

test(COMBAT, 'Weiter durch die Reihenfolge, danach neue Kampfrunde', () => {
  let combat = sampleCombat();
  assertEqual(currentEntry(combat), null, 'noch niemand am Zug');
  combat = advanceTurn(combat);
  assertEqual(currentEntry(combat).name, 'Alrik');
  combat = advanceTurn(advanceTurn(combat));
  assertEqual(currentEntry(combat).name, 'Ork');
  assertEqual(combat.round, 1);
  combat = advanceTurn(combat);
  assertEqual(currentEntry(combat).name, 'Alrik', 'wieder von vorn');
  assertEqual(combat.round, 2, 'neue Runde');
});

test(COMBAT, 'Zurück, auch über den Rundenanfang', () => {
  let combat = advanceTurn(advanceTurn(advanceTurn(advanceTurn(sampleCombat())))); // Runde 2, Alrik
  combat = previousTurn(combat);
  assertEqual(currentEntry(combat).name, 'Ork');
  assertEqual(combat.round, 1);
  combat = previousTurn(previousTurn(combat));
  assertEqual(currentEntry(combat).name, 'Alrik');
  assertEqual(previousTurn(combat), combat, 'vor Runde 1 geht es nicht zurück');
});

test(COMBAT, 'Nachzügler ändern nicht, wer am Zug ist', () => {
  let combat = advanceTurn(advanceTurn(sampleCombat())); // Bosper
  combat = upsertEntry(combat, entryFromInitiativeRoll(initiativeRecord('Rondrian', 15, 6, 'c'), 'c', 2));
  assertEqual(currentEntry(combat).name, 'Bosper');
  assertEqual(orderedEntries(combat)[0].name, 'Rondrian');
});

test(COMBAT, 'Neuer Wurf desselben Helden ersetzt den alten', () => {
  const combat = upsertEntry(sampleCombat(), entryFromInitiativeRoll(initiativeRecord('Alrik', 12, 1, 'a'), 'a', 3));
  assertEqual(combat.entries.filter((entry) => entry.id === heroEntryId('a')).length, 1);
  assertEqual(combat.entries.find((entry) => entry.id === heroEntryId('a')).total, 13);
});

test(COMBAT, 'Modifikator ändern und Eintrag entfernen', () => {
  let combat = adjustEntry(sampleCombat(), heroEntryId('b'), 2);
  assertEqual(orderedEntries(combat)[0].name, 'Bosper', '16 + 2 = 18');
  combat = advanceTurn(combat); // Bosper am Zug
  combat = removeEntry(combat, heroEntryId('b'));
  assertEqual(currentEntry(combat).name, 'Alrik', 'Nächster ist dran');
  assertEqual(combat.entries.length, 2);
});

test(COMBAT, 'Mehrere Gegner auf einmal', () => {
  const orcs = createNpcEntries({ name: 'Ork', base: 10, count: 3 }, fixedRolls([1, 9, 2, 8, 3, 7]));
  assertEqual(
    orcs.map((orc) => orc.name),
    ['Ork 1', 'Ork 2', 'Ork 3'],
  );
  assertEqual(
    orcs.map((orc) => orc.total),
    [11, 12, 13],
  );
  assertTrue(new Set(orcs.map((orc) => orc.id)).size === 3, 'eigene IDs');
});

test(COMBAT, 'Initiative-Wurf eines Helden erkennen', () => {
  assertEqual(isHeroInitiativeRoll(initiativeRecord('Alrik', 12, 5, 'a')), true);
  assertEqual(isHeroInitiativeRoll(initiativeRecord('Ork', 10, 3, null)), false, 'ohne Held');
  assertEqual(isHeroInitiativeRoll({ type: 'fertigkeit', characterId: 'a' }), false);
});

// ---------------------------------------------------------------------------
// Sichtbarkeit
// ---------------------------------------------------------------------------

const VIS = 'Sichtbarkeit von Würfen (log.js)';

test(VIS, 'Öffentlich / nur Meister / verdeckt', () => {
  const player = { isMaster: false, userId: 'p' };
  const master = { isMaster: true, userId: 'm' };
  const own = (visibility) => ({ visibility, userId: 'p' });
  const other = (visibility) => ({ visibility, userId: 'x' });
  assertEqual(canSee(other(VISIBILITY.PUBLIC), player), true, 'öffentlich');
  assertEqual(canSee(own(VISIBILITY.MASTER), player), true, 'eigener nur-Meister-Wurf');
  assertEqual(canSee(other(VISIBILITY.MASTER), player), false, 'fremder nur-Meister-Wurf');
  assertEqual(canSee(own(VISIBILITY.SECRET), player), false, 'eigener verdeckter Wurf');
  assertEqual(canSee(other(VISIBILITY.SECRET), master), true, 'Meister sieht alles');
  assertEqual(canSee({}, player), true, 'ohne Angabe = öffentlich');
});

// ---------------------------------------------------------------------------
// Gemeinsames Protokoll (mit Attrappe statt Server)
// ---------------------------------------------------------------------------

const LOG = 'Gemeinsames Protokoll (room-log.js, mit Attrappen)';
let roomCounter = 0;

function fakeLog({ isMaster = false, online = true, rows = [] } = {}) {
  const roomId = `raum-${Date.now()}-${(roomCounter += 1)}`;
  const inserted = [];
  const errors = [];
  const state = { online };
  const log = createRoomLog({
    roomId,
    context: () => ({ isMaster, userId: 'me', characterId: 'held-1' }),
    onError: (error) => errors.push(error),
    api: {
      fetchRolls: async () => rows,
      insertRoll: async (_roomId, record) => {
        if (!state.online) throw new ServerError('offline', { offline: true });
        inserted.push(record);
      },
      clearRolls: async () => {},
    },
  });
  return { log, inserted, errors, state, roomId };
}

function row(id, userId, visibility, time) {
  return {
    id,
    user_id: userId,
    character_id: null,
    actor: 'Bosper',
    visibility,
    created_at: time,
    data: { id, type: 'frei', label: '1W20', time, result: { kind: 'ausdruck', total: 7 } },
  };
}

test(LOG, 'Eigener Wurf erscheint sofort und wird übertragen', async () => {
  const { log, inserted, roomId } = fakeLog();
  const changes = [];
  log.subscribe((entries, change) => changes.push(change));
  await log.add({ id: 'w1', type: 'frei', label: '1W20', actor: 'Alrik', time: '2026-01-01T10:00:00Z', result: {} });
  assertEqual(inserted.length, 1);
  assertEqual(inserted[0].characterId, 'held-1', 'geöffneter Held wird zugeordnet');
  assertEqual(inserted[0].visibility, 'public', 'Standard: öffentlich');
  assertEqual(changes[0].added.id, 'w1');
  assertEqual(changes[0].remote, false);
  assertEqual(
    log.entries().map((entry) => entry.id),
    ['w1'],
  );
  assertEqual(log.entries()[0].pending, undefined, 'nicht mehr „wird übertragen“');
  localStorage.removeItem(`dsa5.wurfwarteschlange.${roomId}`);
});

test(LOG, 'Offline: Wurf wartet und wird später nachgereicht', async () => {
  const { log, inserted, state, roomId } = fakeLog({ online: false });
  await log.add({ id: 'w2', type: 'frei', label: '2W6', actor: 'Alrik', time: '2026-01-01T10:00:00Z', result: {} });
  assertEqual(inserted.length, 0);
  assertEqual(log.entries()[0].pending, true, 'als „wird übertragen“ markiert');
  assertTrue(
    localStorage.getItem(`dsa5.wurfwarteschlange.${roomId}`).includes('w2'),
    'Warteschlange im Gerätespeicher',
  );
  state.online = true;
  await log.flushPending();
  assertEqual(
    inserted.map((record) => record.id),
    ['w2'],
  );
  assertEqual(log.entries()[0].pending, undefined);
  localStorage.removeItem(`dsa5.wurfwarteschlange.${roomId}`);
});

test(LOG, 'Würfe anderer kommen live dazu, ohne Dubletten', () => {
  const { log } = fakeLog();
  const changes = [];
  log.subscribe((entries, change) => changes.push(change));
  log.receive(row('r1', 'other', 'public', '2026-01-01T10:01:00Z'));
  log.receive(row('r1', 'other', 'public', '2026-01-01T10:01:00Z'));
  assertEqual(log.entries().length, 1);
  assertEqual(changes.length, 1);
  assertEqual(changes[0].remote, true);
  assertEqual(rowToRecord(row('r2', 'x', 'master', 't')).visibility, 'master');
});

test(LOG, 'Spieler sieht eigenen verdeckten Wurf nicht, Meister schon', async () => {
  const player = fakeLog();
  await player.log.add({
    id: 'w3',
    type: 'frei',
    label: '1W20',
    actor: 'Alrik',
    visibility: 'secret',
    time: 't',
    result: {},
  });
  assertEqual(player.inserted.length, 1, 'trotzdem an den Meister übertragen');
  assertEqual(player.log.entries().length, 0, 'aber nicht im eigenen Protokoll');
  const master = fakeLog({ isMaster: true });
  master.log.receive(row('w4', 'other', 'secret', '2026-01-01T10:02:00Z'));
  assertEqual(master.log.entries().length, 1);
  localStorage.removeItem(`dsa5.wurfwarteschlange.${player.roomId}`);
});

test(LOG, 'Laden: neueste zuerst, nur Meister darf leeren', async () => {
  const { log } = fakeLog({
    rows: [row('a', 'x', 'public', '2026-01-01T10:00:00Z'), row('b', 'x', 'public', '2026-01-01T11:00:00Z')],
  });
  await log.load();
  assertEqual(
    log.entries().map((entry) => entry.id),
    ['b', 'a'],
  );
  assertEqual(log.canClear(), false);
  assertEqual(fakeLog({ isMaster: true }).log.canClear(), true);
});

// ---------------------------------------------------------------------------
// Kampf-Steuerung im Raum
// ---------------------------------------------------------------------------

const CONTROL = 'Kampf-Steuerung im Raum (room-combat.js, mit Attrappen)';

function controller({ isMaster = true, myCharacterId = null, save = null } = {}) {
  const room = createObservable({ combat: null, characters: [{ id: 'a', data: createHero() }] });
  const saved = [];
  const turns = [];
  const added = [];
  const log = { add: (record) => added.push(record) };
  const control = createCombatController({
    roomId: 'raum',
    room,
    log,
    isMaster: () => isMaster,
    heroFor: () => createHero(),
    myCharacterId: () => myCharacterId,
    onYourTurn: (message) => turns.push(message),
    onError: (error) => {
      throw error;
    },
    save: save ?? (async (_roomId, combat) => saved.push(combat)),
  });
  return { room, saved, turns, added, control };
}

test(CONTROL, 'Meister: Kampf starten, Initiative-Wurf übernehmen, weiter', async () => {
  const { room, saved, control } = controller();
  control.actions.start();
  control.handleRecord(initiativeRecord('Alrik', 12, 5, 'a'));
  control.actions.next();
  await wait(0);
  assertEqual(room.get().combat.entries.length, 1);
  assertEqual(currentEntry(room.get().combat).name, 'Alrik');
  assertEqual(saved.at(-1), room.get().combat, 'der neueste Stand ist gespeichert');
});

test(CONTROL, 'Schnelle Änderungen hintereinander: auf dem Server landet immer der neueste Stand', async () => {
  // Server-Attrappe: übernimmt Speichervorgänge in der Reihenfolge, in der sie ankommen –
  // der erste ist langsam (z. B. schlechtes Netz), ein zweiter könnte ihn sonst überholen.
  let server = null;
  let running = 0;
  let overlapped = false;
  let calls = 0;
  const save = async (_roomId, combat) => {
    calls += 1;
    running += 1;
    if (running > 1) overlapped = true;
    await wait(calls === 1 ? 30 : 0);
    server = combat;
    running -= 1;
  };
  const { room, control } = controller({ save });
  control.actions.start();
  control.handleRecord(initiativeRecord('Alrik', 12, 5, 'a')); // läuft, während der Start noch gespeichert wird
  control.actions.addNpc({ name: 'Ork', base: 10, count: 2 });
  await wait(80);
  assertEqual(room.get().combat.entries.length, 3, 'hier: Alrik und zwei Orks');
  assertEqual(server, room.get().combat, 'auf dem Server: derselbe, neueste Stand (Orks nicht verloren)');
  assertTrue(!overlapped, 'Speichervorgänge laufen nacheinander, nie gleichzeitig');
  assertTrue(calls <= 3, `Zwischenstände werden zusammengefasst (${calls} Speichervorgänge)`);
});

test(CONTROL, 'Spieler übernehmen keine Würfe in den Kampf', () => {
  const { room, control } = controller({ isMaster: false });
  room.update({ combat: startCombat() });
  control.handleRecord(initiativeRecord('Alrik', 12, 5, 'a'));
  assertEqual(room.get().combat.entries.length, 0);
});

test(CONTROL, 'Meister würfelt für Helden: Wurf geht ins Protokoll', () => {
  const { room, added, control } = controller();
  room.update({ combat: startCombat() });
  control.actions.rollAllHeroes();
  assertEqual(added.length, 1);
  assertEqual(added[0].type, 'initiative');
  assertEqual(added[0].characterId, 'a');
});

test(CONTROL, 'Spieler bekommt „Du bist am Zug!“', () => {
  const { turns, control } = controller({ isMaster: false, myCharacterId: 'a' });
  const combat = upsertEntry(startCombat(), entryFromInitiativeRoll(initiativeRecord('Alrik', 12, 5, 'a'), 'a', 1));
  control.handleRoomRow({ combat });
  control.handleRoomRow({ combat: advanceTurn(combat) });
  assertEqual(turns.length, 1);
  assertTrue(turns[0].includes('Du bist am Zug'), turns[0]);
  control.handleRoomRow({ combat: advanceTurn(combat) });
  assertEqual(turns.length, 1, 'nicht doppelt');
});

test(CONTROL, 'Meister: Gegner von der Karte – jede Figur mit ihrem Namen, gleiche INI-Basis je Art', async () => {
  const { room, control } = controller();
  control.actions.start();
  control.actions.addNpcs([
    { name: 'Ork 1', base: 10 },
    { name: 'Ork 3', base: 10 },
  ]);
  await wait(0);
  const entries = room.get().combat.entries;
  assertEqual(
    entries.map((entry) => [entry.name, entry.base]).sort(),
    [
      ['Ork 1', 10],
      ['Ork 3', 10],
    ],
    'Namen wie auf der Karte (Lebensbalken/„am Zug“ passen)',
  );
});

test(CONTROL, 'Gegner von der Karte: nach Art gruppiert, Helden und schon Kämpfende ausgenommen', () => {
  assertEqual(enemyGroup('Ork 12'), 'Ork');
  assertEqual(enemyGroup('Wache'), 'Wache');
  assertEqual(enemyGroup(' '), 'Gegner');
  const tokens = [
    { name: 'Ork 1', character_id: null },
    { name: 'Ork 2', character_id: null },
    { name: 'Alrik', character_id: 'c1' },
    { name: 'Wache', character_id: null },
    { name: 'Ork 3', character_id: null },
  ];
  const combat = { entries: [{ name: 'Ork 2' }] };
  assertEqual(enemiesFromTokens(tokens, combat), [
    { group: 'Ork', names: ['Ork 1', 'Ork 3'] },
    { group: 'Wache', names: ['Wache'] },
  ]);
  assertEqual(enemiesFromTokens([], null), []);
});
