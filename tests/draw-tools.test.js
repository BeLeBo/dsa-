/**
 * draw-tools.test.js – Tests für Farbeimer, eigene Farben und Formen: Farben und Formen
 * (map.js), Füllen und Umrisse (flood-fill.js), zuletzt benutzte Farben (map-draw-bar.js) und
 * das Speichern über die Karten-Steuerung (room-map.js, mit Attrappe).
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  normalizeColor,
  drawColorValue,
  fillColor,
  fillParts,
  normalizeDrawing,
  flattenRings,
  drawingPaths,
  constrainShape,
  drawingsAt,
  pointInPolygon,
} from '../js/map.js';
import { floodFill, traceOutline, simplifyRing, findHoles, bucketOutline, dilate } from '../js/flood-fill.js';
import { rememberCustomColor } from '../js/ui/map-draw-bar.js';
import { createMapController } from '../js/room-map.js';

const COLORS = 'Zeichnen: eigene Farben und Formen (map.js)';
const BUCKET = 'Zeichnen: Farbeimer (flood-fill.js)';

test(COLORS, 'Farben: Namen, Hex mit und ohne #, kurz und groß geschrieben', () => {
  assertEqual(normalizeColor('rot'), 'rot');
  assertEqual(normalizeColor(' #3A7BD5 '), '#3a7bd5');
  assertEqual(normalizeColor('3a7bd5'), '#3a7bd5');
  assertEqual(normalizeColor('#AbC'), '#aabbcc', 'dreistellig');
  assertEqual(normalizeColor('#12345'), null, 'zu kurz');
  assertEqual(normalizeColor('pink'), null);
  assertEqual(normalizeColor(null), null);
  assertEqual(drawColorValue('#3a7bd5'), '#3a7bd5');
  assertEqual(drawColorValue('blau'), '#2563eb');
  assertEqual(drawColorValue('unsinn'), '#e02424', 'unbekannt → Rot');
});

test(COLORS, 'Füllfarbe: halb durchsichtig oder deckend', () => {
  assertEqual(fillColor('#3a7bd5', 'halb'), '#3a7bd573');
  assertEqual(fillColor('blau', 'voll'), '#2563ebff');
  assertEqual(fillColor('rot', 'keine'), null);
  assertEqual(fillParts('#3a7bd573'), { color: '#3a7bd5', opacity: 0.45 });
});

test(COLORS, 'Formen vom Server prüfen: genau zwei Punkte, Füllung nur bei Rechteck und Kreis', () => {
  const rect = normalizeDrawing({
    id: 'r',
    kind: 'rect',
    color: '#ABCDEF',
    fill: '#ABCDEF73',
    points: [10, 20, 50, 60],
  });
  assertEqual([rect.kind, rect.color, rect.fill, rect.points.length], ['rect', '#abcdef', '#abcdef73', 2]);
  assertEqual(normalizeDrawing({ id: 'x', kind: 'rect', points: [1, 2, 3, 4, 5, 6] }), null, 'drei Punkte');
  assertEqual(normalizeDrawing({ id: 'a', kind: 'arrow', points: [0, 0, 10, 0], fill: '#00000080' }).fill, null);
  assertEqual(normalizeDrawing({ id: 'l', kind: 'unbekannt', points: [1, 2] }).kind, 'line', 'unbekannt → Linie');
  assertEqual(normalizeDrawing({ id: 'f', kind: 'fill', color: 'rot', points: [0, 0, 1, 0] }), null, 'Fläche zu klein');
  const old = normalizeDrawing({ id: 'o', color: 'rot', width: 3, points: [1, 2, 3, 4] });
  assertEqual([old.kind, old.fill], ['line', null], 'ältere Linie ohne Art');
});

test(COLORS, 'Farbeimer-Fläche mit Loch: Umrisse getrennt gespeichert', () => {
  const rings = [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 60 },
    ],
  ];
  const flat = flattenRings(rings);
  assertEqual(flat.slice(8, 10), [-1, -1], 'Trennzeichen zwischen den Umrissen');
  const fill = normalizeDrawing({ id: 'f', kind: 'fill', color: '#3a7bd5', fill: '#3a7bd573', points: flat });
  assertEqual(fill.rings.length, 2);
  assertEqual(fill.points, rings[0], 'points = äußerer Umriss');
  assertEqual(drawingPaths(fill).fill, 'M0 0L100 0L100 100L0 100ZM40 40L60 40L60 60Z');
  assertEqual(drawingsAt([fill], { x: 20, y: 20 }, 1), ['f'], 'Radierer trifft die Fläche');
  assertEqual(drawingsAt([fill], { x: 55, y: 45 }, 0.5), [], '… aber nicht das Loch');
  const noFill = normalizeDrawing({ id: 'g', kind: 'fill', color: 'rot', points: flattenRings([rings[0]]) });
  assertEqual(noFill.fill, '#e0242473', 'ohne Füllfarbe: halb durchsichtig in der Stiftfarbe');
});

test(COLORS, 'SVG-Pfade der Formen', () => {
  const at = (kind, points, extra = {}) =>
    drawingPaths({ kind, width: 4, color: 'rot', fill: null, points: points.map(([x, y]) => ({ x, y })), ...extra });
  assertEqual(
    at('straight', [
      [0, 0],
      [10, 5],
    ]).stroke,
    'M0 0L10 5',
  );
  const rect = at(
    'rect',
    [
      [30, 40],
      [10, 20],
    ],
    { fill: '#ff000080' },
  );
  assertEqual(rect.stroke, 'M10 20h20v20h-20Z', 'Ecken in beliebiger Richtung');
  assertEqual(rect.fill, rect.stroke, 'gefüllt');
  assertEqual(
    at('rect', [
      [0, 0],
      [5, 5],
    ]).fill,
    null,
    'ohne Füllung',
  );
  assertEqual(
    at('ellipse', [
      [0, 0],
      [20, 10],
    ]).stroke,
    'M0 5a10 5 0 1 0 20 0a10 5 0 1 0 -20 0Z',
  );
  const arrow = at('arrow', [
    [0, 0],
    [100, 0],
  ]);
  assertEqual(arrow.stroke, 'M0 0L87.4 0', 'Schaft endet in der Spitze');
  assertEqual(arrow.head, 'M100 0L82 -9.9L82 9.9Z', 'Spitze 4,5 × Strichstärke lang');
});

test(COLORS, 'Umschalttaste: Quadrat, Kreis, 45°-Linien', () => {
  assertEqual(constrainShape('rect', { x: 0, y: 0 }, { x: 30, y: -10 }), { x: 30, y: -30 });
  assertEqual(constrainShape('ellipse', { x: 10, y: 10 }, { x: 0, y: 40 }), { x: -20, y: 40 });
  const line = constrainShape('straight', { x: 0, y: 0 }, { x: 100, y: 12 });
  assertTrue(Math.abs(line.y) < 1e-9 && Math.abs(line.x - Math.hypot(100, 12)) < 1e-9, 'fast waagrecht → waagrecht');
  const diagonal = constrainShape('arrow', { x: 0, y: 0 }, { x: 50, y: 45 });
  assertTrue(Math.abs(diagonal.x - diagonal.y) < 1e-9, 'fast diagonal → 45°');
});

test(COLORS, 'Radierer trifft Formen am Rand – gefüllte auch innen', () => {
  const rect = normalizeDrawing({ id: 'r', kind: 'rect', color: 'rot', width: 4, points: [0, 0, 100, 50] });
  const filled = { ...rect, id: 'rf', fill: '#ff000080' };
  assertEqual(drawingsAt([rect], { x: 50, y: 1 }, 2), ['r'], 'am Rand');
  assertEqual(drawingsAt([rect], { x: 50, y: 25 }, 2), [], 'innen leer');
  assertEqual(drawingsAt([filled], { x: 50, y: 25 }, 2), ['rf'], 'innen gefüllt');
  const circle = normalizeDrawing({ id: 'c', kind: 'ellipse', color: 'rot', width: 4, points: [0, 0, 100, 100] });
  assertEqual(drawingsAt([circle], { x: 100, y: 50 }, 2), ['c'], 'auf dem Kreis');
  assertEqual(drawingsAt([circle], { x: 50, y: 50 }, 2), [], 'Mitte eines leeren Kreises');
  const arrow = normalizeDrawing({ id: 'p', kind: 'arrow', color: 'rot', width: 4, points: [0, 0, 100, 0] });
  assertEqual(drawingsAt([arrow], { x: 60, y: 3 }, 2), ['p']);
  assertTrue(
    pointInPolygon({ x: 3, y: 3 }, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]),
  );
});

/** Kleines Bild: weiß, schwarze Wand um einen Raum, darin ein großer Tisch und zwei Sprenkel. */
function roomImage() {
  const width = 40;
  const height = 30;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y, value) => rgba.set([value, value, value], (y * width + x) * 4);
  for (let x = 3; x <= 36; x += 1) {
    paint(x, 3, 0);
    paint(x, 26, 0);
  }
  for (let y = 3; y <= 26; y += 1) {
    paint(3, y, 0);
    paint(36, y, 0);
  }
  for (let x = 15; x <= 24; x += 1) for (let y = 10; y <= 18; y += 1) paint(x, y, 0);
  paint(8, 8, 30);
  paint(30, 20, 30);
  return { rgba, width, height };
}

test(BUCKET, 'Fläche füllen: bis zur Wand, Toleranz für leicht andere Farben', () => {
  const { rgba, width, height } = roomImage();
  const room = floodFill(rgba, width, height, 6, 6);
  const area = room.reduce((sum, value) => sum + value, 0);
  assertEqual(area, 32 * 22 - 10 * 9 - 2, 'Raum ohne Tisch und Sprenkel');
  rgba.set([235, 235, 235], (6 * width + 7) * 4); // fast weiß
  assertEqual(floodFill(rgba, width, height, 6, 6)[6 * width + 7], 1, 'leicht andere Farbe gehört dazu');
  assertEqual(floodFill(rgba, width, height, 6, 6, 10)[6 * width + 7], 0, 'mit kleiner Toleranz nicht');
  assertEqual(floodFill(rgba, width, height, -1, 6), null, 'außerhalb');
});

test(BUCKET, 'Umriss nachfahren und vereinfachen', () => {
  const width = 8;
  const height = 6;
  const mask = new Uint8Array(width * height);
  for (let y = 1; y <= 4; y += 1) for (let x = 2; x <= 6; x += 1) mask[y * width + x] = 1;
  const outline = traceOutline(mask, width, height);
  assertEqual(outline.length, 14, 'alle Randpunkte');
  assertEqual(simplifyRing(outline, 0.5), [
    { x: 2.5, y: 1.5 },
    { x: 6.5, y: 1.5 },
    { x: 6.5, y: 4.5 },
    { x: 2.5, y: 4.5 },
  ]);
  assertEqual(dilate(mask, width, height)[0 * width + 1], 1, 'um einen Punkt erweitert (auch schräg)');
});

test(BUCKET, 'Löcher: große bleiben frei, Sprenkel werden mitgefüllt', () => {
  const { rgba, width, height } = roomImage();
  const holes = findHoles(floodFill(rgba, width, height, 6, 6), width, height);
  assertEqual(holes.length, 1, 'nur der Tisch – die Sprenkel sind zu klein');
  assertEqual(holes[0].area, 90);
  const rings = bucketOutline(rgba, width, height, 6, 6);
  assertEqual(rings.length, 2, 'Raum mit Loch für den Tisch');
  assertEqual(rings[0], [
    { x: 3.5, y: 3.5 },
    { x: 36.5, y: 3.5 },
    { x: 36.5, y: 26.5 },
    { x: 3.5, y: 26.5 },
  ]);
});

test(BUCKET, 'Auf die Wand getippt: nur die Wand, nicht der ganze Raum', () => {
  const { rgba, width, height } = roomImage();
  const rings = bucketOutline(rgba, width, height, 3, 10);
  assertEqual(rings.length, 2, 'Wand mit Loch für den Raum');
  assertEqual(rings[1][0], { x: 5.5, y: 5.5 }, 'Loch = Inneres des Raums');
  assertEqual(bucketOutline(rgba, width, height, 8, 8), null, 'ein einzelner Sprenkel ist zu klein');
});

test(BUCKET, 'Viele Punkte: Umriss wird gröber, bis er passt', () => {
  const width = 200;
  const height = 200;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = Math.hypot(x - 100, y - 100) < 80 + 8 * Math.sin(x / 3) * Math.cos(y / 3);
      if (!inside) rgba.set([0, 0, 0], (y * width + x) * 4);
    }
  }
  const rings = bucketOutline(rgba, width, height, 100, 100, { maxPoints: 60 });
  const total = rings.reduce((sum, ring) => sum + ring.length, 0) + rings.length - 1;
  assertTrue(total <= 60, `höchstens 60 Punkte (${total})`);
});

test(COLORS, 'Nur für mich: Kennzeichen bleibt erhalten, sonst für alle', () => {
  const row = { id: 'd1', points: [1, 2, 3, 4], color: 'rot', width: 2 };
  assertEqual(normalizeDrawing({ ...row, private: true }).private, true);
  assertEqual(normalizeDrawing(row).private, false, 'ältere Datenbank ohne Spalte: für alle');
  assertEqual(normalizeDrawing({ ...row, private: 'ja' }).private, false, 'nur echtes true');
});

test(BUCKET, 'Zuletzt benutzte eigene Farben: neueste zuerst, ohne Doppelte, höchstens acht', () => {
  let recent = [];
  for (const color of ['#111111', '#222222', '#111111']) recent = rememberCustomColor(recent, color);
  assertEqual(recent, ['#111111', '#222222']);
  for (let index = 0; index < 10; index += 1) recent = rememberCustomColor(recent, `#00000${index}`);
  assertEqual(recent.length, 8);
});

test(BUCKET, 'Speichern: Form mit Füllung, Farbeimer mit Umrissen, Linie wie bisher', async () => {
  const calls = [];
  const map = {
    id: 'm1',
    room_id: 'raum',
    name: 'Karte',
    image_path: 'raum/k.webp',
    width: 1000,
    height: 800,
    grid: {},
  };
  const api = {
    fetchMaps: async () => [map],
    fetchTokens: async () => [],
    fetchDrawings: async () => [],
    setActiveMap: async () => {},
    createDrawing: async (row) => calls.push(row),
  };
  const controller = createMapController({
    roomId: 'raum',
    isMaster: () => true,
    characters: () => [],
    userId: () => 'rahja',
    api,
  });
  await controller.load();
  await controller.actions.addDrawing({
    kind: 'rect',
    points: [
      { x: 10, y: 10 },
      { x: 2000, y: 50 },
    ],
    color: '#3a7bd5',
    width: 6,
    fill: '#3a7bd573',
  });
  await controller.actions.addDrawing({
    kind: 'fill',
    rings: [
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
    ],
    color: 'rot',
    width: 1,
    fill: '#e02424ff',
  });
  await controller.actions.addDrawing({ points: [{ x: 1, y: 1 }], color: 'rot', width: 3 });
  await controller.actions.addDrawing({ points: [{ x: 5, y: 5 }], color: 'blau', width: 3, private: true });
  assertEqual(calls[3].private, true, 'nur für mich: als privat gespeichert');
  assertEqual(controller.state.get().drawings.at(-1).private, true, 'auch sofort auf dem eigenen Gerät');
  assertEqual(
    [calls[0].kind, calls[0].fill, calls[0].points],
    ['rect', '#3a7bd573', [10, 10, 1000, 50]],
    'Form, auf die Karte begrenzt',
  );
  assertEqual(calls[1].points, [0, 0, 50, 0, 50, 50, -1, -1, 10, 10, 20, 10, 20, 20], 'Umrisse mit Trennzeichen');
  assertEqual(
    'kind' in calls[2] || 'fill' in calls[2] || 'private' in calls[2],
    false,
    'freie Linie für alle ohne neue Felder (ältere Datenbank)',
  );
  assertEqual(
    controller.state.get().drawings.map((drawing) => drawing.kind),
    ['rect', 'fill', 'line', 'line'],
  );
  localStorage.removeItem('dsa5.karte.raum');
  localStorage.removeItem('dsa5.karten-offen.raum');
});
