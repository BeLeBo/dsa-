/**
 * map-editor.test.js – Tests für den Karten-Editor (map-editor.js): Szene, Gelände malen,
 * Objekte setzen/verschieben/drehen und der Zufallsgenerator für fertige Karten.
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  createScene,
  normalizeScene,
  sceneSize,
  sceneGrid,
  setGround,
  terrainAt,
  brushCells,
  paintTerrain,
  paintStroke,
  addObject,
  updateObject,
  moveObject,
  removeObject,
  footprintSize,
  snapObject,
  drawOrder,
  objectAt,
  createRandom,
  generateScene,
  CELL_PX,
  MAX_CELLS,
  MIN_CELLS,
  MAX_OBJECTS,
  SCENE_SIZES,
  THEMES,
  OBJECTS,
} from '../js/map-editor.js';
import { MAP_MAX_EDGE } from '../js/map.js';

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 98765];

/** Alle Felder, die kein Fels sind, hängen zusammen? */
function openCellsConnected(scene) {
  const { cols, rows, terrain } = scene;
  const open = (index) => terrain[index] !== 'f';
  const start = terrain.split('').findIndex((_, index) => open(index));
  if (start < 0) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const index = stack.pop();
    const x = index % cols;
    const y = (index - x) / cols;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      const next = ny * cols + nx;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && open(next) && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return terrain.split('').every((_, index) => !open(index) || seen.has(index));
}

const count = (scene, ...types) => scene.objects.filter((object) => types.includes(object.type)).length;

test('Karten-Editor: Szene', 'Neue Szene: Größe begrenzt, alles Untergrund, keine Objekte', () => {
  const scene = createScene({ cols: 20, rows: 15, ground: 'sand' });
  assertEqual([scene.cols, scene.rows, scene.ground], [20, 15, 'sand']);
  assertEqual(scene.terrain, '.'.repeat(300));
  assertEqual(scene.objects, []);
  const tiny = createScene({ cols: 2, rows: 500, ground: 'lava' });
  assertEqual(
    [tiny.cols, tiny.rows, tiny.ground],
    [MIN_CELLS, MAX_CELLS, 'gras'],
    'begrenzt, unbekannter Boden → Gras',
  );
});

test('Karten-Editor: Szene', 'Das fertige Bild passt auch bei größter Szene unter die Kartengrenze', () => {
  const size = sceneSize(createScene({ cols: MAX_CELLS, rows: MAX_CELLS }));
  assertTrue(size.width <= MAP_MAX_EDGE && size.height <= MAP_MAX_EDGE, `${size.width} × ${size.height}`);
  assertEqual(sceneSize(createScene({ cols: 30, rows: 20 })), { width: 30 * CELL_PX, height: 20 * CELL_PX });
  assertEqual(sceneGrid(), { show: true, size: CELL_PX, offsetX: 0, offsetY: 0, color: 'dunkel' });
  for (const entry of SCENE_SIZES) assertTrue(entry.cols <= MAX_CELLS && entry.rows <= MAX_CELLS, entry.id);
});

test(
  'Karten-Editor: Szene',
  'Gespeicherte Szene wird repariert: falsches Gelände, unbekannte Objekte, doppelte Kennungen',
  () => {
    const raw = {
      cols: 10,
      rows: 10,
      ground: 'schnee',
      terrain: 'wX~'.padEnd(100, '.'),
      objects: [
        { id: 'o1', type: 'laubbaum', x: 3, y: 4, rot: -90, scale: 9, seed: 5 },
        { id: 'o1', type: 'stein', x: 50, y: -3 },
        { id: 'o7', type: 'raumschiff', x: 1, y: 1 },
        'Unsinn',
        { type: 'fass', x: '2,5', y: 2 },
      ],
    };
    const scene = normalizeScene(raw);
    assertEqual(scene.terrain.slice(0, 3), 'w.~', 'unbekanntes Zeichen → Untergrund');
    assertEqual(scene.ground, 'schnee');
    assertEqual(
      scene.objects.map((object) => object.type),
      ['laubbaum', 'stein', 'fass'],
    );
    assertEqual(scene.objects[0], { id: 'o1', type: 'laubbaum', x: 3, y: 4, rot: 270, scale: 3, seed: 5 });
    assertEqual([scene.objects[1].x, scene.objects[1].y], [10, 0], 'auf die Karte begrenzt');
    const ids = scene.objects.map((object) => object.id);
    assertEqual(new Set(ids).size, 3, 'Kennungen eindeutig');
    assertEqual(normalizeScene(scene), scene, 'gültige Szene bleibt gleich');
    assertEqual(normalizeScene({ cols: 12, rows: 12, terrain: 'zu kurz' }).terrain, '.'.repeat(144));
    assertEqual(normalizeScene(null).objects, []);
  },
);

test('Karten-Editor: Szene', 'Höchstens MAX_OBJECTS Objekte', () => {
  const objects = Array.from({ length: MAX_OBJECTS + 5 }, (_, index) => ({
    type: 'stein',
    x: 1,
    y: 1,
    id: `o${index + 1}`,
  }));
  const scene = normalizeScene({ cols: 10, rows: 10, objects });
  assertEqual(scene.objects.length, MAX_OBJECTS);
  const result = addObject(scene, { type: 'stein', x: 2, y: 2 });
  assertEqual(result.object, null, 'kein weiteres Objekt');
  assertTrue(result.scene === scene, 'Szene unverändert');
});

test('Karten-Editor: Gelände', 'Pinsel: einzelnes Feld, Kreis, Rand der Karte', () => {
  assertEqual(brushCells(10, 10, 3.7, 4.2, 0), [[3, 4]]);
  assertEqual(brushCells(10, 10, 3.5, 4.5, 1).length, 5, 'Radius 1: Kreuz aus 5 Feldern');
  assertEqual(brushCells(10, 10, 3.5, 4.5, 2).length, 13);
  assertEqual(brushCells(10, 10, 0.5, 0.5, 1).length, 3, 'am Rand abgeschnitten');
  assertEqual(brushCells(10, 10, -3, 2, 0), [], 'außerhalb');
});

test(
  'Karten-Editor: Gelände',
  'Malen ändert nur die getroffenen Felder; ohne Änderung bleibt die Szene dieselbe',
  () => {
    const scene = createScene({ cols: 10, rows: 10 });
    const painted = paintTerrain(scene, 2.2, 3.9, '~', 0);
    assertEqual(terrainAt(painted, 2, 3), '~');
    assertEqual(painted.terrain.replace(/\./g, '').length, 1);
    assertEqual(scene.terrain, '.'.repeat(100), 'alte Szene unverändert');
    assertTrue(paintTerrain(painted, 2.9, 3.1, '~', 0) === painted, 'gleiches Gelände → dieselbe Szene');
    assertTrue(paintTerrain(painted, 2, 3, 'X', 1) === painted, 'unbekanntes Gelände wird ignoriert');
    const erased = paintTerrain(painted, 2.5, 3.5, '.', 0);
    assertEqual(erased.terrain, scene.terrain, 'Radierer stellt Untergrund wieder her');
    assertEqual(terrainAt(scene, 10, 0), null, 'außerhalb der Karte');
  },
);

test('Karten-Editor: Gelände', 'Pinselstrich ohne Lücken, auch bei schneller Bewegung', () => {
  const scene = createScene({ cols: 20, rows: 10 });
  const painted = paintStroke(scene, { x: 0.5, y: 5.5 }, { x: 19.5, y: 5.5 }, 'w', 0);
  assertEqual(painted.terrain.slice(5 * 20, 6 * 20), 'w'.repeat(20));
  const diagonal = paintStroke(scene, { x: 0.5, y: 0.5 }, { x: 9.5, y: 9.5 }, 'w', 0);
  for (let index = 0; index < 10; index += 1) assertEqual(terrainAt(diagonal, index, index), 'w', `Feld ${index}`);
});

test('Karten-Editor: Objekte', 'Setzen, verschieben, drehen, vergrößern, entfernen', () => {
  let scene = createScene({ cols: 10, rows: 10 });
  const first = addObject(scene, { type: 'huette', x: 4.5, y: 4.5 });
  scene = first.scene;
  assertEqual(first.object.id, 'o1');
  assertEqual([first.object.rot, first.object.scale], [0, 1]);
  const second = addObject(scene, { type: 'fass', x: 1, y: 1, seed: 17 });
  scene = second.scene;
  assertEqual([second.object.id, second.object.seed], ['o2', 17]);
  assertEqual(addObject(scene, { type: 'ufo', x: 1, y: 1 }).object, null, 'unbekannte Art');

  const moved = moveObject(scene, 'o1', 20, 3.333);
  assertEqual([moved.objects[0].x, moved.objects[0].y], [10, 3.33], 'begrenzt und gerundet');
  assertEqual(scene.objects[0].x, 4.5, 'alte Szene unverändert');
  const turned = updateObject(moved, 'o1', { rot: 405, scale: 0.1, type: 'turm', id: 'o9' });
  assertEqual([turned.objects[0].rot, turned.objects[0].scale], [45, 0.5]);
  assertEqual([turned.objects[0].type, turned.objects[0].id], ['huette', 'o1'], 'Art und Kennung bleiben');
  assertTrue(updateObject(turned, 'o1', { rot: 45 }) === turned, 'keine Änderung → dieselbe Szene');
  assertTrue(updateObject(turned, 'o99', { rot: 90 }) === turned, 'unbekannte Kennung');

  const removed = removeObject(turned, 'o1');
  assertEqual(
    removed.objects.map((object) => object.id),
    ['o2'],
  );
  assertTrue(removeObject(removed, 'o1') === removed);
  assertEqual(
    addObject(removed, { type: 'kiste', x: 1, y: 1 }).object.id,
    'o3',
    'Kennungen werden nicht wiederverwendet',
  );
});

test('Karten-Editor: Objekte', 'Grundfläche und Einrasten berücksichtigen Drehung und Größe', () => {
  assertEqual(footprintSize('haus', 0), { w: 4, h: 3 });
  assertEqual(footprintSize('haus', 90), { w: 3, h: 4 });
  assertEqual(footprintSize('zaun', 0, 2), { w: 6, h: 2 });
  assertEqual(snapObject('huette', 4.2, 4.9), { x: 4.5, y: 4.5 }, 'ungerade Breite → Feldmitte');
  assertEqual(snapObject('laubbaum', 4.4, 4.6), { x: 4, y: 5 }, 'gerade Breite → Feldecke');
  assertEqual(snapObject('haus', 5.3, 5.3), { x: 5, y: 5.5 });
  assertEqual(snapObject('haus', 5.3, 5.3, 90), { x: 5.5, y: 5 });
});

test('Karten-Editor: Objekte', 'Antippen trifft das oberste Objekt, auch gedreht', () => {
  let scene = createScene({ cols: 10, rows: 10 });
  scene = addObject(scene, { type: 'laubbaum', x: 5, y: 5 }).scene;
  scene = addObject(scene, { type: 'stein', x: 5.5, y: 5.5 }).scene;
  scene = addObject(scene, { type: 'zaun', x: 2, y: 2, rot: 90 }).scene;
  assertEqual(objectAt(scene, 5.6, 5.6).type, 'laubbaum', 'Baum (hohe Ebene) liegt über dem Stein');
  assertEqual(
    drawOrder(scene.objects).map((object) => object.type),
    ['zaun', 'stein', 'laubbaum'],
  );
  assertEqual(objectAt(scene, 2.2, 3.2)?.type, 'zaun', 'gedrehter Zaun: entlang der Länge');
  assertEqual(objectAt(scene, 3.2, 2.2), null, 'quer daneben nicht');
  assertEqual(objectAt(scene, 2.7, 2), null);
  assertEqual(objectAt(scene, 2.7, 2, 0.3)?.type, 'zaun', 'mit Toleranz');
});

test('Karten-Editor: Generator', 'Zufall ist wiederholbar', () => {
  const a = createRandom(5);
  const b = createRandom(5);
  const values = Array.from({ length: 5 }, () => a.next());
  assertEqual(
    Array.from({ length: 5 }, () => b.next()),
    values,
  );
  assertTrue(values.every((value) => value >= 0 && value < 1));
  assertTrue(createRandom(6).next() !== values[0], 'anderer Startwert, andere Folge');
});

test('Karten-Editor: Generator', 'Gleicher Startwert → gleiche Karte, anderer Startwert → andere Karte', () => {
  for (const theme of THEMES) {
    const a = generateScene({ theme: theme.id, cols: 20, rows: 15, seed: 11 });
    const b = generateScene({ theme: theme.id, cols: 20, rows: 15, seed: 11 });
    const c = generateScene({ theme: theme.id, cols: 20, rows: 15, seed: 12 });
    assertEqual(a, b, theme.id);
    assertTrue(JSON.stringify(a) !== JSON.stringify(c), `${theme.id}: andere Karte`);
  }
});

test(
  'Karten-Editor: Generator',
  'Alle Themen in allen Größen: gültige Szene, Objekte nicht im Wasser oder Fels',
  () => {
    const known = new Set(OBJECTS.map((object) => object.id));
    for (const theme of THEMES) {
      for (const size of SCENE_SIZES) {
        for (const seed of SEEDS.slice(0, 3)) {
          const label = `${theme.id} ${size.id} #${seed}`;
          const scene = generateScene({ theme: theme.id, cols: size.cols, rows: size.rows, seed });
          assertEqual([scene.cols, scene.rows, scene.ground], [size.cols, size.rows, theme.ground], label);
          assertEqual(normalizeScene(scene), scene, `${label}: bereits gültig`);
          assertTrue(scene.objects.length > 10, `${label}: genug Objekte (${scene.objects.length})`);
          for (const object of scene.objects) {
            assertTrue(known.has(object.type), label);
            if (object.type === 'bruecke') continue;
            const cell = terrainAt(scene, Math.min(object.x, scene.cols - 0.01), Math.min(object.y, scene.rows - 0.01));
            assertTrue(
              cell !== '~' && cell !== 'f',
              `${label}: ${object.type} bei ${object.x}/${object.y} steht auf ${cell}`,
            );
          }
        }
      }
    }
  },
);

test('Karten-Editor: Generator', 'Wald: viele Bäume, eine Lichtung und ein Weg', () => {
  for (const seed of SEEDS) {
    const scene = generateScene({ theme: 'wald', cols: 30, rows: 20, seed });
    assertTrue(count(scene, 'laubbaum', 'nadelbaum') >= 60, `#${seed}: ${count(scene, 'laubbaum', 'nadelbaum')} Bäume`);
    assertTrue(scene.terrain.includes('g') && scene.terrain.includes('w'), `#${seed}: Lichtung und Weg`);
  }
});

test('Karten-Editor: Generator', 'Dorf: Straßen, Platz mit Brunnen, mehrere Häuser', () => {
  for (const seed of SEEDS) {
    for (const size of SCENE_SIZES) {
      const scene = generateScene({ theme: 'dorf', cols: size.cols, rows: size.rows, seed });
      const label = `#${seed} ${size.id}`;
      assertEqual(count(scene, 'brunnen'), 1, label);
      assertTrue(
        count(scene, 'haus', 'huette') >= (size.id === 'klein' ? 3 : 5),
        `${label}: ${count(scene, 'haus', 'huette')} Häuser`,
      );
      assertTrue(scene.terrain.includes('w') && scene.terrain.includes('p'), label);
    }
  }
});

test('Karten-Editor: Generator', 'Lager: Feuer in der Mitte, Zelte zeigen zum Feuer', () => {
  for (const seed of SEEDS) {
    const scene = generateScene({ theme: 'lager', cols: 30, rows: 20, seed });
    const fire = scene.objects.find((object) => object.type === 'lagerfeuer');
    assertTrue(fire, `#${seed}: Lagerfeuer`);
    const tents = scene.objects.filter((object) => object.type === 'zelt');
    assertTrue(tents.length >= 3, `#${seed}: ${tents.length} Zelte`);
    for (const tent of tents) {
      // Eingang liegt unten (lokal +y); gedreht muss er in Richtung Feuer zeigen.
      const angle = (tent.rot * Math.PI) / 180;
      const door = { x: -Math.sin(angle), y: Math.cos(angle) };
      const toFire = { x: fire.x - tent.x, y: fire.y - tent.y };
      const cos = (door.x * toFire.x + door.y * toFire.y) / Math.hypot(toFire.x, toFire.y);
      assertTrue(cos > 0.9, `#${seed}: Zelt bei ${tent.x}/${tent.y} schaut weg (${cos.toFixed(2)})`);
    }
  }
});

test('Karten-Editor: Generator', 'Fluss: fließt von oben nach unten, eine Brücke darüber', () => {
  for (const seed of SEEDS) {
    const scene = generateScene({ theme: 'fluss', cols: 30, rows: 20, seed });
    for (let row = 0; row < scene.rows; row += 1) {
      assertTrue(
        scene.terrain.slice(row * scene.cols, (row + 1) * scene.cols).includes('~'),
        `#${seed}: Zeile ${row} ohne Wasser`,
      );
    }
    const bridges = scene.objects.filter((object) => object.type === 'bruecke');
    assertEqual(bridges.length, 1, `#${seed}`);
    assertEqual(terrainAt(scene, bridges[0].x, bridges[0].y), '~', `#${seed}: Brücke über Wasser`);
    const row = Math.floor(bridges[0].y);
    const half = (4 * bridges[0].scale) / 2;
    assertTrue(terrainAt(scene, bridges[0].x - half - 0.5, row) !== '~', `#${seed}: linkes Ende an Land`);
    assertTrue(terrainAt(scene, bridges[0].x + half + 0.5, row) !== '~', `#${seed}: rechtes Ende an Land`);
  }
});

test('Karten-Editor: Generator', 'Höhle: Felswände, ein zusammenhängender Hohlraum mit Eingang', () => {
  for (const seed of SEEDS) {
    for (const size of SCENE_SIZES) {
      const scene = generateScene({ theme: 'hoehle', cols: size.cols, rows: size.rows, seed });
      const label = `#${seed} ${size.id}`;
      const rock = scene.terrain.split('').filter((code) => code === 'f').length;
      assertTrue(rock > scene.cols * 2 && rock < scene.cols * scene.rows * 0.8, `${label}: ${rock} Felsfelder`);
      assertTrue(openCellsConnected(scene), `${label}: Hohlraum zusammenhängend`);
      const leftEdge = Array.from({ length: scene.rows }, (_, row) => terrainAt(scene, 0, row));
      assertTrue(
        leftEdge.some((code) => code !== 'f'),
        `${label}: Eingang am linken Rand`,
      );
    }
  }
});

test('Karten-Editor: Szene', 'Boden wechseln', () => {
  const scene = createScene();
  assertEqual(setGround(scene, 'schnee').ground, 'schnee');
  assertTrue(setGround(scene, 'gras') === scene, 'gleicher Boden');
  assertTrue(setGround(scene, 'lava') === scene, 'unbekannter Boden');
});
