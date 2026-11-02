/**
 * detail.test.js – Tests für scharfe Karten beim Hineinzoomen: Detailstufen planen, Bildquelle
 * wählen, Schärfe-Ebene planen (map-detail.js) und die Unschärfemaske (sharpen.js).
 */
import { test, assertEqual, assertTrue } from './harness.js';
import {
  detailSize,
  planDetailLevels,
  tileCount,
  tilePath,
  allTilePaths,
  normalizeDetail,
  chooseDetailSource,
  visibleRegion,
  snapRegion,
  planSharpLayer,
  tilesInRegion,
  sharpenAmount,
  MAP_DETAIL_MAX_EDGE,
  MAP_DETAIL_MAX_PIXELS,
  MAX_SHARP_PIXELS,
} from '../js/map-detail.js';
import { unsharpMask, OVERSHOOT_LIMIT } from '../js/sharpen.js';

const DETAIL = 'Karte: Detailstufen (map-detail.js)';
const SHARP = 'Karte: Schärfe-Ebene (map-detail.js, sharpen.js)';

test(DETAIL, 'Volle Auflösung: Original, begrenzt auf Kante und Bildpunkte', () => {
  assertEqual(detailSize(6000, 4000), { width: 6000, height: 4000 }, 'passt');
  assertEqual(detailSize(20000, 10000), { width: MAP_DETAIL_MAX_EDGE, height: 5000 }, 'längste Seite');
  const square = detailSize(9000, 9000);
  assertTrue(square.width * square.height <= MAP_DETAIL_MAX_PIXELS, 'höchstens 64 Millionen Bildpunkte');
  assertEqual(square.width, 8000);
});

test(DETAIL, 'Stufen: volle Auflösung, dann halbiert – solange mehr als das Vorschaubild', () => {
  const levels = planDetailLevels(8000, 6000, 3000);
  assertEqual(levels, [
    { scale: 1, width: 8000, height: 6000, cols: 8, rows: 6 },
    { scale: 0.5, width: 4000, height: 3000, cols: 4, rows: 3 },
  ]);
  assertEqual(tileCount(levels), 60);
  assertEqual(planDetailLevels(3200, 2000, 3000), [], 'kaum größer als das Vorschaubild: keine Stufen');
  assertEqual(planDetailLevels(2000, 1000, 2000), [], 'kleines Bild');
  assertEqual(planDetailLevels(4000, 1000, 3000).length, 1, '4000 Punkte: eine Stufe');
});

test(DETAIL, 'Kachelpfade und Prüfen der Angaben vom Server', () => {
  const map = { width: 8000, height: 6000 };
  const detail = { path: 'raum/kacheln/k1', tile: 1024, ext: 'webp', levels: planDetailLevels(8000, 6000, 3000) };
  assertEqual(tilePath(detail, 1, 2, 0), 'raum/kacheln/k1/1/2-0.webp');
  const paths = allTilePaths(detail);
  assertEqual(paths.length, 60);
  assertEqual(new Set(paths).size, 60, 'jeder Pfad einmal');
  assertEqual(normalizeDetail(detail, map), detail, 'gültig');
  assertEqual(normalizeDetail(null, map), null);
  assertEqual(normalizeDetail({ ...detail, ext: 'gif' }, map), null, 'unbekanntes Format');
  assertEqual(normalizeDetail({ ...detail, path: 'raum/../anderer' }, map), null, 'kein Ausbrechen aus dem Ordner');
  assertEqual(normalizeDetail(detail, { width: 4000, height: 3000 }), null, 'passt nicht zur Karte');
  const broken = { ...detail, levels: [{ ...detail.levels[0], cols: 3 }, detail.levels[1]] };
  assertEqual(normalizeDetail(broken, map), null, 'falsche Kachelzahl');
  const reversed = { ...detail, levels: [...detail.levels].reverse() };
  assertEqual(normalizeDetail(reversed, map).levels[0].scale, 1, 'feinste Stufe zuerst');
});

test(DETAIL, 'Bildquelle: die gröbste, die reicht – sonst die feinste', () => {
  const levels = planDetailLevels(8000, 6000, 3000); // Maßstäbe 1 und 0,5; Vorschaubild 0,375
  assertEqual(chooseDetailSource(0.3, 0.375, levels).level, null, 'Vorschaubild reicht');
  assertEqual(chooseDetailSource(0.6, 0.375, levels).level, 1, 'halbe Auflösung');
  assertEqual(chooseDetailSource(0.9, 0.375, levels).level, 0, 'volle Auflösung');
  const deep = chooseDetailSource(4, 0.375, levels);
  assertEqual([deep.level, deep.magnification], [0, 4], 'tiefer: feinste Stufe, vierfach hochgerechnet');
  const plain = chooseDetailSource(3, 1, []);
  assertEqual([plain.level, plain.magnification], [null, 3], 'alte Karte ohne Stufen');
});

test(SHARP, 'Sichtbarer Bereich mit Rand, begrenzt auf die Karte', () => {
  const map = { width: 1000, height: 800 };
  const region = visibleRegion({ scale: 2, x: -400, y: -300 }, { width: 400, height: 200 }, map, 0);
  assertEqual(region, { x: 200, y: 150, width: 200, height: 100 });
  const margin = visibleRegion({ scale: 2, x: -400, y: -300 }, { width: 400, height: 200 }, map, 0.1);
  assertEqual(margin, { x: 180, y: 140, width: 240, height: 120 });
  const corner = visibleRegion({ scale: 1, x: 100, y: 100 }, { width: 400, height: 400 }, map, 0);
  assertEqual(corner, { x: 0, y: 0, width: 300, height: 300 }, 'Karte nur teilweise im Bild');
  assertEqual(visibleRegion({ scale: 1, x: 2000, y: 0 }, { width: 400, height: 400 }, map, 0), null);
  const snapped = snapRegion({ x: 10.3, y: 0.5, width: 5, height: 2 }, 2);
  assertEqual(snapped.source, { x: 20, y: 1, width: 11, height: 4 }, 'ganze Bildpunkte der Quelle');
  assertEqual(snapped.region, { x: 10, y: 0.5, width: 5.5, height: 2 });
});

test(SHARP, 'Schärfe-Ebene nur, wenn das Kartenbild nicht mehr reicht', () => {
  const map = { width: 3000, height: 2000 };
  const viewport = { width: 400, height: 800 };
  const at = (scale, dpr = 1, levels = [], baseScale = 1) =>
    planSharpLayer({ view: { scale, x: -1000 * scale, y: -500 * scale }, viewport, map, dpr, baseScale, levels });
  assertEqual(at(1), null, 'Bildpunkt = Bildschirmpunkt: Bild reicht');
  assertEqual(at(1.25), null, 'kaum vergrößert');
  const zoomed = at(4);
  assertTrue(zoomed.sharpen, 'vierfach: hochrechnen und schärfen');
  assertEqual(zoomed.source.magnification, 4);
  assertEqual(
    [zoomed.width, zoomed.height],
    [Math.round(zoomed.region.width * 4), Math.round(zoomed.region.height * 4)],
  );
  assertEqual(zoomed.crop.width, Math.round(zoomed.region.width), 'Ausschnitt in Bildpunkten des Bildes');
  assertTrue(at(0.5, 3).sharpen, 'Handy mit dreifacher Pixeldichte: schon bei halbem Zoom');
  const tiled = at(0.9, 1, planDetailLevels(8000, 6000, 3000), 0.375);
  assertEqual([tiled.source.level, tiled.sharpen], [0, false], 'Detailstufe reicht – nur zeichnen');
});

test(SHARP, 'Schärfe-Ebene bleibt im Speicherrahmen', () => {
  const map = { width: 10000, height: 10000 };
  const plan = planSharpLayer({
    view: { scale: 3, x: -3000, y: -3000 },
    viewport: { width: 3840, height: 2160 },
    map,
    dpr: 2,
    baseScale: 0.3,
  });
  assertTrue(plan.width * plan.height <= MAX_SHARP_PIXELS * 1.01, `höchstens ${MAX_SHARP_PIXELS} Bildpunkte`);
  assertTrue(plan.width <= 4096 && plan.height <= 4096, 'Kanten begrenzt');
});

test(SHARP, 'Kacheln im Bereich – mit Randkacheln', () => {
  const level = { scale: 0.5, width: 2500, height: 1500, cols: 3, rows: 2 };
  const tiles = tilesInRegion(level, 1024, { x: 1000, y: 0, width: 2000, height: 1000 });
  assertEqual(
    tiles.map((tile) => [tile.col, tile.row]),
    [
      [0, 0],
      [1, 0],
    ],
  );
  const edge = tilesInRegion(level, 1024, { x: 4500, y: 2500, width: 500, height: 500 });
  assertEqual(edge.length, 1);
  assertEqual(edge[0].pixels, { x: 2048, y: 1024, width: 452, height: 476 }, 'Randkachel ist kleiner');
  assertEqual(edge[0].map, { x: 4096, y: 2048, width: 904, height: 952 });
});

test(SHARP, 'Unschärfemaske: Kanten kräftiger, Flächen und Transparenz unverändert', () => {
  // 6 × 3 Bildpunkte: links dunkelgrau (60), rechts hellgrau (180)
  const width = 6;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = index % width < 3 ? 60 : 180;
    data.set([value, value, value, 128], index * 4);
  }
  unsharpMask(data, width, height, 1);
  const at = (x, y) => data[(y * width + x) * 4];
  assertEqual(at(0, 1), 60, 'Fläche bleibt');
  assertEqual(at(5, 1), 180, 'Fläche bleibt');
  assertTrue(at(2, 1) < 60, `dunkle Kante wird dunkler (${at(2, 1)})`);
  assertTrue(at(3, 1) > 180, `helle Kante wird heller (${at(3, 1)})`);
  assertTrue(at(2, 1) >= 60 - OVERSHOOT_LIMIT, `kein dunkler Saum (${at(2, 1)})`);
  assertTrue(at(3, 1) <= 180 + OVERSHOOT_LIMIT, `kein heller Saum (${at(3, 1)})`);
  assertEqual(data[(1 * width + 2) * 4 + 3], 128, 'Transparenz bleibt');
  const flat = new Uint8ClampedArray(4 * 4 * 4).fill(100);
  unsharpMask(flat, 4, 4, 1);
  assertTrue(
    flat.every((value) => value === 100),
    'einfarbig: nichts zu schärfen',
  );
  assertTrue(sharpenAmount(1.3) < sharpenAmount(8), 'stärker bei mehr Vergrößerung');
});
