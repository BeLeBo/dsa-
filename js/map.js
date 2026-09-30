/**
 * map.js – Karte und Figuren als reine Funktionen (ohne DOM und ohne Server):
 * Raster, Einrasten, Ansicht (Verschieben und Zoomen), neue Figuren aufstellen.
 *
 * Koordinaten sind Bildpunkte der Karte, (0, 0) ist links oben. Figuren werden über
 * ihren Mittelpunkt positioniert, ihre Größe zählt in Rasterfeldern.
 * Eine Ansicht ist { x, y, scale }: Bildschirm = Karte × scale + (x, y).
 */
import { toNumber } from './rules.js';

export const TOKEN_COLORS = Object.freeze([
  { id: 'rot', name: 'Rot', value: '#b3261e' },
  { id: 'blau', name: 'Blau', value: '#1d4ed8' },
  { id: 'gruen', name: 'Grün', value: '#15803d' },
  { id: 'gelb', name: 'Gelb', value: '#b98900' },
  { id: 'lila', name: 'Lila', value: '#7e22ce' },
  { id: 'grau', name: 'Grau', value: '#57534e' },
]);

export const TOKEN_SIZES = Object.freeze([
  { value: 0.5, name: 'Klein (halbes Feld)' },
  { value: 1, name: 'Mittel (1 Feld)' },
  { value: 2, name: 'Groß (2 × 2 Felder)' },
  { value: 3, name: 'Riesig (3 × 3 Felder)' },
  { value: 4, name: 'Gewaltig (4 × 4 Felder)' },
]);

export const GRID_COLORS = Object.freeze([
  { id: 'dunkel', name: 'Dunkel' },
  { id: 'hell', name: 'Hell' },
]);

export const MIN_GRID_SIZE = 10;
export const MAX_GRID_SIZE = 400;
/** Längste Seite einer Karte nach dem Verkleinern (Bildpunkte). */
export const MAP_MAX_EDGE = 3000;
/** Figurenbilder werden quadratisch auf diese Kantenlänge gebracht (scharf auch stark vergrößert). */
export const TOKEN_IMAGE_EDGE = 512;
export const MAX_TOKENS_AT_ONCE = 20;
export const MAX_TOKEN_NAME_LENGTH = 40;
export const MAX_MAP_NAME_LENGTH = 60;
/** Grenzen für die LeP von Gegnern/NSC (wie in der Datenbank). */
export const MIN_TOKEN_LIFE = -999;
export const MAX_TOKEN_LIFE = 9999;
/** Stärkste Vergrößerung: ein Kartenpunkt = 4 Bildschirmpunkte. */
export const MAX_ZOOM = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

export function clampGridSize(size) {
  return round2(clamp(toNumber(size) || MIN_GRID_SIZE, MIN_GRID_SIZE, MAX_GRID_SIZE));
}

/** Startwerte für eine neue Karte: etwa 30 Felder auf der längeren Seite, Raster aus. */
export function defaultGrid(width, height) {
  return {
    show: false,
    size: clampGridSize(Math.round(Math.max(width, height) / 30)),
    offsetX: 0,
    offsetY: 0,
    color: GRID_COLORS[0].id,
  };
}

/** Vervollständigt und begrenzt gespeicherte Rasterwerte; Versatz liegt immer in [0, Feldgröße). */
export function normalizeGrid(grid, map) {
  const base = defaultGrid(map.width, map.height);
  const source = grid && typeof grid === 'object' ? grid : {};
  const size = source.size === undefined ? base.size : clampGridSize(source.size);
  const wrap = (offset) => {
    const value = round2(((toNumber(offset) % size) + size) % size);
    return value >= size ? 0 : value;
  };
  return {
    show: source.show === true,
    size,
    offsetX: wrap(source.offsetX ?? 0),
    offsetY: wrap(source.offsetY ?? 0),
    color: GRID_COLORS.some((option) => option.id === source.color) ? source.color : base.color,
  };
}

/** Feldgröße aus „so viele Felder passen in die Breite“. */
export function gridSizeFromCells(width, cells) {
  const count = toNumber(cells);
  return count > 0 ? clampGridSize(width / count) : clampGridSize(width);
}

/** Wie viele Felder passen in die Breite (auf eine Nachkommastelle)? */
export function cellsAcross(width, size) {
  return Math.round((width / size) * 10) / 10;
}

/** Durchmesser einer Figur in Kartenpunkten. */
export function tokenDiameter(tokenSize, grid) {
  return grid.size * (toNumber(tokenSize) || 1);
}

/**
 * Rastet einen Punkt ein (nur bei sichtbarem Raster): Figuren mit ungerader Feldzahl
 * (½, 1, 3) auf die Feldmitte, mit gerader Feldzahl (2, 4) auf den Schnittpunkt der Linien.
 */
export function snapToGrid(point, tokenSize, grid) {
  if (!grid.show) return { ...point };
  const cells = Math.max(1, toNumber(tokenSize) || 1);
  const onLines = cells % 2 === 0;
  const snap = (value, offset) => {
    const steps = (value - offset) / grid.size;
    const snapped = onLines ? Math.round(steps) : Math.floor(steps) + 0.5;
    return round2(offset + snapped * grid.size);
  };
  return { x: snap(point.x, grid.offsetX), y: snap(point.y, grid.offsetY) };
}

/** Hält einen Punkt auf der Karte. */
export function clampToMap(point, map) {
  return { x: clamp(point.x, 0, map.width), y: clamp(point.y, 0, map.height) };
}

// ---------------------------------------------------------------------------
// Neue Figuren
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Namen für neue Figuren. Mehrere oder schon vorhandene gleichnamige Figuren werden
 * fortlaufend nummeriert: „Ork“ × 3 → „Ork 1“ … „Ork 3“, danach „Ork 4“ usw.
 */
export function numberedNames(name, count, existingNames = []) {
  const label =
    String(name ?? '')
      .trim()
      .slice(0, MAX_TOKEN_NAME_LENGTH - 3) || 'Figur';
  const amount = clamp(Math.trunc(toNumber(count)) || 1, 1, MAX_TOKENS_AT_ONCE);
  const pattern = new RegExp(`^${escapeRegExp(label)} (\\d+)$`);
  const used = existingNames
    .map((existing) => pattern.exec(existing)?.[1])
    .filter(Boolean)
    .map(Number);
  const plainTaken = existingNames.includes(label);
  if (amount === 1 && !plainTaken && used.length === 0) return [label];
  const start = Math.max(plainTaken ? 1 : 0, ...used) + 1;
  return Array.from({ length: amount }, (_, index) => `${label} ${start + index}`);
}

/** Kürzel für Figuren ohne Bild: „Alrik Wolfsfell“ → „AW“, „Ork 12“ → „O12“. */
export function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const number = /^\d+$/.test(words.at(-1)) && words.length > 1 ? words.pop() : '';
  const letters = words
    .slice(0, number ? 1 : 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return `${letters}${number}`;
}

/** Farbe für die n-te neue Figur (reihum). */
export function colorForIndex(index) {
  return TOKEN_COLORS[Math.abs(Math.trunc(index)) % TOKEN_COLORS.length].id;
}

/**
 * Freie Plätze für neue Figuren rund um einen Punkt: zuerst die Mitte, dann nach Entfernung
 * (bei Gleichstand erst links und rechts, dann oben und unten), ein Feld Abstand, eingerastet
 * und auf der Karte. Plätze, an denen schon eine Figur steht, werden übersprungen.
 * @param {{x: number, y: number}[]} occupied  Mittelpunkte vorhandener Figuren
 */
export function placeTokens(count, center, tokenSize, grid, map, occupied = []) {
  const spacing = tokenDiameter(tokenSize, grid);
  const taken = occupied.map((point) => ({ x: point.x, y: point.y }));
  const isFree = (point) => taken.every((other) => Math.hypot(other.x - point.x, other.y - point.y) >= spacing / 2);
  const radius = Math.ceil(Math.sqrt(count + taken.length)) + 1;
  const offsets = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let column = -radius; column <= radius; column += 1) offsets.push({ column, row });
  }
  const distanceOf = ({ column, row }) => column ** 2 + row ** 2;
  offsets.sort(
    (a, b) =>
      distanceOf(a) - distanceOf(b) || Math.abs(a.row) - Math.abs(b.row) || a.row - b.row || a.column - b.column,
  );
  const positions = [];
  for (const { column, row } of offsets) {
    if (positions.length === count) break;
    const candidate = clampToMap({ x: center.x + column * spacing, y: center.y + row * spacing }, map);
    const point = clampToMap(snapToGrid(candidate, tokenSize, grid), map);
    if (isFree(point)) {
      positions.push(point);
      taken.push(point);
    }
  }
  while (positions.length < count) positions.push(clampToMap(center, map)); // alles belegt: übereinander
  return positions;
}

// ---------------------------------------------------------------------------
// Auswahl und Gruppen bewegen
// ---------------------------------------------------------------------------

/** Rechteck aus zwei beliebigen Ecken: { left, top, right, bottom }. */
export function normalizeRect(a, b) {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/**
 * Figuren, die ein Auswahlrechteck (Kartenpunkte) berühren – Figuren sind Kreise.
 * @returns {string[]} IDs
 */
export function tokensInRect(tokens, rect, grid) {
  return tokens
    .filter((token) => {
      const radius = tokenDiameter(token.size, grid) / 2;
      const nearestX = Math.min(Math.max(token.x, rect.left), rect.right);
      const nearestY = Math.min(Math.max(token.y, rect.top), rect.bottom);
      return Math.hypot(token.x - nearestX, token.y - nearestY) <= radius;
    })
    .map((token) => token.id);
}

/**
 * Mehrere Figuren gemeinsam bewegen: Die gezogene Figur rastet am Ziel ein, alle anderen
 * wandern um denselben Weg mit (und rasten ebenfalls ein) – die Formation bleibt erhalten.
 * @param {object[]} group  die bewegten Figuren (mit ursprünglicher Position)
 * @param {string} leaderId  die gezogene Figur
 * @param {{x, y}} target    wohin die gezogene Figur abgelegt wurde
 * @returns {{ id: string, x: number, y: number }[]}
 */
export function moveGroup(group, leaderId, target, grid, map) {
  const leader = group.find((token) => token.id === leaderId) ?? group[0];
  const snapped = clampToMap(snapToGrid(clampToMap(target, map), leader.size, grid), map);
  const dx = snapped.x - leader.x;
  const dy = snapped.y - leader.y;
  return group.map((token) => {
    if (token === leader) return { id: token.id, ...snapped };
    const point = clampToMap(snapToGrid(clampToMap({ x: token.x + dx, y: token.y + dy }, map), token.size, grid), map);
    return { id: token.id, ...point };
  });
}

// ---------------------------------------------------------------------------
// Lebensenergie von Gegnern und NSC
// ---------------------------------------------------------------------------

/**
 * Eingabe → ganze Zahl in den erlaubten Grenzen, leer oder ungültig → null („nicht erfasst“).
 * @param {number} [min]  kleinster Wert (für das Maximum 0, für den aktuellen Wert negativ erlaubt)
 */
export function parseLife(value, min = MIN_TOKEN_LIFE) {
  const text = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (text === '') return null;
  const number = Math.round(Number(text));
  return Number.isFinite(number) ? clamp(number, min, MAX_TOKEN_LIFE) : null;
}

/**
 * Neues LeP-Maximum einer Figur: Wer noch keine LeP hatte oder unverletzt war, hat danach volle LeP;
 * sonst bleibt der aktuelle Wert. Leer entfernt die LeP.
 */
export function lifeAfterMaxChange(token, leMax) {
  if (leMax === null) return { le_max: null, le_current: null };
  const unhurt = token.le_current === null || token.le_current === undefined || token.le_current === token.le_max;
  return { le_max: leMax, le_current: unhurt ? leMax : token.le_current };
}

/** Abschnitte der ungefähren Lebensanzeige von Gegnern – Viertel, wie die Schmerzstufen (¾, ½, ¼). */
export const LIFE_SEGMENTS = 4;

const lifeNumber = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));

/**
 * Lebensbalken: genau oder – für Gegner aus Sicht der Spieler – nur in Abschnitten: Man sieht,
 * in welchem Abschnitt die Figur steckt (volle Abschnitte), aber nicht die genauen LeP.
 * @returns {{ cells: number[], level: 'gut'|'verletzt'|'kritisch'|'am-boden', label: string } | null}
 *          cells = Füllung je Abschnitt (0 … 1); null, wenn keine LeP bekannt sind
 */
export function lifeBar(currentValue, maxValue, { segments = 1, exact = true } = {}) {
  const current = Math.round(lifeNumber(currentValue));
  const max = Math.round(lifeNumber(maxValue));
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
  const fraction = clamp(current / max, 0, 1);
  const filled = current <= 0 ? 0 : Math.max(1, Math.ceil(fraction * segments - 1e-9));
  const shown = exact ? fraction : filled / segments;
  const cells = Array.from({ length: segments }, (_, index) => round2(clamp(shown * segments - index, 0, 1)));
  let level = 'kritisch';
  if (current <= 0) level = 'am-boden';
  else if (shown > 0.5) level = 'gut';
  else if (shown > 0.25) level = 'verletzt';
  const label = exact ? `LeP ${current} von ${max}` : `Lebensenergie etwa ${filled} von ${segments} Vierteln`;
  return { cells, level, label };
}

/**
 * Lebensbalken einer Figur. Helden: genau – aus dem Heldenbogen, wenn das Gerät ihn kennt,
 * sonst aus der Figur (die Datenbank spiegelt die LeP der Helden auf ihre Figuren).
 * Gegner/NSC: in Abschnitten, genau nur für den Meister.
 */
export function tokenLifeBar(token, hero, { master = false } = {}) {
  if (token.character_id) {
    const pool = hero?.base?.le;
    return pool ? lifeBar(pool.current, pool.max) : lifeBar(token.le_current, token.le_max);
  }
  return lifeBar(token.le_current, token.le_max, { segments: LIFE_SEGMENTS, exact: master });
}

/**
 * Figuren, die zum Eintrag „am Zug“ im Kampf gehören: Helden über die Helden-ID,
 * Gegner über den Namen (z. B. „Ork 2“ im Kampf und auf der Karte).
 */
export function tokensForTurn(tokens, entry) {
  if (!entry) return [];
  return tokens
    .filter((token) =>
      entry.characterId ? token.character_id === entry.characterId : !token.character_id && token.name === entry.name,
    )
    .map((token) => token.id);
}

/** Kartenname aus dem Dateinamen: „dunkle_hoehle-2.jpg“ → „dunkle hoehle 2“. */
export function mapNameFromFile(fileName) {
  const name = String(fileName ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.slice(0, MAX_MAP_NAME_LENGTH) || 'Karte';
}

/** Zielgröße beim Verkleinern (Seitenverhältnis bleibt, nie vergrößern). */
export function scaledSize(width, height, maxEdge) {
  const factor = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

// ---------------------------------------------------------------------------
// Ansicht: Verschieben und Zoomen
// ---------------------------------------------------------------------------

/** Ganze Karte mittig im Sichtbereich. */
export function fitView(viewport, map, padding = 12) {
  const scale = Math.min(
    (viewport.width - 2 * padding) / map.width,
    (viewport.height - 2 * padding) / map.height,
    MAX_ZOOM,
  );
  const safeScale = scale > 0 ? scale : 1;
  return {
    scale: safeScale,
    x: (viewport.width - map.width * safeScale) / 2,
    y: (viewport.height - map.height * safeScale) / 2,
  };
}

/** Kleinste und größte erlaubte Vergrößerung. */
export function zoomLimits(viewport, map) {
  const fit = fitView(viewport, map, 0).scale;
  return { min: Math.min(fit / 2, 1), max: MAX_ZOOM };
}

/**
 * Hält die Karte im Blick: Die Mitte des Sichtbereichs liegt immer auf der Karte,
 * man kann sie also nie ganz aus dem Bild schieben.
 */
export function clampView(view, viewport, map) {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    scale: view.scale,
    x: clamp(view.x, centerX - map.width * view.scale, centerX),
    y: clamp(view.y, centerY - map.height * view.scale, centerY),
  };
}

export function screenToMap(view, point) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

export function mapToScreen(view, point) {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y };
}

/** Zoomt um einen Bildschirmpunkt: Der Kartenpunkt darunter bleibt, wo er ist. */
export function zoomAt(view, factor, point, limits) {
  const scale = clamp(view.scale * factor, limits.min, limits.max);
  const anchor = screenToMap(view, point);
  return { scale, x: point.x - anchor.x * scale, y: point.y - anchor.y * scale };
}

export function panBy(view, dx, dy) {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * Zwei-Finger-Geste: Ausgangsansicht, Abstand und Mitte der Finger vorher und jetzt.
 * Der Kartenpunkt unter der alten Mitte folgt der neuen Mitte.
 */
export function pinchView(startView, start, now, limits) {
  const factor = start.distance > 0 ? now.distance / start.distance : 1;
  const zoomed = zoomAt(startView, factor, start.center, limits);
  return panBy(zoomed, now.center.x - start.center.x, now.center.y - start.center.y);
}
