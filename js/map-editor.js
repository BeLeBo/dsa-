/**
 * map-editor.js – Karten selbst bauen (ohne DOM und ohne Server): eine Szene aus Untergrund,
 * gemaltem Gelände und vorgefertigten Objekten, dazu ein Zufallsgenerator für fertige Karten
 * (Wald, Dorf, Lager, Fluss, Höhle).
 *
 * Alles zählt in Rasterfeldern: (0, 0) ist links oben, ein Feld ist 1 × 1.
 * Szene: { version, cols, rows, ground, terrain, objects }
 *   terrain  Zeichenkette mit einem Zeichen je Feld (Zeile für Zeile), '.' = Untergrund
 *   objects  [{ id, type, x, y, rot, scale, seed }] – Mittelpunkt in Feldern, Drehung in Grad
 *            im Uhrzeigersinn, Größe als Faktor; seed wählt Spielarten im Aussehen.
 * Alle Änderungen liefern eine neue Szene (die alte bleibt unverändert – gut für „Rückgängig“).
 */

export const SCENE_VERSION = 1;
/** Bildpunkte je Feld im fertigen Kartenbild (46 Felder × 64 = 2944 ≤ MAP_MAX_EDGE). */
export const CELL_PX = 64;
export const MIN_CELLS = 10;
export const MAX_CELLS = 46;
export const MAX_OBJECTS = 800;
export const MIN_OBJECT_SCALE = 0.5;
export const MAX_OBJECT_SCALE = 3;
export const MAX_BRUSH_RADIUS = 3;
const MAX_SEED = 1_000_000;
const EPSILON = 1e-6;

export const SCENE_SIZES = Object.freeze([
  { id: 'klein', name: 'Klein (20 × 15)', cols: 20, rows: 15 },
  { id: 'mittel', name: 'Mittel (30 × 20)', cols: 30, rows: 20 },
  { id: 'gross', name: 'Groß (40 × 28)', cols: 40, rows: 28 },
]);

export const GROUNDS = Object.freeze([
  { id: 'gras', name: 'Gras' },
  { id: 'waldboden', name: 'Waldboden' },
  { id: 'erde', name: 'Erde' },
  { id: 'sand', name: 'Sand' },
  { id: 'stein', name: 'Steinboden' },
  { id: 'schnee', name: 'Schnee' },
  { id: 'dielen', name: 'Holzdielen' },
]);

/** Gelände zum Malen. Der Radierer ('.') stellt den Untergrund wieder her. */
export const TERRAINS = Object.freeze([
  { code: 'w', id: 'weg', name: 'Weg' },
  { code: 'p', id: 'pflaster', name: 'Pflaster' },
  { code: '~', id: 'wasser', name: 'Wasser' },
  { code: 'g', id: 'gras', name: 'Gras' },
  { code: 'e', id: 'erde', name: 'Erde' },
  { code: 's', id: 'sand', name: 'Sand' },
  { code: 'd', id: 'dielen', name: 'Dielen' },
  { code: 'f', id: 'fels', name: 'Fels' },
  { code: '.', id: 'radierer', name: 'Radierer' },
]);

export const OBJECT_GROUPS = Object.freeze([
  { id: 'natur', name: 'Natur' },
  { id: 'gebaeude', name: 'Gebäude' },
  { id: 'ausstattung', name: 'Ausstattung' },
]);

/**
 * Vorgefertigte Objekte. w × h: Grundfläche in Feldern (Größe 1, ungedreht).
 * layer: Zeichenreihenfolge – 0 flach am Boden, 1 normal, 2 hoch (Bäume, Dächer).
 */
export const OBJECTS = Object.freeze([
  { id: 'laubbaum', name: 'Laubbaum', group: 'natur', w: 2, h: 2, layer: 2 },
  { id: 'nadelbaum', name: 'Nadelbaum', group: 'natur', w: 2, h: 2, layer: 2 },
  { id: 'busch', name: 'Busch', group: 'natur', w: 1, h: 1, layer: 1 },
  { id: 'stein', name: 'Stein', group: 'natur', w: 1, h: 1, layer: 1 },
  { id: 'fels', name: 'Felsbrocken', group: 'natur', w: 2, h: 2, layer: 1 },
  { id: 'baumstumpf', name: 'Baumstumpf', group: 'natur', w: 1, h: 1, layer: 1 },
  { id: 'blumen', name: 'Blumen', group: 'natur', w: 1, h: 1, layer: 0 },
  { id: 'schilf', name: 'Schilf', group: 'natur', w: 1, h: 1, layer: 0 },
  { id: 'huette', name: 'Hütte', group: 'gebaeude', w: 3, h: 3, layer: 2 },
  { id: 'haus', name: 'Haus', group: 'gebaeude', w: 4, h: 3, layer: 2 },
  { id: 'turm', name: 'Turm', group: 'gebaeude', w: 3, h: 3, layer: 2 },
  { id: 'zelt', name: 'Zelt', group: 'gebaeude', w: 2, h: 2, layer: 1 },
  { id: 'mauer', name: 'Mauer', group: 'gebaeude', w: 3, h: 1, layer: 1 },
  { id: 'zaun', name: 'Zaun', group: 'gebaeude', w: 3, h: 1, layer: 1 },
  { id: 'bruecke', name: 'Brücke', group: 'gebaeude', w: 4, h: 2, layer: 0 },
  { id: 'lagerfeuer', name: 'Lagerfeuer', group: 'ausstattung', w: 1, h: 1, layer: 1 },
  { id: 'brunnen', name: 'Brunnen', group: 'ausstattung', w: 2, h: 2, layer: 1 },
  { id: 'kiste', name: 'Kiste', group: 'ausstattung', w: 1, h: 1, layer: 1 },
  { id: 'fass', name: 'Fass', group: 'ausstattung', w: 1, h: 1, layer: 1 },
  { id: 'tisch', name: 'Tisch', group: 'ausstattung', w: 2, h: 1, layer: 1 },
  { id: 'karren', name: 'Karren', group: 'ausstattung', w: 2, h: 1, layer: 1 },
]);

export const THEMES = Object.freeze([
  { id: 'wald', name: 'Wald', ground: 'waldboden' },
  { id: 'dorf', name: 'Dorf', ground: 'gras' },
  { id: 'lager', name: 'Lager', ground: 'gras' },
  { id: 'fluss', name: 'Fluss', ground: 'gras' },
  { id: 'hoehle', name: 'Höhle', ground: 'stein' },
]);

const OBJECT_BY_ID = new Map(OBJECTS.map((object) => [object.id, object]));
const GROUND_IDS = new Set(GROUNDS.map((ground) => ground.id));
const TERRAIN_CODES = new Set(TERRAINS.map((terrain) => terrain.code));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;
const finite = (value, fallback) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : fallback;
};

export function objectType(id) {
  return OBJECT_BY_ID.get(id) ?? null;
}

export function clampCells(value) {
  return clamp(Math.round(finite(value, MIN_CELLS)), MIN_CELLS, MAX_CELLS);
}

/** Drehung auf ganze Grad in [0, 360). */
export function normalizeRotation(rot) {
  const value = Math.round(finite(rot, 0)) % 360;
  return value < 0 ? value + 360 : value;
}

export function clampScale(scale) {
  return round2(clamp(finite(scale, 1), MIN_OBJECT_SCALE, MAX_OBJECT_SCALE));
}

// ---------------------------------------------------------------------------
// Szene
// ---------------------------------------------------------------------------

export function createScene({ cols = SCENE_SIZES[1].cols, rows = SCENE_SIZES[1].rows, ground } = {}) {
  const width = clampCells(cols);
  const height = clampCells(rows);
  return {
    version: SCENE_VERSION,
    cols: width,
    rows: height,
    ground: GROUND_IDS.has(ground) ? ground : GROUNDS[0].id,
    terrain: '.'.repeat(width * height),
    objects: [],
  };
}

const idNumber = (id) => Number(id.slice(1)) || 0;
const nextIdNumber = (objects) => objects.reduce((max, object) => Math.max(max, idNumber(object.id)), 0) + 1;

function normalizeObject(raw, cols, rows) {
  if (!raw || typeof raw !== 'object' || !OBJECT_BY_ID.has(raw.type)) return null;
  return {
    id: typeof raw.id === 'string' && /^o\d{1,9}$/.test(raw.id) ? raw.id : '',
    type: raw.type,
    x: round2(clamp(finite(raw.x, cols / 2), 0, cols)),
    y: round2(clamp(finite(raw.y, rows / 2), 0, rows)),
    rot: normalizeRotation(raw.rot),
    scale: clampScale(raw.scale),
    seed: Math.abs(Math.trunc(finite(raw.seed, 0))) % MAX_SEED,
  };
}

/** Vervollständigt und begrenzt eine gespeicherte Szene; Unbekanntes fällt weg. */
export function normalizeScene(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = createScene({ cols: source.cols, rows: source.rows, ground: source.ground });
  const { cols, rows } = base;
  let terrain = base.terrain;
  if (typeof source.terrain === 'string' && source.terrain.length === cols * rows) {
    terrain = source.terrain
      .split('')
      .map((code) => (TERRAIN_CODES.has(code) ? code : '.'))
      .join('');
  }
  const objects = [];
  const used = new Set();
  for (const item of Array.isArray(source.objects) ? source.objects : []) {
    if (objects.length >= MAX_OBJECTS) break;
    const object = normalizeObject(item, cols, rows);
    if (!object) continue;
    if (used.has(object.id)) object.id = '';
    if (object.id) used.add(object.id);
    objects.push(object);
  }
  let next = nextIdNumber(objects.filter((object) => object.id));
  for (const object of objects) {
    if (object.id) continue;
    object.id = `o${next}`;
    next += 1;
  }
  return { version: SCENE_VERSION, cols, rows, ground: base.ground, terrain, objects };
}

/** Größe des Kartenbilds in Bildpunkten. */
export function sceneSize(scene, cellPx = CELL_PX) {
  return { width: scene.cols * cellPx, height: scene.rows * cellPx };
}

/** Raster der fertigen Karte: genau ein Feld der Szene, sichtbar. */
export function sceneGrid(cellPx = CELL_PX) {
  return { show: true, size: cellPx, offsetX: 0, offsetY: 0, color: 'dunkel' };
}

export function setGround(scene, ground) {
  if (!GROUND_IDS.has(ground) || scene.ground === ground) return scene;
  return { ...scene, ground };
}

// ---------------------------------------------------------------------------
// Gelände
// ---------------------------------------------------------------------------

export function terrainAt(scene, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= scene.cols || cy >= scene.rows) return null;
  return scene.terrain[cy * scene.cols + cx];
}

/**
 * Felder, deren Mitte höchstens radius Felder von (x, y) entfernt ist;
 * bei radius < 0.5 nur das Feld unter dem Punkt. Liefert [[spalte, zeile], …].
 */
export function brushCells(cols, rows, x, y, radius) {
  if (radius < 0.5) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return cx >= 0 && cy >= 0 && cx < cols && cy < rows ? [[cx, cy]] : [];
  }
  const cells = [];
  const limit = radius * radius + EPSILON;
  for (let cy = Math.max(0, Math.floor(y - radius)); cy <= Math.min(rows - 1, Math.floor(y + radius)); cy += 1) {
    for (let cx = Math.max(0, Math.floor(x - radius)); cx <= Math.min(cols - 1, Math.floor(x + radius)); cx += 1) {
      const dx = cx + 0.5 - x;
      const dy = cy + 0.5 - y;
      if (dx * dx + dy * dy <= limit) cells.push([cx, cy]);
    }
  }
  return cells;
}

/**
 * Pinselstrich von from nach to (Punkte in Feldern). Der Pinsel sitzt immer auf der Mitte des
 * Feldes unter dem Punkt, so bleibt seine Form gleich. Liefert dieselbe Szene, wenn sich
 * nichts ändert (dann muss nichts neu gezeichnet werden).
 */
export function paintStroke(scene, from, to, code, radius = 0) {
  if (!TERRAIN_CODES.has(code)) return scene;
  const r = clamp(finite(radius, 0), 0, MAX_BRUSH_RADIUS);
  const end = to ?? from;
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - from.x, end.y - from.y) * 2));
  const terrain = scene.terrain.split('');
  let changed = false;
  for (let step = 0; step <= steps; step += 1) {
    const x = from.x + ((end.x - from.x) * step) / steps;
    const y = from.y + ((end.y - from.y) * step) / steps;
    for (const [cx, cy] of brushCells(scene.cols, scene.rows, Math.floor(x) + 0.5, Math.floor(y) + 0.5, r)) {
      const index = cy * scene.cols + cx;
      if (terrain[index] === code) continue;
      terrain[index] = code;
      changed = true;
    }
  }
  return changed ? { ...scene, terrain: terrain.join('') } : scene;
}

export function paintTerrain(scene, x, y, code, radius = 0) {
  return paintStroke(scene, { x, y }, null, code, radius);
}

// ---------------------------------------------------------------------------
// Objekte
// ---------------------------------------------------------------------------

/** Breite und Höhe des (gedrehten) Objekts als achsenparalleles Rechteck in Feldern. */
export function footprintSize(type, rot = 0, scale = 1) {
  const definition = OBJECT_BY_ID.get(type);
  if (!definition) return { w: 0, h: 0 };
  const angle = (normalizeRotation(rot) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = definition.w * scale;
  const h = definition.h * scale;
  return { w: round2(w * cos + h * sin), h: round2(w * sin + h * cos) };
}

/** Mittelpunkt so einrasten, dass die Grundfläche genau auf Feldern liegt. */
export function snapObject(type, x, y, rot = 0, scale = 1) {
  const { w, h } = footprintSize(type, rot, scale);
  const snap = (value, size) => {
    const offset = Math.max(1, Math.round(size)) % 2 === 1 ? 0.5 : 0;
    return Math.round(value - offset) + offset;
  };
  return { x: snap(x, w), y: snap(y, h) };
}

/** Neues Objekt (spec: type, x, y, rot, scale, seed). Liefert { scene, object } – object null, wenn nicht möglich. */
export function addObject(scene, spec) {
  if (scene.objects.length >= MAX_OBJECTS) return { scene, object: null };
  const number = nextIdNumber(scene.objects);
  const seed = spec?.seed ?? (number * 7919) % MAX_SEED;
  const object = normalizeObject({ ...spec, seed, id: `o${number}` }, scene.cols, scene.rows);
  if (!object) return { scene, object: null };
  return { scene: { ...scene, objects: [...scene.objects, object] }, object };
}

/** Ändert Lage, Drehung, Größe oder Aussehen (seed); Art und Kennung bleiben. */
export function updateObject(scene, id, changes) {
  const index = scene.objects.findIndex((object) => object.id === id);
  if (index < 0) return scene;
  const current = scene.objects[index];
  const next = normalizeObject({ ...current, ...changes, id: current.id, type: current.type }, scene.cols, scene.rows);
  if (Object.keys(next).every((key) => next[key] === current[key])) return scene;
  const objects = scene.objects.slice();
  objects[index] = next;
  return { ...scene, objects };
}

export function moveObject(scene, id, x, y) {
  return updateObject(scene, id, { x, y });
}

export function removeObject(scene, id) {
  const objects = scene.objects.filter((object) => object.id !== id);
  return objects.length === scene.objects.length ? scene : { ...scene, objects };
}

/** Zeichenreihenfolge: flache Objekte zuerst, dann nach Ebene und von oben nach unten. */
export function drawOrder(objects) {
  return objects
    .map((object, index) => ({ object, index, layer: OBJECT_BY_ID.get(object.type)?.layer ?? 1 }))
    .sort((a, b) => a.layer - b.layer || a.object.y - b.object.y || a.index - b.index)
    .map((entry) => entry.object);
}

/** Liegt der Punkt auf der (gedrehten) Grundfläche? tolerance vergrößert sie nach allen Seiten. */
export function objectContains(object, x, y, tolerance = 0) {
  const definition = OBJECT_BY_ID.get(object.type);
  if (!definition) return false;
  const angle = (-object.rot * Math.PI) / 180;
  const dx = x - object.x;
  const dy = y - object.y;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return (
    Math.abs(localX) <= (definition.w * object.scale) / 2 + tolerance &&
    Math.abs(localY) <= (definition.h * object.scale) / 2 + tolerance
  );
}

/** Oberstes Objekt am Punkt (das zuletzt gezeichnete) oder null. */
export function objectAt(scene, x, y, tolerance = 0) {
  const ordered = drawOrder(scene.objects);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (objectContains(ordered[index], x, y, tolerance)) return ordered[index];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Zufall (wiederholbar über den Startwert)
// ---------------------------------------------------------------------------

/** Kleiner Zufallsgenerator (mulberry32): gleicher Startwert → gleiche Folge. */
export function createRandom(seed) {
  let state = Math.trunc(finite(seed, 1)) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (probability) => next() < probability,
    seed: () => Math.floor(next() * MAX_SEED),
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * MAX_SEED);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/** Werkzeugkasten für die Generatoren: Gelände malen, freie Plätze finden, Objekte setzen. */
function createBuilder(scene, random) {
  const { cols, rows } = scene;
  const terrain = scene.terrain.split('');
  const taken = new Uint8Array(cols * rows);
  const objects = [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const get = (x, y) => (inside(x, y) ? terrain[y * cols + x] : null);
  const set = (x, y, code) => {
    if (inside(x, y)) terrain[y * cols + x] = code;
  };

  /** Kreis aus Feldern; only: nur auf diesem Gelände malen (z. B. '.s'). */
  function disc(x, y, radius, code, only = null) {
    for (const [cx, cy] of brushCells(cols, rows, x, y, radius)) {
      if (!only || only.includes(get(cx, cy))) set(cx, cy, code);
    }
  }

  function stroke(points, radius, code, only = null) {
    for (const [x, y] of points) disc(x, y, radius, code, only);
  }

  /** Unregelmäßiger Fleck (Ellipse mit welligem Rand). */
  function blob(cx, cy, rx, ry, code, only = null) {
    const lobes = random.int(2, 4);
    const phase = random.range(0, Math.PI * 2);
    const amount = random.range(0.08, 0.2);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const edge = 1 + amount * Math.sin(Math.atan2(dy, dx) * lobes + phase);
        if (dx * dx + dy * dy <= edge * edge && (!only || only.includes(get(x, y)))) set(x, y, code);
      }
    }
  }

  /** Felder unter einem Rechteck (Mitte x, y), auf die Karte begrenzt. */
  function cellsUnder(x, y, w, h) {
    const cells = [];
    const x0 = Math.max(0, Math.floor(x - w / 2 + EPSILON));
    const x1 = Math.min(cols - 1, Math.ceil(x + w / 2 - EPSILON) - 1);
    const y0 = Math.max(0, Math.floor(y - h / 2 + EPSILON));
    const y1 = Math.min(rows - 1, Math.ceil(y + h / 2 - EPSILON) - 1);
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) cells.push([cx, cy]);
    return cells;
  }

  /** Belegte Fläche: bei core nur das Feld unter dem Mittelpunkt (Baumkronen dürfen sich überlappen). */
  function area(type, x, y, { rot = 0, scale = 1, pad = 0, core = false }) {
    if (core) return cellsUnder(x, y, 0.5, 0.5);
    const size = footprintSize(type, rot, scale);
    return cellsUnder(x, y, Math.max(0.5, size.w + 2 * pad), Math.max(0.5, size.h + 2 * pad));
  }

  const nearCode = (cells, code) =>
    cells.some(([cx, cy]) => {
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) if (get(cx + dx, cy + dy) === code) return true;
      return false;
    });

  /**
   * Passt das Objekt hierher? Das Gelände unter dem Objekt muss in allow liegen, und die Fläche
   * samt Abstand pad darf nicht schon belegt sein.
   */
  function fits(type, x, y, options = {}) {
    const { allow = '.', near = null, spacing = 0, pad = 0 } = options;
    if (x < 0 || y < 0 || x > cols || y > rows || objects.length >= MAX_OBJECTS) return false;
    const body = area(type, x, y, { ...options, pad: Math.min(0, pad) });
    if (!body.length || body.some(([cx, cy]) => !allow.includes(get(cx, cy)))) return false;
    if (area(type, x, y, options).some(([cx, cy]) => taken[cy * cols + cx])) return false;
    if (near && !nearCode(body, near)) return false;
    if (spacing > 0 && objects.some((object) => Math.hypot(object.x - x, object.y - y) < spacing)) return false;
    return true;
  }

  /** Setzt ein Objekt ohne Prüfung und belegt seine Fläche. */
  function place(type, x, y, options = {}) {
    if (objects.length >= MAX_OBJECTS) return null;
    const { rot = 0, scale = 1 } = options;
    const object = {
      id: `o${objects.length + 1}`,
      type,
      x: round2(clamp(x, 0, cols)),
      y: round2(clamp(y, 0, rows)),
      rot: normalizeRotation(rot),
      scale: clampScale(scale),
      seed: random.seed(),
    };
    objects.push(object);
    for (const [cx, cy] of area(type, x, y, options)) taken[cy * cols + cx] = 1;
    return object;
  }

  function tryPlace(type, x, y, options = {}) {
    return fits(type, x, y, options) ? place(type, x, y, options) : null;
  }

  /**
   * Verteilt Objekte zufällig, bis count gesetzt sind oder die Versuche aufgebraucht sind.
   * rot: Zahl, 'frei' (beliebig) oder 'raster' (0/90/180/270). region: { x0, y0, x1, y1 }.
   */
  function scatter(types, options) {
    const { count, tries = count * 12, scale = [1, 1], rot = 'frei', region = null } = options;
    const list = Array.isArray(types) ? types : [types];
    const x0 = region?.x0 ?? 0;
    const y0 = region?.y0 ?? 0;
    const x1 = region?.x1 ?? cols;
    const y1 = region?.y1 ?? rows;
    let placed = 0;
    for (let attempt = 0; attempt < tries && placed < count; attempt += 1) {
      const type = random.pick(list);
      const x = random.range(x0, x1);
      const y = random.range(y0, y1);
      const turn = rot === 'frei' ? random.int(0, 359) : rot === 'raster' ? random.pick([0, 90, 180, 270]) : rot;
      const size = round2(random.range(scale[0], scale[1]));
      if (tryPlace(type, x, y, { ...options, rot: turn, scale: size })) placed += 1;
    }
    return placed;
  }

  /** Sind alle Felder des Rechtecks (links oben x0, y0) frei und auf erlaubtem Gelände? */
  function areaFree(x0, y0, w, h, allow = '.') {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        if (!inside(x, y) || taken[y * cols + x] || !allow.includes(get(x, y))) return false;
      }
    }
    return true;
  }

  function block(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) if (inside(x, y)) taken[y * cols + x] = 1;
  }

  function finish() {
    return normalizeScene({ ...scene, terrain: terrain.join(''), objects });
  }

  return { cols, rows, get, set, disc, stroke, blob, fits, place, tryPlace, scatter, areaFree, block, finish };
}

/**
 * Geschwungene Linie: je Schritt eine Position (Kommazahl) zwischen min und max.
 * target zieht die Linie sanft zu sich hin.
 */
function meander(random, steps, { start, min, max, target = null, pull = 0.02, wiggle = 0.25 }) {
  const result = [];
  let position = start;
  let drift = 0;
  for (let step = 0; step < steps; step += 1) {
    drift = drift * 0.85 + random.range(-wiggle, wiggle) + (target === null ? 0 : (target - position) * pull);
    drift = clamp(drift, -0.7, 0.7);
    position = clamp(position + drift, min, max);
    result.push(position);
  }
  return result;
}

/** Linie von links nach rechts (je halbes Feld ein Punkt). */
const horizontal = (positions) => positions.map((y, index) => [index / 2 + 0.25, y]);
/** Linie von oben nach unten. */
const vertical = (positions) => positions.map((x, index) => [x, index / 2 + 0.25]);
const at = (positions, value) => positions[clamp(Math.round(value * 2), 0, positions.length - 1)];

function generateForest(b, random) {
  const { cols, rows } = b;
  const cx = cols / 2 + random.range(-cols / 8, cols / 8);
  const cy = rows / 2 + random.range(-rows / 8, rows / 8);
  b.blob(cx, cy, cols * random.range(0.13, 0.18), rows * random.range(0.15, 0.21), 'g');
  const path = meander(random, cols * 2, {
    start: random.range(rows * 0.25, rows * 0.75),
    min: 1,
    max: rows - 1,
    target: cy,
    pull: 0.015,
  });
  b.stroke(horizontal(path), 0.8, 'w');

  const clearing = { x0: cx - cols / 5, y0: cy - rows / 4, x1: cx + cols / 5, y1: cy + rows / 4 };
  if (random.chance(0.5)) b.tryPlace('lagerfeuer', Math.floor(cx) + 0.5, Math.floor(cy) + 0.5, { allow: 'g' });
  b.scatter('blumen', { count: random.int(3, 6), allow: 'g', region: clearing });
  b.scatter(['stein', 'baumstumpf'], { count: random.int(2, 4), allow: 'g', region: clearing, scale: [0.7, 1.1] });
  b.scatter('fels', { count: random.int(1, 3), allow: '.', scale: [0.8, 1.3] });
  b.scatter('busch', { count: Math.round((cols * rows) / 30), allow: '.g', near: 'w', scale: [0.7, 1.2] });
  b.scatter(['laubbaum', 'laubbaum', 'nadelbaum'], {
    count: cols * rows,
    tries: cols * rows * 4,
    allow: '.',
    core: true,
    spacing: 1.55,
    scale: [0.8, 1.25],
  });
  b.scatter('busch', { count: Math.round((cols * rows) / 40), allow: '.', scale: [0.7, 1.1] });
}

/** Feld mit Zaun (Zaunstücke sind 3 Felder lang, eine Lücke dient als Tor). */
function fencedField(b, random) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const w = 3 * random.int(2, 3);
    const h = 3 * random.int(1, 2);
    const x0 = random.int(1, b.cols - w - 1);
    const y0 = random.int(1, b.rows - h - 1);
    if (!b.areaFree(x0 - 1, y0 - 1, w + 2, h + 2)) continue;
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) b.set(x, y, 'e');
    const segments = [];
    for (let k = 0; k < w / 3; k += 1) {
      segments.push([x0 + 1.5 + 3 * k, y0, 0], [x0 + 1.5 + 3 * k, y0 + h, 0]);
    }
    for (let k = 0; k < h / 3; k += 1) {
      segments.push([x0, y0 + 1.5 + 3 * k, 90], [x0 + w, y0 + 1.5 + 3 * k, 90]);
    }
    const gate = random.int(0, segments.length - 1);
    segments.forEach(([x, y, rot], index) => {
      if (index !== gate) b.place('zaun', x, y, { rot });
    });
    b.block(x0 - 1, y0 - 1, w + 2, h + 2);
    return true;
  }
  return false;
}

function generateVillage(b, random) {
  const { cols, rows } = b;
  const mainY = rows / 2 + random.range(-rows / 10, rows / 10);
  const road = meander(random, cols * 2, { start: mainY, min: 4, max: rows - 4, target: mainY, wiggle: 0.12 });
  b.stroke(horizontal(road), 1.1, 'w');
  const crossX = cols / 2 + random.range(-cols / 7, cols / 7);
  const side = meander(random, rows * 2, { start: crossX, min: 4, max: cols - 4, target: crossX, wiggle: 0.12 });
  b.stroke(vertical(side), 0.9, 'w');

  // Platz mit Brunnen an der Kreuzung
  const plazaY = at(road, crossX);
  const plazaX = at(side, plazaY);
  b.disc(plazaX, plazaY, 2.7, 'p');
  b.place('brunnen', Math.round(plazaX), Math.round(plazaY), { pad: 0.5 });

  // Häuser entlang der Straßen, die Tür zeigt zur Straße. Passt ein Haus nicht, wird es
  // etwas weiter weg oder seitlich versetzt versucht.
  const house = (x, y, rot, away, along) => {
    const type = random.chance(0.6) ? 'haus' : 'huette';
    for (const distance of [0, 0.8, 1.6]) {
      for (const shift of [0, -1, 1]) {
        const spot = snapObject(
          type,
          x + away.x * distance + along.x * shift,
          y + away.y * distance + along.y * shift,
          rot,
        );
        if (b.tryPlace(type, spot.x, spot.y, { rot, pad: 0.5 })) return true;
      }
    }
    return false;
  };
  for (let x = random.range(2, 4); x < cols - 2; x += random.range(5, 6.5)) {
    for (const direction of [-1, 1]) {
      if (random.chance(0.15)) continue;
      const y = at(road, x) + direction * (1.1 + 1.5 + random.range(0.5, 1));
      house(x, y, direction < 0 ? 0 : 180, { x: 0, y: direction }, { x: 1, y: 0 });
    }
  }
  for (let y = random.range(2, 4); y < rows - 2; y += random.range(5, 6.5)) {
    for (const direction of [-1, 1]) {
      if (random.chance(0.2)) continue;
      const x = at(side, y) + direction * (0.9 + 1.5 + random.range(0.5, 1));
      house(x, y, direction < 0 ? 270 : 90, { x: direction, y: 0 }, { x: 0, y: 1 });
    }
  }

  const fields = random.int(1, 2);
  for (let index = 0; index < fields; index += 1) fencedField(b, random);
  b.scatter(['fass', 'kiste', 'karren', 'fass'], { count: random.int(4, 8), allow: '.', near: 'w', rot: 'raster' });
  b.scatter('laubbaum', {
    count: Math.round((cols * rows) / 45),
    allow: '.',
    pad: -0.3,
    spacing: 2.2,
    scale: [0.8, 1.2],
  });
  b.scatter('busch', { count: Math.round((cols * rows) / 50), allow: '.', scale: [0.7, 1.1] });
  b.scatter('blumen', { count: random.int(4, 8), allow: '.', scale: [0.8, 1.1] });
}

function generateCamp(b, random) {
  const { cols, rows } = b;
  const cx = Math.floor(cols / 2 + random.range(-cols / 10, cols / 10)) + 0.5;
  const cy = Math.floor(rows / 2 + random.range(-rows / 10, rows / 10)) + 0.5;
  const radius = Math.max(4, Math.min(cols, rows) * random.range(0.27, 0.32));
  b.blob(cx, cy, radius, radius * 0.85, 'e');

  // Weg aus dem Lager zu einer Kante
  const edge = random.int(0, 3);
  if (edge < 2) {
    const steps = Math.ceil((edge === 0 ? cx : cols - cx) * 2);
    const ys = meander(random, steps, { start: cy, min: 1, max: rows - 1 });
    b.stroke(
      ys.map((y, index) => [cx + (edge === 0 ? -1 : 1) * (index / 2), y]),
      0.75,
      'w',
      '.e',
    );
  } else {
    const steps = Math.ceil((edge === 2 ? cy : rows - cy) * 2);
    const xs = meander(random, steps, { start: cx, min: 1, max: cols - 1 });
    b.stroke(
      xs.map((x, index) => [x, cy + (edge === 2 ? -1 : 1) * (index / 2)]),
      0.75,
      'w',
      '.e',
    );
  }

  b.place('lagerfeuer', cx, cy, { pad: 0.5 });

  // Zelte im Kreis, der Eingang zeigt zum Feuer
  const tents = random.int(4, 6);
  const ring = Math.max(3.3, radius * 0.6);
  const start = random.range(0, Math.PI * 2);
  for (let index = 0; index < tents; index += 1) {
    const base = start + (Math.PI * 2 * index) / tents;
    const scale = random.range(0.95, 1.15);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = base + random.range(-0.3, 0.3);
      const distance = ring + random.range(0, 1.2);
      const rot = Math.round((Math.atan2(Math.cos(angle), -Math.sin(angle)) * 180) / Math.PI);
      const options = { rot, scale, allow: 'e.w', pad: -0.3 };
      if (b.tryPlace('zelt', cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, options)) break;
    }
  }
  const seats = random.int(2, 4);
  for (let index = 0; index < seats; index += 1) {
    const angle = (Math.PI * 2 * index) / seats + random.range(-0.4, 0.4);
    b.tryPlace('baumstumpf', cx + Math.cos(angle) * 1.5, cy + Math.sin(angle) * 1.5, {
      allow: 'ew',
      scale: 0.6,
      core: true,
    });
  }
  const camp = { x0: cx - radius, y0: cy - radius, x1: cx + radius, y1: cy + radius };
  b.scatter(['kiste', 'fass', 'kiste', 'fass'], { count: random.int(4, 7), allow: 'e', region: camp, pad: 0.1 });
  b.scatter(['karren', 'tisch'], { count: random.int(1, 2), allow: 'e', region: camp, rot: 'raster', pad: 0.2 });
  b.scatter(['laubbaum', 'nadelbaum'], {
    count: Math.round((cols * rows) / 18),
    allow: '.',
    core: true,
    spacing: 1.8,
    scale: [0.8, 1.2],
  });
  b.scatter(['busch', 'stein', 'busch'], { count: Math.round((cols * rows) / 45), allow: '.', scale: [0.7, 1.1] });
}

function generateRiver(b, random) {
  const { cols, rows } = b;
  const width = random.range(2.2, 3.4);
  const startX = cols / 2 + random.range(-cols / 6, cols / 6);
  const river = meander(random, rows * 2, { start: startX, min: 3, max: cols - 3, target: cols / 2, wiggle: 0.3 });
  const points = vertical(river);
  // Sandbänke an manchen Stellen, dann das Wasser
  const phase = random.range(0, Math.PI * 2);
  b.stroke(
    points.filter((_, index) => Math.sin(index * 0.15 + phase) > -0.2),
    width / 2 + 1.1,
    's',
  );
  b.stroke(points, width / 2, '~');

  // Brücke mit Weg von beiden Ufern
  const bridgeY = Math.round(rows / 2 + random.range(-rows / 6, rows / 6));
  const bridgeX = at(river, bridgeY);
  const scale = clamp((width + 2.4) / 4, 1, 1.6);
  const half = 2 * scale;
  const left = meander(random, Math.ceil((bridgeX - half) * 2) + 1, { start: bridgeY, min: 2, max: rows - 2 });
  const right = meander(random, Math.ceil((cols - bridgeX - half) * 2) + 1, { start: bridgeY, min: 2, max: rows - 2 });
  b.stroke(
    left.map((y, index) => [bridgeX - half - index / 2 + 0.3, y]),
    0.75,
    'w',
    '.s',
  );
  b.stroke(
    right.map((y, index) => [bridgeX + half + index / 2 - 0.3, y]),
    0.75,
    'w',
    '.s',
  );
  b.place('bruecke', bridgeX, bridgeY, { scale });

  b.scatter('schilf', { count: random.int(8, 14), allow: '.s', near: '~', scale: [0.8, 1.2] });
  b.scatter(['stein', 'stein', 'busch'], { count: random.int(3, 6), allow: 's', scale: [0.6, 1.1] });
  b.scatter(['laubbaum', 'laubbaum', 'nadelbaum'], {
    count: Math.round((cols * rows) / 12),
    allow: '.',
    core: true,
    spacing: 1.7,
    scale: [0.8, 1.25],
  });
  b.scatter(['busch', 'blumen', 'fels'], { count: Math.round((cols * rows) / 40), allow: '.', scale: [0.7, 1.1] });
}

/** Höhlenwände per Zellautomat; behält nur den größten zusammenhängenden Hohlraum. */
function caveWalls(cols, rows, random) {
  const border = (x, y) => x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
  let wall = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) wall[y * cols + x] = border(x, y) || random.chance(0.45) ? 1 : 0;
  }
  for (let round = 0; round < 5; round += 1) {
    const next = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            count += nx < 0 || ny < 0 || nx >= cols || ny >= rows ? 1 : wall[ny * cols + nx];
          }
        }
        next[y * cols + x] = border(x, y) || count >= 5 ? 1 : 0;
      }
    }
    wall = next;
  }
  // Größter Hohlraum
  const region = new Int32Array(cols * rows).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let start = 0; start < cols * rows; start += 1) {
    if (wall[start] || region[start] >= 0) continue;
    const stack = [start];
    region[start] = start;
    let size = 0;
    while (stack.length) {
      const index = stack.pop();
      size += 1;
      const x = index % cols;
      const y = (index - x) / cols;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        const neighbor = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !wall[neighbor] && region[neighbor] < 0) {
          region[neighbor] = start;
          stack.push(neighbor);
        }
      }
    }
    if (size > bestSize) {
      best = start;
      bestSize = size;
    }
  }
  for (let index = 0; index < cols * rows; index += 1) if (region[index] !== best) wall[index] = 1;
  return { wall, open: bestSize };
}

function generateCave(b, random) {
  const { cols, rows } = b;
  let cave = caveWalls(cols, rows, random);
  for (let attempt = 0; attempt < 6 && cave.open < cols * rows * 0.35; attempt += 1) {
    cave = caveWalls(cols, rows, random);
  }
  if (cave.open < cols * rows * 0.2) {
    // Notlösung: eine große Grotte in der Mitte
    cave.wall.fill(1);
    const rx = cols * 0.38;
    const ry = rows * 0.38;
    for (let y = 1; y < rows - 1; y += 1) {
      for (let x = 1; x < cols - 1; x += 1) {
        const dx = (x + 0.5 - cols / 2) / rx;
        const dy = (y + 0.5 - rows / 2) / ry;
        if (dx * dx + dy * dy <= 1) cave.wall[y * cols + x] = 0;
      }
    }
  }
  const { wall } = cave;
  // Eingang: die Zeile, deren Hohlraum der linken Kante am nächsten kommt, nach außen öffnen
  let entrance = null;
  for (let y = 2; y < rows - 2; y += 1) {
    const x = Array.from({ length: cols }, (_, index) => index).find((index) => !wall[y * cols + index]);
    if (x !== undefined && (!entrance || x < entrance.x)) entrance = { x, y };
  }
  if (entrance) {
    for (let x = 0; x < entrance.x; x += 1) {
      wall[entrance.y * cols + x] = 0;
      wall[(entrance.y + 1) * cols + x] = 0;
    }
  }
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) if (wall[y * cols + x]) b.set(x, y, 'f');

  // Wasserstellen mitten im Hohlraum
  const pools = random.int(1, 2);
  for (let index = 0, tries = 0; index < pools && tries < 200; tries += 1) {
    const x = random.int(2, cols - 3);
    const y = random.int(2, rows - 3);
    let open = true;
    for (let dy = -2; dy <= 2 && open; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1) if (b.get(x + dx, y + dy) !== '.') open = false;
    if (!open) continue;
    b.disc(x + 0.5, y + 0.5, random.range(1.4, 2), '~', '.');
    index += 1;
  }

  b.scatter('fels', { count: random.int(3, 6), allow: '.', pad: 0.2, scale: [0.7, 1.4] });
  b.scatter('stein', { count: Math.round((cols * rows) / 25), allow: '.', core: true, scale: [0.6, 1.3] });
  b.scatter(['kiste', 'fass'], { count: random.int(2, 5), allow: '.', near: 'f', rot: 'raster' });
  if (random.chance(0.5)) b.scatter('lagerfeuer', { count: 1, allow: '.', pad: 1 });
}

const GENERATORS = {
  wald: generateForest,
  dorf: generateVillage,
  lager: generateCamp,
  fluss: generateRiver,
  hoehle: generateCave,
};

/** Erzeugt eine fertige Szene. Gleiche Werte (Thema, Größe, seed) → gleiche Karte. */
export function generateScene({ theme, cols, rows, seed = 1 } = {}) {
  const definition = THEMES.find((entry) => entry.id === theme) ?? THEMES[0];
  const scene = createScene({ cols, rows, ground: definition.ground });
  const random = createRandom(seed);
  const builder = createBuilder(scene, random);
  GENERATORS[definition.id](builder, random);
  return builder.finish();
}
