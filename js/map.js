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

/** Feldgröße in Kartenpunkten. Sehr kleine Felder: Stadtkarten, auf denen man in Gassen spielt. */
export const MIN_GRID_SIZE = 2;
export const MAX_GRID_SIZE = 1000;
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
/** „Ganze Karte“ vergrößert kleine Bilder höchstens so stark. */
export const MAX_FIT_ZOOM = 4;
/** Hineinzoomen: mindestens bis ein Kartenpunkt 8 Bildschirmpunkte groß ist … */
export const MAX_ZOOM = 8;
/** … und bei feinem Raster so weit, dass ein Feld so groß wird (Gassen auf Stadtkarten) – mit Obergrenze. */
export const MAX_CELL_SCREEN_PX = 240;
export const MAX_ZOOM_LIMIT = 120;

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
    MAX_FIT_ZOOM,
  );
  const safeScale = scale > 0 ? scale : 1;
  return {
    scale: safeScale,
    x: (viewport.width - map.width * safeScale) / 2,
    y: (viewport.height - map.height * safeScale) / 2,
  };
}

/**
 * Kleinste und größte erlaubte Vergrößerung. Mit Raster: so weit hinein, dass ein Feld bis zu
 * MAX_CELL_SCREEN_PX groß wird – auf Stadtkarten mit feinem Raster also bis in die Gassen.
 */
export function zoomLimits(viewport, map, grid = null) {
  const fit = fitView(viewport, map, 0).scale;
  const byCell = grid?.size > 0 ? MAX_CELL_SCREEN_PX / grid.size : 0;
  return { min: Math.min(fit / 2, 1), max: Math.min(MAX_ZOOM_LIMIT, Math.max(MAX_ZOOM, byCell)) };
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
 * Liegt der Punkt außerhalb oder näher als `margin` am Rand, die Ansicht (gleicher Zoom),
 * in der er in der Mitte steht – sonst null (ist schon gut zu sehen).
 */
export function viewToReveal(view, point, viewport, margin) {
  const screen = mapToScreen(view, point);
  const visible =
    screen.x >= margin &&
    screen.x <= viewport.width - margin &&
    screen.y >= margin &&
    screen.y <= viewport.height - margin;
  return visible ? null : panBy(view, viewport.width / 2 - screen.x, viewport.height / 2 - screen.y);
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

// -----------------------------------------------------------------------------
// Ping: Der Meister markiert eine Stelle, alle sehen sie kurz aufleuchten.
// -----------------------------------------------------------------------------

/** So lange leuchtet ein Ping auf der Karte. */
export const PING_DURATION_MS = 5000;

/** Neuer Ping an einer Stelle der Karte (ganze Bildpunkte, auf der Karte). */
export function createPing(map, point, id) {
  const { x, y } = clampToMap(point, map);
  return { id, map_id: map.id, x: Math.round(x), y: Math.round(y) };
}

/** Ping vom Server prüfen – null, wenn keiner da oder er unbrauchbar ist. */
export function normalizePing(value) {
  if (!value || typeof value !== 'object') return null;
  const { id, map_id: mapId, x, y } = value;
  const valid =
    typeof id === 'string' && id !== '' && typeof mapId === 'string' && Number.isFinite(x) && Number.isFinite(y);
  return valid ? { id, map_id: mapId, x, y } : null;
}

// -----------------------------------------------------------------------------
// Gespeicherte Figuren (Vorlagen des Meisters)
// -----------------------------------------------------------------------------

export const MAX_INI_BASE = 99;

/** „Ork 2“ → „Ork“: Name ohne die Nummer, die beim Aufstellen mehrerer Figuren angehängt wird. */
export function baseTokenName(name) {
  return String(name ?? '')
    .replace(/\s+\d+$/, '')
    .trim();
}

/** INI-Basis aus einer Eingabe: leer oder ungültig → null, sonst 0 bis 99. */
export function parseIniBase(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const number = Math.round(Number(text.replace(',', '.')));
  return Number.isFinite(number) ? clamp(number, 0, MAX_INI_BASE) : null;
}

/** Gespeicherte Figuren nach Namen (deutsch sortiert, ohne Groß/klein). */
export function sortTemplates(templates) {
  return [...templates].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

// -----------------------------------------------------------------------------
// Zeichnen: Meister und Spieler malen mit dem Stift auf die Karte – alle sehen es live.
// Eine Zeichnung: { id, map_id, kind, color, width, fill, points: [{ x, y }, …], created_by }
// in Kartenpunkten. kind: 'line' (freihand), 'straight' (gerade Linie), 'arrow' (Pfeil),
// 'rect', 'ellipse' (Formen: zwei Eckpunkte) und 'fill' (Farbeimer: Umrisse der gefüllten Fläche
// in rings – außen und Löcher; points ist dann der äußere Umriss).
// color: Name aus DRAW_COLORS oder '#rrggbb'; fill: Füllfarbe '#rrggbbaa' oder null.
// created_by ist die Nutzer-ID des Zeichners (leer bei älteren Linien des Meisters).
// -----------------------------------------------------------------------------

/** Benannte Stiftfarben – kräftig, damit sie auf hellen und dunklen Karten auffallen. */
export const DRAW_COLORS = Object.freeze([
  { id: 'rot', name: 'Rot', value: '#e02424' },
  { id: 'gelb', name: 'Gelb', value: '#facc15' },
  { id: 'gruen', name: 'Grün', value: '#16a34a' },
  { id: 'blau', name: 'Blau', value: '#2563eb' },
  { id: 'lila', name: 'Lila', value: '#9333ea' },
  { id: 'schwarz', name: 'Schwarz', value: '#111111' },
  { id: 'weiss', name: 'Weiß', value: '#ffffff' },
]);
/** Farben in der Stiftleiste (Lila und alle anderen gibt es über „Eigene Farbe“). */
export const DRAW_PALETTE = Object.freeze(['rot', 'gelb', 'gruen', 'blau', 'schwarz', 'weiss']);

/** Strichstärken als Anteil eines Rasterfelds – so wirken sie auf jeder Karte gleich dick. */
export const DRAW_WIDTHS = Object.freeze([
  { id: 'duenn', name: 'Dünn', cells: 0.06 },
  { id: 'mittel', name: 'Mittel', cells: 0.12 },
  { id: 'dick', name: 'Dick', cells: 0.25 },
]);

/** Arten von Zeichnungen; Formen bestehen aus genau zwei Punkten (Anfang/Ende bzw. Ecken). */
export const DRAW_KINDS = Object.freeze(['line', 'straight', 'arrow', 'rect', 'ellipse', 'fill']);
export const SHAPE_KINDS = Object.freeze(['straight', 'arrow', 'rect', 'ellipse']);
/** Füllung von Rechteck, Kreis und Farbeimer: Deckkraft (keine Füllung nur bei Formen). */
export const DRAW_FILLS = Object.freeze([
  { id: 'keine', name: 'Ohne Füllung', alpha: 0 },
  { id: 'halb', name: 'Füllung halb durchsichtig', alpha: 0.45 },
  { id: 'voll', name: 'Füllung deckend', alpha: 1 },
]);

/** So viele Punkte hat eine Linie höchstens – längere werden beim Zeichnen aufgeteilt. */
export const MAX_DRAWING_POINTS = 1500;
export const MAX_DRAWING_WIDTH = 200;

const round1 = (value) => Math.round(value * 10) / 10;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const HEX_FILL = /^#[0-9a-f]{8}$/;

/**
 * Farbe aus einer Eingabe: Name aus DRAW_COLORS oder Hex („#3a7bd5“, „3A7BD5“, „#abc“) –
 * Hex immer klein und sechsstellig. null, wenn unbrauchbar.
 */
export function normalizeColor(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (DRAW_COLORS.some((color) => color.id === text)) return text;
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join('')}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** Füllfarbe vom Server prüfen: '#rrggbbaa' oder null. */
export function normalizeFill(value) {
  const text = String(value ?? '').toLowerCase();
  return HEX_FILL.test(text) ? text : null;
}

/** Hexwert einer Farbe (Name oder Hex). */
export function drawColorValue(color) {
  if (HEX_COLOR.test(color ?? '')) return color;
  return (DRAW_COLORS.find((entry) => entry.id === color) ?? DRAW_COLORS[0]).value;
}

/** Füllfarbe zu Farbe und Füllung ('halb' | 'voll'); null bei 'keine'. */
export function fillColor(color, fillId) {
  const { alpha } = DRAW_FILLS.find((entry) => entry.id === fillId) ?? DRAW_FILLS[1];
  if (!(alpha > 0)) return null;
  return `${drawColorValue(color)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** '#rrggbbaa' → { color: '#rrggbb', opacity: 0 … 1 } (für SVG und Leinwand). */
export function fillParts(fill) {
  return { color: fill.slice(0, 7), opacity: Math.round((parseInt(fill.slice(7, 9), 16) / 255) * 100) / 100 };
}

/** Strichstärke in Kartenpunkten für die gewählte Stärke und das Raster der Karte. */
export function drawingWidth(widthId, grid) {
  const { cells } = DRAW_WIDTHS.find((entry) => entry.id === widthId) ?? DRAW_WIDTHS[1];
  return round1(clamp(cells * grid.size, 1, MAX_DRAWING_WIDTH));
}

/** Punkte für den Server: [x1, y1, x2, y2, …], auf eine Nachkommastelle gerundet. */
export function flattenPoints(points) {
  return points.flatMap(({ x, y }) => [round1(x), round1(y)]);
}

/** Trennt beim Farbeimer die Umrisse (außen, Löcher) – Kartenpunkte sind nie negativ. */
const RING_BREAK = -1;

/** Umrisse für den Server: wie flattenPoints, zwischen zwei Umrissen [-1, -1]. */
export function flattenRings(rings) {
  return rings.flatMap((ring, index) => [...(index > 0 ? [RING_BREAK, RING_BREAK] : []), ...flattenPoints(ring)]);
}

function splitRings(points) {
  const rings = [[]];
  for (const point of points) {
    if (point.x === RING_BREAK && point.y === RING_BREAK) rings.push([]);
    else rings[rings.length - 1].push(point);
  }
  return rings;
}

/** Zeichnung vom Server (oder neu gezeichnet) prüfen – null, wenn sie unbrauchbar ist. */
export function normalizeDrawing(row) {
  if (!row || typeof row.id !== 'string' || row.id === '') return null;
  const flat = Array.isArray(row.points) ? row.points : [];
  if (flat.length < 2 || flat.length % 2 !== 0 || !flat.every(Number.isFinite)) return null;
  const points = [];
  for (let index = 0; index < flat.length; index += 2) points.push({ x: flat[index], y: flat[index + 1] });
  const kind = DRAW_KINDS.includes(row.kind) ? row.kind : 'line';
  if (SHAPE_KINDS.includes(kind) && points.length !== 2) return null;
  const rings = kind === 'fill' ? splitRings(points) : null;
  if (rings && (rings[0].length < 3 || rings.some((ring) => ring.length < 3))) return null;
  const color = normalizeColor(row.color) ?? DRAW_COLORS[0].id;
  const fill = normalizeFill(row.fill);
  const width = Number(row.width);
  return {
    id: row.id,
    map_id: row.map_id ?? null,
    kind,
    color,
    width: Number.isFinite(width) && width > 0 ? Math.min(width, MAX_DRAWING_WIDTH) : 4,
    // Farbeimer ohne Füllfarbe (sollte nicht vorkommen): halb durchsichtig in der Stiftfarbe.
    fill: kind === 'fill' ? (fill ?? fillColor(color, 'halb')) : ['rect', 'ellipse'].includes(kind) ? fill : null,
    points: rings ? rings[0] : points,
    ...(rings ? { rings } : {}),
    created_by: typeof row.created_by === 'string' && row.created_by !== '' ? row.created_by : null,
  };
}

/**
 * Beim Zeichnen: Punkt nur übernehmen, wenn er weit genug vom letzten entfernt ist
 * (spart Daten, die Linie bleibt trotzdem glatt). Liefert true, wenn er dazugekommen ist.
 */
export function addStrokePoint(points, point, minDistance) {
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minDistance) return false;
  points.push({ x: point.x, y: point.y });
  return true;
}

const at = ({ x, y }) => `${round1(x)} ${round1(y)}`;

/** SVG-Pfad einer Linie, über die Mittelpunkte geglättet. Ein einzelner Punkt wird ein Tupfen. */
export function strokePath(points) {
  if (!points?.length) return '';
  const [first] = points;
  const last = points[points.length - 1];
  if (points.length === 1) return `M${at(first)}h0.01`;
  let path = `M${at(first)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += `Q${at(point)} ${at({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 })}`;
  }
  return `${path}L${at(last)}`;
}

/**
 * Formen beim Aufziehen mit gedrückter Umschalttaste: Quadrat bzw. Kreis, Linien und Pfeile
 * in 45°-Schritten. Liefert den Endpunkt.
 */
export function constrainShape(kind, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (kind === 'rect' || kind === 'ellipse') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx || 1) * side, y: start.y + Math.sign(dy || 1) * side };
  }
  const length = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

function boxOf([a, b]) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Pfeilspitze: Länge und halbe Breite richten sich nach der Strichstärke. */
function arrowGeometry([a, b], width) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const head = Math.min(length, Math.max(4.5 * width, 6));
  const ux = dx / length;
  const uy = dy / length;
  const base = { x: b.x - ux * head, y: b.y - uy * head };
  const half = head * 0.55;
  return {
    shaftEnd: { x: b.x - ux * head * 0.7, y: b.y - uy * head * 0.7 },
    left: { x: base.x + uy * half, y: base.y - ux * half },
    right: { x: base.x - uy * half, y: base.y + ux * half },
  };
}

/**
 * SVG-Pfade einer Zeichnung – derselbe Pfad dient fürs Anzeigen (SVG) und für den Farbeimer
 * (Leinwand, Path2D). stroke: Linie in der Stiftfarbe, fill: Fläche in der Füllfarbe,
 * head: gefüllte Pfeilspitze in der Stiftfarbe.
 * @returns {{ stroke: string|null, fill: string|null, head: string|null }}
 */
export function drawingPaths(drawing) {
  const { kind, points, width } = drawing;
  const none = { stroke: null, fill: null, head: null };
  if (kind === 'straight') return { ...none, stroke: `M${at(points[0])}L${at(points[1])}` };
  if (kind === 'arrow') {
    const arrow = arrowGeometry(points, width);
    if (!arrow) return { ...none, stroke: `M${at(points[0])}h0.01` };
    return {
      ...none,
      stroke: `M${at(points[0])}L${at(arrow.shaftEnd)}`,
      head: `M${at(points[1])}L${at(arrow.left)}L${at(arrow.right)}Z`,
    };
  }
  if (kind === 'rect') {
    const box = boxOf(points);
    const path = `M${at(box)}h${round1(box.width)}v${round1(box.height)}h${round1(-box.width)}Z`;
    return { ...none, stroke: path, fill: drawing.fill ? path : null };
  }
  if (kind === 'ellipse') {
    const box = boxOf(points);
    const rx = round1(box.width / 2);
    const ry = round1(box.height / 2);
    const start = { x: box.x, y: box.y + box.height / 2 };
    const path = `M${at(start)}a${rx} ${ry} 0 1 0 ${round1(2 * rx)} 0a${rx} ${ry} 0 1 0 ${round1(-2 * rx)} 0Z`;
    return { ...none, stroke: path, fill: drawing.fill ? path : null };
  }
  if (kind === 'fill') {
    const rings = drawing.rings ?? [points];
    return { ...none, fill: rings.map((ring) => `M${ring.map(at).join('L')}Z`).join('') };
  }
  return { ...none, stroke: strokePath(points) };
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Liegt der Punkt in der Fläche (Umriss als Punktliste, gerade-ungerade-Regel)? */
export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function nearPolyline(point, points, reach, closed = false) {
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= reach;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= reach) return true;
  }
  return closed && distanceToSegment(point, points[points.length - 1], points[0]) <= reach;
}

function hitsDrawing(drawing, point, radius) {
  const { kind, points, width } = drawing;
  const reach = radius + width / 2;
  if (kind === 'fill') {
    // Gerade-ungerade über alle Umrisse: in einem Loch ist nichts zu radieren.
    const rings = drawing.rings ?? [points];
    const inside = rings.reduce((result, ring) => result !== pointInPolygon(point, ring), false);
    return inside || rings.some((ring) => nearPolyline(point, ring, radius, true));
  }
  if (kind === 'rect') {
    const box = boxOf(points);
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ];
    if (drawing.fill && pointInPolygon(point, corners)) return true;
    return nearPolyline(point, corners, reach, true);
  }
  if (kind === 'ellipse') {
    const box = boxOf(points);
    const rx = box.width / 2;
    const ry = box.height / 2;
    if (rx === 0 || ry === 0) return nearPolyline(point, points, reach);
    const relative = Math.hypot((point.x - box.x - rx) / rx, (point.y - box.y - ry) / ry);
    if (drawing.fill && relative <= 1) return true;
    return Math.abs(relative - 1) * Math.min(rx, ry) <= reach;
  }
  return nearPolyline(point, points, reach);
}

/** Radierer: IDs der Zeichnungen, die ein Kreis (Mitte, Radius in Kartenpunkten) berührt. */
export function drawingsAt(drawings, point, radius) {
  return drawings.filter((drawing) => hitsDrawing({ kind: 'line', ...drawing }, point, radius)).map(({ id }) => id);
}
