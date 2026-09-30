/**
 * map.test.js – Tests für Karte und Figuren: Raster, Einrasten, Namen, Aufstellen,
 * Ansicht (map.js) und die Karten-Steuerung im Raum (room-map.js) mit Attrappen.
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  defaultGrid,
  normalizeGrid,
  gridSizeFromCells,
  cellsAcross,
  snapToGrid,
  clampToMap,
  numberedNames,
  initials,
  colorForIndex,
  placeTokens,
  tokensForTurn,
  mapNameFromFile,
  scaledSize,
  fitView,
  zoomLimits,
  clampView,
  screenToMap,
  mapToScreen,
  zoomAt,
  pinchView,
  normalizeRect,
  tokensInRect,
  moveGroup,
  MIN_GRID_SIZE,
  MAX_GRID_SIZE,
  MAX_ZOOM,
  TOKEN_COLORS,
} from '../js/map.js';
import { createMapController, chooseViewMap } from '../js/room-map.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAP = { width: 1000, height: 800 };
const GRID = { show: true, size: 50, offsetX: 10, offsetY: 20, color: 'dunkel' };
const close = (actual, expected, label) =>
  assertTrue(Math.abs(actual - expected) < 1e-9, `${label}: erwartet ${expected}, erhalten ${actual}`);

test('Karte: Raster', 'Neue Karte: etwa 30 Felder auf der längeren Seite, Raster aus', () => {
  assertEqual(defaultGrid(3000, 2000), { show: false, size: 100, offsetX: 0, offsetY: 0, color: 'dunkel' });
  assertEqual(defaultGrid(100, 100).size, MIN_GRID_SIZE, 'nie kleiner als das Minimum');
});

test('Karte: Raster', 'Gespeicherte Werte werden vervollständigt und begrenzt', () => {
  assertEqual(normalizeGrid(null, MAP), defaultGrid(MAP.width, MAP.height), 'fehlend → Standard');
  assertEqual(normalizeGrid({ show: true, size: 5000 }, MAP).size, MAX_GRID_SIZE, 'zu groß');
  assertEqual(normalizeGrid({ size: 2 }, MAP).size, MIN_GRID_SIZE, 'zu klein');
  assertEqual(normalizeGrid({ size: '48,5' }, MAP).size, 48.5, 'Komma als Dezimaltrenner');
  assertEqual(normalizeGrid({ show: 'ja' }, MAP).show, false, 'nur true schaltet ein');
  assertEqual(normalizeGrid({ color: 'pink' }, MAP).color, 'dunkel', 'unbekannte Farbe');
});

test('Karte: Raster', 'Versatz liegt immer innerhalb eines Feldes', () => {
  const grid = normalizeGrid({ size: 50, offsetX: 120, offsetY: -10 }, MAP);
  assertEqual([grid.offsetX, grid.offsetY], [20, 40]);
  assertEqual(normalizeGrid({ size: 50, offsetX: 49.999 }, MAP).offsetX, 0, 'gerundet auf ein ganzes Feld');
});

test('Karte: Raster', 'Feldgröße aus der Anzahl Felder in der Breite', () => {
  assertEqual(gridSizeFromCells(1000, 20), 50);
  assertEqual(gridSizeFromCells(1000, 3), 333.33, 'auf zwei Nachkommastellen');
  assertEqual(gridSizeFromCells(1000, 0), MAX_GRID_SIZE, 'ungültige Anzahl → begrenzt');
  assertEqual(cellsAcross(1000, 48), 20.8);
});

test('Karte: Einrasten', 'Figur mit 1 Feld rastet auf die Feldmitte (mit Versatz)', () => {
  assertEqual(snapToGrid({ x: 12, y: 21 }, 1, GRID), { x: 35, y: 45 });
  assertEqual(snapToGrid({ x: 59.9, y: 69.9 }, 1, GRID), { x: 35, y: 45 }, 'noch im selben Feld');
  assertEqual(snapToGrid({ x: 60, y: 70 }, 1, GRID), { x: 85, y: 95 }, 'nächstes Feld');
  assertEqual(snapToGrid({ x: 5, y: 5 }, 1, GRID), { x: -15, y: -5 }, 'Feld links oben vor dem Versatz');
  assertEqual(snapToGrid({ x: 12, y: 21 }, 0.5, GRID), { x: 35, y: 45 }, 'kleine Figur ebenfalls Mitte');
  assertEqual(snapToGrid({ x: 12, y: 21 }, 3, GRID), { x: 35, y: 45 }, '3 × 3: Mitte des mittleren Feldes');
});

test('Karte: Einrasten', 'Figur mit 2 oder 4 Feldern rastet auf den Schnittpunkt der Linien', () => {
  assertEqual(snapToGrid({ x: 80, y: 80 }, 2, GRID), { x: 60, y: 70 });
  assertEqual(snapToGrid({ x: 90, y: 100 }, 4, GRID), { x: 110, y: 120 });
});

test('Karte: Einrasten', 'Ohne sichtbares Raster bleibt die Position frei', () => {
  assertEqual(snapToGrid({ x: 12.3, y: 45.6 }, 1, { ...GRID, show: false }), { x: 12.3, y: 45.6 });
});

test('Karte: Einrasten', 'Positionen bleiben auf der Karte', () => {
  assertEqual(clampToMap({ x: -5, y: 900 }, MAP), { x: 0, y: 800 });
  assertEqual(clampToMap({ x: 500, y: 400 }, MAP), { x: 500, y: 400 });
});

test('Karte: Figuren', 'Namen: einzeln ohne Nummer, mehrere fortlaufend', () => {
  assertEqual(numberedNames('Ork', 1), ['Ork']);
  assertEqual(numberedNames('  Ork  ', 3), ['Ork 1', 'Ork 2', 'Ork 3']);
  assertEqual(numberedNames('', 1), ['Figur'], 'leerer Name');
  assertEqual(numberedNames('Ork', 99).length, 20, 'höchstens 20 auf einmal');
});

test('Karte: Figuren', 'Namen: Nummerierung setzt vorhandene Figuren fort', () => {
  assertEqual(numberedNames('Ork', 2, ['Ork 1', 'Ork 2', 'Goblin 7']), ['Ork 3', 'Ork 4']);
  assertEqual(numberedNames('Ork', 1, ['Ork']), ['Ork 2'], 'gleicher Name schon da');
  assertEqual(numberedNames('Ork', 1, ['Orkan 5']), ['Ork'], 'nur exakt gleiche Namen zählen');
  assertEqual(numberedNames('Ork (groß)', 2, ['Ork (groß) 1']), ['Ork (groß) 2', 'Ork (groß) 3'], 'Sonderzeichen');
});

test('Karte: Figuren', 'Kürzel und Farben', () => {
  assertEqual(initials('Alrik Wolfsfell'), 'AW');
  assertEqual(initials('Ork 12'), 'O12');
  assertEqual(initials('rahja'), 'R');
  assertEqual(initials('   '), '?');
  assertEqual(colorForIndex(0), TOKEN_COLORS[0].id);
  assertEqual(colorForIndex(TOKEN_COLORS.length + 1), TOKEN_COLORS[1].id, 'reihum');
});

test('Karte: Figuren', 'Neue Figuren: erst die Mitte, dann links/rechts, dann oben/unten', () => {
  const free = { ...GRID, show: false, offsetX: 0, offsetY: 0 };
  assertEqual(placeTokens(3, { x: 500, y: 400 }, 1, free, MAP), [
    { x: 500, y: 400 },
    { x: 450, y: 400 },
    { x: 550, y: 400 },
  ]);
  const seven = placeTokens(7, { x: 500, y: 400 }, 1, free, MAP);
  assertEqual(seven.slice(3), [
    { x: 500, y: 350 },
    { x: 500, y: 450 },
    { x: 450, y: 350 },
    { x: 550, y: 350 },
  ]);
  assertEqual(placeTokens(1, { x: 12, y: 21 }, 1, GRID, MAP), [{ x: 35, y: 45 }], 'eingerastet');
});

test('Karte: Figuren', 'Neue Figuren meiden besetzte Felder und bleiben auf der Karte', () => {
  const free = { ...GRID, show: false, offsetX: 0, offsetY: 0 };
  assertEqual(placeTokens(2, { x: 500, y: 400 }, 1, free, MAP, [{ x: 500, y: 400 }]), [
    { x: 450, y: 400 },
    { x: 550, y: 400 },
  ]);
  const edge = placeTokens(4, { x: 0, y: 0 }, 1, free, MAP);
  assertTrue(
    edge.every((point) => point.x >= 0 && point.y >= 0 && point.x <= MAP.width && point.y <= MAP.height),
    'am Rand alle auf der Karte',
  );
  assertEqual(new Set(edge.map((point) => `${point.x}/${point.y}`)).size, 4, 'keine zwei auf demselben Platz');
  const tiny = { width: 60, height: 60 };
  assertEqual(placeTokens(3, { x: 30, y: 30 }, 1, free, tiny).length, 3, 'Karte voll: trotzdem alle aufgestellt');
});

test('Karte: Figuren', 'Am Zug: Held über die ID, Gegner über den Namen', () => {
  const tokens = [
    { id: 't1', character_id: 'c1', name: 'Alrik' },
    { id: 't2', character_id: null, name: 'Ork 2' },
    { id: 't3', character_id: null, name: 'Ork 1' },
    { id: 't4', character_id: 'c2', name: 'Ork 2' },
  ];
  assertEqual(tokensForTurn(tokens, { characterId: 'c1', name: 'Alrik Wolfsfell' }), ['t1']);
  assertEqual(tokensForTurn(tokens, { characterId: null, name: 'Ork 2' }), ['t2']);
  assertEqual(tokensForTurn(tokens, null), []);
});

test('Karte: Auswahl', 'Auswahlrechteck in jede Richtung aufziehen', () => {
  assertEqual(normalizeRect({ x: 300, y: 50 }, { x: 100, y: 200 }), { left: 100, top: 50, right: 300, bottom: 200 });
});

test('Karte: Auswahl', 'Rechteck erfasst alle Figuren, die es berührt (Figuren sind Kreise)', () => {
  const tokens = [
    { id: 'innen', x: 150, y: 100, size: 1 },
    { id: 'Rand', x: 100, y: 100, size: 1 }, // Radius 25, Rechteck beginnt 20 daneben
    { id: 'knapp daneben', x: 100, y: 300, size: 1 }, // 30 entfernt
    { id: 'Ecke', x: 102, y: 38, size: 1 }, // diagonal 25,46 entfernt: Quadrat ja, Kreis nein
    { id: 'groß', x: 400, y: 100, size: 4 }, // Radius 100
  ];
  const rect = normalizeRect({ x: 120, y: 56 }, { x: 320, y: 270 });
  assertEqual(tokensInRect(tokens, rect, GRID), ['innen', 'Rand', 'groß']);
  assertEqual(tokensInRect(tokens, normalizeRect({ x: 0, y: 0 }, { x: 5, y: 5 }), GRID), [], 'leere Fläche');
});

test('Karte: Auswahl', 'Gruppe bewegen: gezogene Figur rastet ein, die Formation bleibt', () => {
  const group = [
    { id: 'a', x: 35, y: 45, size: 1 },
    { id: 'b', x: 85, y: 45, size: 1 },
    { id: 'c', x: 110, y: 120, size: 2 },
  ];
  assertEqual(moveGroup(group, 'a', { x: 240, y: 250 }, GRID, MAP), [
    { id: 'a', x: 235, y: 245 },
    { id: 'b', x: 285, y: 245 },
    { id: 'c', x: 310, y: 320 },
  ]);
  assertEqual(
    moveGroup(group, 'b', { x: 100, y: 60 }, { ...GRID, show: false }, MAP),
    [
      { id: 'a', x: 50, y: 60 },
      { id: 'b', x: 100, y: 60 },
      { id: 'c', x: 125, y: 135 },
    ],
    'ohne Raster frei',
  );
});

test('Karte: Auswahl', 'Gruppe bewegen: am Kartenrand bleiben alle auf der Karte', () => {
  const group = [
    { id: 'a', x: 35, y: 45, size: 1 },
    { id: 'b', x: 85, y: 45, size: 1 },
    { id: 'c', x: 110, y: 120, size: 2 },
  ];
  const moves = moveGroup(group, 'a', { x: 5000, y: 30 }, GRID, MAP);
  assertEqual(moves[0], { id: 'a', x: 985, y: 45 }, 'gezogene Figur auf das letzte Feld');
  assertTrue(
    moves.every((move) => move.x >= 0 && move.x <= MAP.width && move.y >= 0 && move.y <= MAP.height),
    JSON.stringify(moves),
  );
});

test('Karte: Bilder', 'Kartenname aus Dateiname, Verkleinern ohne Vergrößern', () => {
  assertEqual(mapNameFromFile('dunkle_hoehle-2.jpg'), 'dunkle hoehle 2');
  assertEqual(mapNameFromFile('.png'), 'Karte');
  assertEqual(scaledSize(6000, 3000, 3000), { width: 3000, height: 1500 });
  assertEqual(scaledSize(1200, 800, 3000), { width: 1200, height: 800 }, 'kleine Bilder bleiben');
  assertEqual(scaledSize(1000, 3001, 3000), { width: 1000, height: 3000 });
});

test('Karte: Ansicht', 'Einpassen: ganze Karte mittig', () => {
  const view = fitView({ width: 400, height: 400 }, MAP, 0);
  assertEqual(view, { scale: 0.4, x: 0, y: 40 });
  assertEqual(
    fitView({ width: 4000, height: 4000 }, { width: 10, height: 10 }, 0).scale,
    MAX_ZOOM,
    'höchstens MAX_ZOOM',
  );
});

test('Karte: Ansicht', 'Umrechnen Bildschirm ↔ Karte', () => {
  const view = { scale: 2, x: 10, y: -20 };
  assertEqual(screenToMap(view, { x: 110, y: 180 }), { x: 50, y: 100 });
  assertEqual(mapToScreen(view, { x: 50, y: 100 }), { x: 110, y: 180 });
});

test('Karte: Ansicht', 'Zoomen hält den Punkt unter dem Finger fest und bleibt in den Grenzen', () => {
  const limits = zoomLimits({ width: 400, height: 400 }, MAP);
  close(limits.min, 0.2, 'kleinste Vergrößerung = halbe Einpassung');
  const view = { scale: 1, x: 0, y: 0 };
  const zoomed = zoomAt(view, 2, { x: 100, y: 50 }, limits);
  assertEqual(screenToMap(zoomed, { x: 100, y: 50 }), { x: 100, y: 50 }, 'Punkt bleibt');
  assertEqual(zoomAt(view, 100, { x: 0, y: 0 }, limits).scale, MAX_ZOOM, 'nicht über MAX_ZOOM');
  assertEqual(zoomAt(view, 0.001, { x: 0, y: 0 }, limits).scale, limits.min, 'nicht unter Minimum');
});

test('Karte: Ansicht', 'Zwei Finger: auseinander = größer, Mitte wandert mit', () => {
  const limits = { min: 0.1, max: 4 };
  const start = { distance: 100, center: { x: 200, y: 200 } };
  const now = { distance: 200, center: { x: 220, y: 190 } };
  const view = pinchView({ scale: 1, x: 0, y: 0 }, start, now, limits);
  assertEqual(view.scale, 2);
  assertEqual(screenToMap(view, now.center), { x: 200, y: 200 }, 'Kartenpunkt folgt den Fingern');
});

test('Karte: Ansicht', 'Die Karte lässt sich nie ganz aus dem Bild schieben', () => {
  const viewport = { width: 400, height: 300 };
  assertEqual(clampView({ scale: 1, x: 5000, y: -5000 }, viewport, MAP), { scale: 1, x: 200, y: -650 });
  assertEqual(clampView({ scale: 1, x: -100, y: -100 }, viewport, MAP), { scale: 1, x: -100, y: -100 }, 'innen frei');
});

// ---------------------------------------------------------------------------
// Karten-Steuerung im Raum (room-map.js) mit Attrappen statt Server
// ---------------------------------------------------------------------------

const CONTROLLER = 'Karten-Steuerung im Raum (room-map.js, mit Attrappen)';
let roomCounter = 0;

/** Attrappe der Serverfunktionen (map-api.js) mit einer kleinen Datenbank im Speicher. */
function fakeApi(overrides = {}) {
  const calls = [];
  const db = { maps: [], tokens: [] };
  let counter = 0;
  const api = {
    calls,
    db,
    fetchMaps: async () => db.maps.map((map) => ({ ...map })),
    fetchTokens: async (mapId) => db.tokens.filter((token) => token.map_id === mapId).map((token) => ({ ...token })),
    createMap: async (fields) => {
      const map = { id: `m${(counter += 1)}`, revision: 0, ...fields };
      db.maps.push(map);
      return { ...map };
    },
    updateMap: async (mapId, changes) => {
      calls.push(['updateMap', mapId, changes]);
      const map = db.maps.find((entry) => entry.id === mapId);
      Object.assign(map, changes);
      return { ...map };
    },
    deleteMap: async (mapId) => {
      db.maps = db.maps.filter((map) => map.id !== mapId);
      db.tokens = db.tokens.filter((token) => token.map_id !== mapId);
    },
    setActiveMap: async (roomId, mapId) => calls.push(['setActiveMap', mapId]),
    createTokens: async (rows) =>
      rows.map((row) => {
        const token = { id: `t${(counter += 1)}`, ...row };
        db.tokens.push(token);
        return { ...token };
      }),
    updateToken: async (tokenId, changes) => {
      const token = db.tokens.find((entry) => entry.id === tokenId);
      Object.assign(token, changes);
      return { ...token };
    },
    deleteToken: async (tokenId) => {
      db.tokens = db.tokens.filter((token) => token.id !== tokenId);
    },
    moveToken: async (...args) => calls.push(['moveToken', ...args]),
    fetchHeroTokenImages: async () => new Map([['c1', 'raum/alrik.webp']]),
    uploadImage: async () => 'raum/neu.webp',
    discardUpload: async (path) => calls.push(['discardUpload', path]),
    removeUnusedImages: async (roomId, paths) => calls.push(['removeUnusedImages', paths]),
    ...overrides,
  };
  return api;
}

const fakeImages = {
  prepareMapImage: async () => ({ blob: new Blob(['x'], { type: 'image/webp' }), width: 1000, height: 800 }),
  prepareTokenImage: async () => new Blob(['x'], { type: 'image/webp' }),
};

function mapController({
  master = true,
  api = fakeApi(),
  characters = [],
  onShown = () => {},
  onError = () => {},
} = {}) {
  roomCounter += 1;
  const roomId = `testraum-${Date.now()}-${roomCounter}`;
  const controller = createMapController({
    roomId,
    isMaster: () => master,
    characters: () => characters,
    onShown,
    onError,
    api,
    images: fakeImages,
  });
  return { controller, api, roomId, cleanup: () => localStorage.removeItem(`dsa5.karte.${roomId}`) };
}

function addMap(api, id, extra = {}) {
  api.db.maps.push({
    id,
    room_id: 'x',
    name: id,
    image_path: `raum/${id}.webp`,
    width: 1000,
    height: 800,
    grid: {},
    revision: 0,
    ...extra,
  });
}

test(CONTROLLER, 'Welche Karte wird angezeigt?', () => {
  const maps = [{ id: 'a' }, { id: 'b' }];
  assertEqual(
    chooseViewMap({ maps, activeMapId: 'b', preferredMapId: 'a', isMaster: false }),
    'b',
    'Spieler: gezeigte',
  );
  assertEqual(chooseViewMap({ maps, activeMapId: null, preferredMapId: 'a', isMaster: false }), null, 'Spieler: keine');
  assertEqual(
    chooseViewMap({ maps, activeMapId: 'b', preferredMapId: 'a', isMaster: true }),
    'a',
    'Meister: Vorbereitung',
  );
  assertEqual(
    chooseViewMap({ maps, activeMapId: 'b', preferredMapId: 'weg', isMaster: true }),
    'b',
    'Meister: gezeigte',
  );
  assertEqual(chooseViewMap({ maps, activeMapId: null, preferredMapId: null, isMaster: true }), 'a', 'Meister: erste');
});

test(CONTROLLER, 'Spieler: gezeigte Karte laden, Wechsel des Meisters live mitbekommen', async () => {
  const shown = [];
  const { controller, api, cleanup } = mapController({ master: false, onShown: (map) => shown.push(map.id) });
  addMap(api, 'm1');
  addMap(api, 'm2');
  api.db.tokens.push({ id: 't1', map_id: 'm1', name: 'Alrik', x: 10, y: 10 });
  controller.handleRoomRow({ active_map_id: 'm1' });
  await controller.load();
  assertEqual(controller.state.get().status, 'ready');
  assertEqual(controller.viewMap().id, 'm1');
  assertEqual(
    controller.state.get().tokens.map((token) => token.id),
    ['t1'],
  );
  controller.handleRoomRow({ active_map_id: 'm2' });
  await wait(0);
  await wait(0);
  assertEqual(controller.viewMap().id, 'm2', 'folgt der gezeigten Karte');
  assertEqual(controller.state.get().tokens, [], 'Figuren der neuen Karte');
  assertEqual(shown, ['m2'], 'Meldung „Meister zeigt Karte“');
  cleanup();
});

test(CONTROLLER, 'Karten-Revision: Figuren neu laden (verborgen oder entfernt)', async () => {
  const { controller, api, roomId, cleanup } = mapController({ master: false });
  addMap(api, 'm1');
  api.db.tokens.push(
    { id: 't1', map_id: 'm1', name: 'A', x: 0, y: 0 },
    { id: 't2', map_id: 'm1', name: 'B', x: 0, y: 0 },
  );
  controller.handleRoomRow({ active_map_id: 'm1' });
  await controller.load();
  api.db.tokens = api.db.tokens.filter((token) => token.id !== 't2');
  controller.handleMapRow({ ...api.db.maps[0], room_id: 'anderer-raum', revision: 1 });
  await wait(0);
  assertEqual(controller.state.get().tokens.length, 2, 'fremder Raum wird ignoriert');
  controller.handleMapRow({ ...api.db.maps[0], room_id: roomId, revision: 1 });
  await wait(0);
  assertEqual(
    controller.state.get().tokens.map((token) => token.id),
    ['t1'],
  );
  cleanup();
});

test(CONTROLLER, 'Figur bewegen: sofort sichtbar, bei Fehler zurück an den alten Platz', async () => {
  const api = fakeApi({
    moveToken: async () => {
      throw new Error('Du kannst nur die Figur deines eigenen Helden bewegen.');
    },
  });
  const { controller, cleanup } = mapController({ master: false, api });
  addMap(api, 'm1');
  api.db.tokens.push({ id: 't1', map_id: 'm1', name: 'A', x: 100, y: 100 });
  controller.handleRoomRow({ active_map_id: 'm1' });
  await controller.load();
  const moving = controller.actions.moveToken('t1', { x: 300, y: 5000 });
  assertEqual(controller.state.get().tokens[0].y, 800, 'sofort, auf die Karte begrenzt');
  let failed = false;
  await moving.catch(() => (failed = true));
  assertTrue(failed, 'Fehler wird weitergegeben');
  assertEqual([controller.state.get().tokens[0].x, controller.state.get().tokens[0].y], [100, 100], 'zurückgesetzt');
  cleanup();
});

test(CONTROLLER, 'Mehrere Figuren bewegen: alle sofort, abgelehnte zurück', async () => {
  const api = fakeApi({
    moveToken: async (id) => {
      if (id === 't2') throw new Error('Diese Figur gibt es nicht mehr.');
    },
  });
  const { controller, cleanup } = mapController({ api });
  addMap(api, 'm1');
  api.db.tokens.push(
    { id: 't1', map_id: 'm1', name: 'A', x: 100, y: 100 },
    { id: 't2', map_id: 'm1', name: 'B', x: 150, y: 100 },
    { id: 't3', map_id: 'm1', name: 'C', x: 500, y: 500 },
  );
  await controller.load();
  const moving = controller.actions.moveTokens([
    { id: 't1', x: 300, y: 300 },
    { id: 't2', x: 350, y: 300 },
    { id: 'weg', x: 1, y: 1 },
  ]);
  const position = (id) => {
    const token = controller.state.get().tokens.find((entry) => entry.id === id);
    return [token.x, token.y];
  };
  assertEqual(
    [position('t1'), position('t2')],
    [
      [300, 300],
      [350, 300],
    ],
    'sofort',
  );
  assertEqual(
    controller.state.get().tokens.map((token) => token.id),
    ['t3', 't1', 't2'],
    'bewegte Figuren liegen oben',
  );
  let error = null;
  await moving.catch((caught) => (error = caught));
  assertEqual(error?.message, 'Diese Figur gibt es nicht mehr.');
  assertEqual(
    [position('t1'), position('t2'), position('t3')],
    [
      [300, 300],
      [150, 100],
      [500, 500],
    ],
  );
  cleanup();
});

test(CONTROLLER, 'Meister: mehrere Figuren verbergen und entfernen', async () => {
  const { controller, api, cleanup } = mapController();
  addMap(api, 'm1');
  api.db.tokens.push(
    { id: 't1', map_id: 'm1', name: 'A', image_path: 'raum/a.webp', x: 0, y: 0, hidden: false },
    { id: 't2', map_id: 'm1', name: 'B', image_path: null, x: 0, y: 0, hidden: false },
    { id: 't3', map_id: 'm1', name: 'C', image_path: 'raum/c.webp', x: 0, y: 0, hidden: false },
  );
  await controller.load();
  await controller.actions.setTokensHidden(['t1', 't2'], true);
  assertEqual(
    controller.state
      .get()
      .tokens.filter((token) => token.hidden)
      .map((token) => token.id),
    ['t1', 't2'],
  );
  await controller.actions.removeTokens(['t1', 't2']);
  assertEqual(
    controller.state.get().tokens.map((token) => token.id),
    ['t3'],
  );
  assertEqual(api.calls.at(-1), ['removeUnusedImages', ['raum/a.webp']], 'nur vorhandene Bilder');
  cleanup();
});

test(CONTROLLER, 'Meister: Entfernen, das teilweise scheitert, entfernt den Rest', async () => {
  const api = fakeApi();
  const deleteToken = api.deleteToken;
  api.deleteToken = async (id) => {
    if (id === 't2') throw new Error('Keine Verbindung zum Server.');
    return deleteToken(id);
  };
  const { controller, cleanup } = mapController({ api });
  addMap(api, 'm1');
  api.db.tokens.push(
    { id: 't1', map_id: 'm1', name: 'A', x: 0, y: 0 },
    { id: 't2', map_id: 'm1', name: 'B', x: 0, y: 0 },
  );
  await controller.load();
  let error = null;
  await controller.actions.removeTokens(['t1', 't2']).catch((caught) => (error = caught));
  assertEqual(error?.message, 'Keine Verbindung zum Server.');
  assertEqual(
    controller.state.get().tokens.map((token) => token.id),
    ['t2'],
  );
  cleanup();
});

test(CONTROLLER, 'Meister: Karte hochladen, vorbereiten, zeigen', async () => {
  const { controller, api, cleanup } = mapController();
  await controller.load();
  const map = await controller.actions.uploadMap(new Blob(['x']), '  Taverne  ');
  assertEqual(map.name, 'Taverne');
  assertEqual(map.grid.show, false, 'Raster zunächst aus');
  assertEqual(controller.viewMap().id, map.id, 'neue Karte wird angezeigt');
  assertEqual(controller.state.get().activeMapId, null, '… aber noch nicht gezeigt');
  await controller.actions.showMap(map.id);
  assertEqual(api.calls.at(-1), ['setActiveMap', map.id]);
  assertEqual(controller.state.get().activeMapId, map.id);
  cleanup();
});

test(CONTROLLER, 'Meister: misslingt das Anlegen, wird das Bild wieder gelöscht', async () => {
  const api = fakeApi({
    createMap: async () => {
      throw new Error('Serverfehler');
    },
  });
  const { controller, cleanup } = mapController({ api });
  await controller.load();
  await controller.actions.uploadMap(new Blob(['x']), 'Taverne').catch(() => {});
  await wait(0);
  assertEqual(api.calls.at(-1), ['discardUpload', 'raum/neu.webp']);
  cleanup();
});

test(CONTROLLER, 'Meister: Figuren aufstellen – nummeriert, auf freien Feldern, Helden mit Bild', async () => {
  const characters = [{ id: 'c1', data: { general: { name: 'Alrik' } } }];
  const { controller, api, cleanup } = mapController({ characters });
  addMap(api, 'm1', { grid: { show: true, size: 50, offsetX: 0, offsetY: 0 } });
  await controller.load();
  const heroes = await controller.actions.addHeroes({ x: 510, y: 410 });
  assertEqual(
    heroes.map((token) => [token.name, token.image_path, token.x, token.y]),
    [['Alrik', 'raum/alrik.webp', 525, 425]],
  );
  assertEqual(await controller.actions.addHeroes({ x: 510, y: 410 }), [], 'kein Held doppelt');
  const orks = await controller.actions.addTokens(
    { name: 'Ork', count: 2, size: 1, color: 'gruen' },
    { x: 510, y: 410 },
  );
  assertEqual(
    orks.map((token) => token.name),
    ['Ork 1', 'Ork 2'],
  );
  assertTrue(!orks.some((token) => token.x === 525 && token.y === 425), 'nicht auf Alriks Feld');
  const more = await controller.actions.addTokens(
    { name: 'Ork', count: 1, size: 1, color: 'gruen' },
    { x: 510, y: 410 },
  );
  assertEqual(more[0].name, 'Ork 3', 'Nummerierung geht weiter');
  cleanup();
});

test(CONTROLLER, 'Meister: Figur entfernen räumt ihr Bild auf; Raster wird gesammelt gespeichert', async () => {
  const { controller, api, cleanup } = mapController();
  addMap(api, 'm1');
  api.db.tokens.push({ id: 't1', map_id: 'm1', name: 'Späher', image_path: 'raum/spaeher.webp', x: 0, y: 0 });
  await controller.load();
  await controller.actions.removeToken('t1');
  assertEqual(controller.state.get().tokens, []);
  assertEqual(api.calls.at(-1), ['removeUnusedImages', ['raum/spaeher.webp']]);
  controller.actions.updateGrid({ show: true });
  controller.actions.updateGrid({ size: 40 });
  controller.actions.updateGrid({ size: 42 });
  assertEqual(controller.viewMap().grid.size, 42, 'sofort sichtbar');
  await controller.actions.flushGrid();
  const saves = api.calls.filter((call) => call[0] === 'updateMap');
  assertEqual(saves.length, 1, 'eine Speicherung');
  assertEqual([saves[0][2].grid.show, saves[0][2].grid.size], [true, 42]);
  cleanup();
});
