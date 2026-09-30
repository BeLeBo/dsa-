/**
 * sync.test.js – Tests für Zusammenführen (merge.js), Raum-Eingaben (room.js),
 * Fehlermeldungen (supabase.js) und den Abgleich eines Helden (sync.js) mit Attrappen.
 */
import { test, assertEqual, assertTrue } from './harness.js';
import { mergeJson } from '../js/merge.js';
import { normalizeRoomCode, validateJoin, validateCreate, inviteLink } from '../js/room.js';
import { toServerError, ServerError, projectUrl } from '../js/supabase.js';
import { createCharacterSync, readCachedCharacter } from '../js/sync.js';
import { createHeroStore, REMOTE } from '../js/store.js';
import { createHero, createWeapon } from '../js/sheet.js';
import { clone, timestampMs, isOlderTimestamp } from '../js/util.js';

// ---------------------------------------------------------------------------
// Drei-Wege-Merge
// ---------------------------------------------------------------------------

const MERGE = 'Zusammenführen gleichzeitiger Änderungen (merge.js)';

test(MERGE, 'Nur eine Seite geändert → deren Stand', () => {
  const base = { a: 1, b: 2 };
  assertEqual(mergeJson(base, { a: 5, b: 2 }, base), { a: 5, b: 2 }, 'nur lokal');
  assertEqual(mergeJson(base, base, { a: 1, b: 7 }), { a: 1, b: 7 }, 'nur Server');
});

test(MERGE, 'Verschiedene Felder geändert → beide Änderungen bleiben', () => {
  const base = { base: { le: { current: 30, max: 30 } }, general: { name: 'Alrik' } };
  const local = { base: { le: { current: 30, max: 30 } }, general: { name: 'Alrik der Große' } };
  const remote = { base: { le: { current: 22, max: 30 } }, general: { name: 'Alrik' } };
  assertEqual(mergeJson(base, local, remote), {
    base: { le: { current: 22, max: 30 } },
    general: { name: 'Alrik der Große' },
  });
});

test(MERGE, 'Dasselbe Feld auf beiden Seiten geändert → lokale Eingabe gewinnt', () => {
  assertEqual(mergeJson({ x: 1 }, { x: 2 }, { x: 3 }), { x: 2 });
  assertEqual(mergeJson({ check: ['MU', 'GE', 'KK'] }, { check: ['MU', 'MU', 'KK'] }, { check: ['KL', 'GE', 'KK'] }), {
    check: ['MU', 'MU', 'KK'],
  });
});

test(MERGE, 'Listen: neue Einträge beider Seiten bleiben erhalten', () => {
  const base = { weapons: [{ id: 'a', name: 'Säbel' }] };
  const local = {
    weapons: [
      { id: 'a', name: 'Säbel' },
      { id: 'b', name: 'Dolch' },
    ],
  };
  const remote = {
    weapons: [
      { id: 'a', name: 'Säbel' },
      { id: 'c', name: 'Bogen' },
    ],
  };
  assertEqual(
    mergeJson(base, local, remote).weapons.map((w) => w.id),
    ['a', 'c', 'b'],
  );
});

test(MERGE, 'Listen: Einträge werden einzeln zusammengeführt', () => {
  const base = { items: [{ id: 'a', name: 'Seil', count: 1 }] };
  const local = { items: [{ id: 'a', name: 'Seil (10 Schritt)', count: 1 }] };
  const remote = { items: [{ id: 'a', name: 'Seil', count: 3 }] };
  assertEqual(mergeJson(base, local, remote).items, [{ id: 'a', name: 'Seil (10 Schritt)', count: 3 }]);
});

test(MERGE, 'Löschen: bleibt gelöscht, außer die andere Seite hat den Eintrag geändert', () => {
  const base = {
    items: [
      { id: 'a', n: 1 },
      { id: 'b', n: 1 },
    ],
  };
  const local = { items: [{ id: 'b', n: 1 }] }; // a lokal gelöscht
  assertEqual(
    mergeJson(base, local, clone(base)).items.map((i) => i.id),
    ['b'],
    'gelöscht, Server unverändert',
  );
  const remoteChanged = {
    items: [
      { id: 'a', n: 2 },
      { id: 'b', n: 1 },
    ],
  };
  assertEqual(
    mergeJson(base, local, remoteChanged).items.map((i) => i.id),
    ['a', 'b'],
    'Server hat a geändert',
  );
  const remoteDeleted = { items: [{ id: 'a', n: 1 }] }; // b auf dem Server gelöscht
  assertEqual(mergeJson(base, local, remoteDeleted).items, [], 'beide Seiten haben je einen gelöscht');
});

test(MERGE, 'Ganzer Held: Meister zieht LE ab, Spieler ändert Talent', () => {
  const base = createHero();
  const local = clone(base);
  local.talents[2].fw = 7;
  const remote = clone(base);
  remote.base.le.current = 12;
  const merged = mergeJson(base, local, remote);
  assertEqual(merged.talents[2].fw, 7);
  assertEqual(merged.base.le.current, 12);
});

// ---------------------------------------------------------------------------
// Raum-Eingaben
// ---------------------------------------------------------------------------

const ROOM = 'Räume: Eingaben prüfen (room.js)';

test(ROOM, 'Raumcode normalisieren', () => {
  assertEqual(normalizeRoomCode(' k7m-pq2 '), 'K7MPQ2');
  assertEqual(normalizeRoomCode(null), '');
});

test(ROOM, 'Beitreten prüfen', () => {
  assertEqual(validateJoin({ code: 'K7MPQ2', displayName: 'Alrik' }), null);
  assertTrue(validateJoin({ code: 'K7M', displayName: 'Alrik' }).includes('6 Zeichen'), 'Code zu kurz');
  assertTrue(validateJoin({ code: 'K7MPQ2', displayName: '  ' }).includes('Namen'), 'Name fehlt');
  assertEqual(validateJoin({ code: 'K7MPQ2', displayName: 'A', asMaster: true }), null, 'Meister ohne PIN');
});

test(ROOM, 'Raum erstellen prüfen (ohne PIN)', () => {
  assertEqual(validateCreate({ displayName: 'Rahja' }), null);
  assertTrue(validateCreate({ displayName: '  ' }).includes('Namen'), 'Name fehlt');
  assertTrue(validateCreate({ displayName: 'x'.repeat(41) }).includes('40'), 'Name zu lang');
});

test(ROOM, 'Einladungslink', () => {
  assertEqual(
    inviteLink('K7MPQ2', { origin: 'https://gruppe.github.io', pathname: '/dsa/' }),
    'https://gruppe.github.io/dsa/?raum=K7MPQ2',
  );
});

// ---------------------------------------------------------------------------
// Fehlermeldungen vom Server
// ---------------------------------------------------------------------------

const ERRORS = 'Serverfehler verständlich machen (supabase.js)';

test(ERRORS, 'Netzwerkfehler → offline', () => {
  const error = toServerError(new TypeError('Failed to fetch'));
  assertEqual(error.offline, true);
  assertTrue(error.message.includes('Keine Verbindung'), error.message);
});

test(ERRORS, 'Fehlendes Schema, fehlende Rechte, eigene Meldungen', () => {
  assertTrue(
    toServerError({ code: 'PGRST202', message: 'Could not find the function' }).message.includes('schema.sql'),
    'Schema',
  );
  assertTrue(
    toServerError({
      code: 'PGRST204',
      message: "Could not find the 'le_max' column of 'tokens' in the schema cache",
    }).message.includes('schema.sql'),
    'Neue Spalte fehlt: schema.sql erneut ausführen',
  );
  assertTrue(
    toServerError({ code: '42501', message: 'new row violates row-level security policy' }).message.includes(
      'Berechtigung',
    ),
    'RLS',
  );
  assertEqual(
    toServerError({ code: 'P0002', message: 'Kein Raum mit diesem Code gefunden.' }).message,
    'Kein Raum mit diesem Code gefunden.',
  );
  assertTrue(
    toServerError({ message: 'Anonymous sign-ins are disabled' }).message.includes('anonymous sign-ins'),
    'Anonym aus',
  );
  assertTrue(
    toServerError({ code: '23505', message: 'duplicate key value violates unique constraint' }).message.includes(
      'bereits einen Helden',
    ),
    'doppelt',
  );
  assertEqual(
    toServerError({ code: '42501', message: 'Du kannst nur die Figur deines eigenen Helden bewegen.' }).message,
    'Du kannst nur die Figur deines eigenen Helden bewegen.',
    'eigene Berechtigungsmeldung bleibt',
  );
});

test(ERRORS, 'Projektadresse: Pfad und Schrägstriche am Ende werden entfernt', () => {
  const base = 'https://abcdefghijklm.supabase.co';
  assertEqual(projectUrl(base), base);
  assertEqual(projectUrl(`${base}/`), base, 'Schrägstrich');
  assertEqual(projectUrl(`${base}/rest/v1/`), base, 'API-Endpunkt aus dem Dashboard');
  assertEqual(projectUrl(` ${base}/rest/v1 `), base, 'Leerzeichen, ohne Schrägstrich');
  assertEqual(projectUrl(`${base}/auth/v1/signup`), base, 'andere Dienste');
});

test(ERRORS, 'Bildspeicher (Karte): verständliche Meldungen', () => {
  assertTrue(toServerError({ message: 'Bucket not found' }).message.includes('schema.sql'), 'Speicher fehlt');
  assertTrue(
    toServerError({ message: 'The object exceeded the maximum allowed size' }).message.includes('zu groß'),
    'zu groß',
  );
  assertTrue(toServerError({ message: 'mime type image/gif is not supported' }).message.includes('JPG'), 'Format');
  assertTrue(
    toServerError({ message: 'new row violates row-level security policy' }).message.includes('Berechtigung'),
    'nur Meister',
  );
});

// ---------------------------------------------------------------------------
// Abgleich eines Helden (mit Attrappen statt Server)
// ---------------------------------------------------------------------------

const SYNC = 'Abgleich mit dem Server (sync.js, mit Attrappen)';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let testCounter = 0;

/** Baut Store + Abgleich mit einer Speicherattrappe, die Aufrufe mitschreibt. */
function setup({ serverData = createHero(), saveImpl, fetchImpl, delay = 20 } = {}) {
  const id = `test-${Date.now()}-${(testCounter += 1)}`;
  const store = createHeroStore(null);
  const saved = [];
  const statuses = [];
  const events = [];
  store.subscribe((kind, source) => events.push({ kind, source }));
  const sync = createCharacterSync({
    id,
    store,
    serverData,
    delay,
    onStatus: (status) => statuses.push(status),
    save: saveImpl ?? (async (_id, data) => saved.push(clone(data))),
    fetchLatest: fetchImpl ?? (async () => null),
  });
  return { id, store, sync, saved, statuses, events };
}

async function cleanup({ id, sync }) {
  await sync.dispose({ save: false });
  localStorage.removeItem(`dsa5.held.${id}`);
}

test(SYNC, 'Änderungen werden verzögert und gebündelt gespeichert', async () => {
  const context = setup();
  const { store, saved, statuses } = context;
  store.hero.general.name = 'A';
  store.changed('value', null);
  store.hero.general.name = 'Alrik';
  store.changed('value', null);
  assertEqual(saved.length, 0, 'noch nicht sofort');
  await wait(60);
  assertEqual(saved.length, 1, 'genau ein Speichervorgang');
  assertEqual(saved[0].general.name, 'Alrik');
  assertEqual(statuses.at(-1), 'saved');
  assertEqual(readCachedCharacter(context.id).data.general.name, 'Alrik', 'auch im Gerätespeicher');
  await cleanup(context);
});

test(SYNC, 'Eigenes Echo vom Server ändert nichts', async () => {
  const context = setup();
  const { store, sync, saved, events } = context;
  store.hero.general.name = 'Alrik';
  store.changed('value', null);
  await wait(60);
  const eventsBefore = events.length;
  sync.applyRemote(clone(saved[0]));
  await wait(60);
  assertEqual(events.length, eventsBefore, 'keine neue Anzeige');
  assertEqual(saved.length, 1, 'kein erneutes Speichern');
  await cleanup(context);
});

test(SYNC, 'Änderung des Meisters erscheint sofort und wird nicht zurückgespeichert', async () => {
  const serverData = createHero();
  const context = setup({ serverData });
  const { store, sync, saved, events } = context;
  const remote = clone(serverData);
  remote.base.le.current = 12;
  sync.applyRemote(remote);
  assertEqual(store.hero.base.le.current, 12);
  assertEqual(events.at(-1), { kind: 'value', source: REMOTE });
  await wait(60);
  assertEqual(saved.length, 0);
  await cleanup(context);
});

test(SYNC, 'Gleichzeitige Änderungen werden zusammengeführt und gespeichert', async () => {
  const serverData = createHero();
  const context = setup({ serverData, delay: 40 });
  const { store, sync, saved } = context;
  store.hero.general.name = 'Alrik'; // lokal, noch nicht gespeichert
  store.changed('value', null);
  const remote = clone(serverData);
  remote.base.le.current = 9; // gleichzeitig vom Meister
  sync.applyRemote(remote);
  assertEqual(store.hero.general.name, 'Alrik', 'lokale Eingabe bleibt');
  assertEqual(store.hero.base.le.current, 9, 'Änderung des Meisters ist da');
  await wait(100);
  assertEqual(saved.at(-1).general.name, 'Alrik');
  assertEqual(saved.at(-1).base.le.current, 9);
  await cleanup(context);
});

test(SYNC, 'Neue Einträge vom Server bauen die Listen neu auf', async () => {
  const serverData = createHero();
  const context = setup({ serverData });
  const remote = clone(serverData);
  remote.weapons.push({ ...createWeapon(), name: 'Langschwert' });
  context.sync.applyRemote(remote);
  assertEqual(context.events.at(-1), { kind: 'structure', source: REMOTE });
  assertEqual(context.store.hero.weapons[0].name, 'Langschwert');
  await cleanup(context);
});

test(SYNC, 'Offline: Status „offline“, Stand im Gerätespeicher, später nachgeholt', async () => {
  let online = false;
  const serverData = createHero();
  const saved = [];
  const context = setup({
    serverData,
    saveImpl: async (_id, data) => {
      if (!online) throw new ServerError('Keine Verbindung', { offline: true });
      saved.push(clone(data));
    },
    fetchImpl: async () => {
      const remote = clone(serverData);
      remote.base.le.current = 5; // inzwischen vom Meister geändert
      return { data: remote };
    },
  });
  const { store, sync, statuses } = context;
  store.hero.general.notes = 'offline notiert';
  store.changed('value', null);
  await wait(60);
  assertEqual(statuses.at(-1), 'offline');
  assertEqual(readCachedCharacter(context.id).data.general.notes, 'offline notiert', 'im Gerätespeicher');
  online = true;
  await sync.resync();
  assertEqual(saved.length, 1, 'nach Wiederverbindung gespeichert');
  assertEqual(saved[0].general.notes, 'offline notiert');
  assertEqual(saved[0].base.le.current, 5, 'mit dem Serverstand zusammengeführt');
  assertEqual(statuses.at(-1), 'saved');
  await cleanup(context);
});

test(SYNC, 'Beim Start: ungespeicherte Änderungen vom Gerät werden übernommen', async () => {
  const base = createHero();
  const id = `start-${Date.now()}`;
  const local = clone(base);
  local.general.name = 'Offline-Name';
  localStorage.setItem(`dsa5.held.${id}`, JSON.stringify({ data: local, synced: base }));
  const server = clone(base);
  server.base.le.current = 3;
  const store = createHeroStore(null);
  const saved = [];
  const sync = createCharacterSync({
    id,
    store,
    serverData: server,
    delay: 20,
    onStatus: () => {},
    save: async (_id, data) => saved.push(clone(data)),
    fetchLatest: async () => null,
  });
  assertEqual(store.hero.general.name, 'Offline-Name');
  assertEqual(store.hero.base.le.current, 3);
  await wait(60);
  assertEqual(saved.length, 1, 'wird sofort nachgespeichert');
  await cleanup({ id, sync });
});

test(SYNC, 'Speicherfehler (nicht offline) wird gemeldet', async () => {
  const context = setup({
    saveImpl: async () => {
      throw new ServerError('Dafür fehlt dir die Berechtigung.');
    },
  });
  context.store.hero.general.name = 'X';
  context.store.changed('value', null);
  await wait(60);
  assertEqual(context.statuses.at(-1), 'error');
  await cleanup(context);
});

test(SYNC, 'Live-Meldung ohne Heldendaten wird ignoriert (kein leerer Held)', async () => {
  const serverData = createHero();
  serverData.general.name = 'Alrik';
  const context = setup({ serverData });
  context.sync.applyRemote(undefined);
  context.sync.applyRemote(null);
  assertEqual(context.store.hero.general.name, 'Alrik');
  await wait(60);
  assertEqual(context.saved.length, 0);
  await cleanup(context);
});

test('Hilfsfunktionen (util.js)', 'Zeitstempel vom Server: ISO und Postgres-Schreibweise, immer UTC', () => {
  const iso = timestampMs('2026-09-30T20:19:04.470123+00:00');
  assertEqual(iso, Date.UTC(2026, 8, 30, 20, 19, 4, 470));
  assertEqual(timestampMs('2026-09-30 20:19:04.470123+00'), iso, 'Postgres-Schreibweise');
  assertEqual(timestampMs('2026-09-30 22:19:04.470+02'), iso, 'andere Zeitzone');
  assertTrue(Number.isNaN(timestampMs(null)) && Number.isNaN(timestampMs('kaputt')), 'unlesbar');
  assertTrue(isOlderTimestamp('2026-09-30T20:19:04+00:00', '2026-09-30 20:19:05+00'), 'älter');
  assertTrue(!isOlderTimestamp('2026-09-30T20:19:05+00:00', '2026-09-30T20:19:04+00:00'), 'neuer');
  assertTrue(!isOlderTimestamp(undefined, '2026-09-30T20:19:04+00:00'), 'ohne Zeitstempel nie älter');
});
