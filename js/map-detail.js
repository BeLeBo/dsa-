/**
 * map-detail.js – Scharfe Karten beim Hineinzoomen. Rein rechnerisch, ohne Browser oder Server.
 *
 *  - Detailstufen: Große Karten behalten ihre volle Auflösung. Neben dem Vorschaubild
 *    (höchstens MAP_MAX_EDGE Punkte) liegen Kacheln: Stufe 0 in voller Auflösung, jede weitere
 *    halb so groß – solange sie mehr zeigt als das Vorschaubild. Eine solche Karte rechnet in
 *    Punkten der vollen Auflösung (Kartenpunkt = Bildpunkt des Originals).
 *  - Schärfe-Ebene: Zoomt man weiter hinein, als das Vorschaubild reicht, wird der sichtbare
 *    Ausschnitt in Bildschirmauflösung neu gezeichnet – aus der passenden Detailstufe oder, wenn
 *    auch die feinste nicht reicht, hochgerechnet und nachgeschärft.
 */

/** Kantenlänge einer Kachel (Bildpunkte). */
export const TILE_SIZE = 1024;
/** Volle Auflösung, die höchstens gespeichert wird: längste Seite und Bildpunkte insgesamt. */
export const MAP_DETAIL_MAX_EDGE = 10000;
export const MAP_DETAIL_MAX_PIXELS = 64_000_000;
/** Ab dieser Vergrößerung einer Bildquelle wird hochgerechnet und geschärft (darunter sieht man keinen Unterschied). */
export const SHARPEN_FROM = 1.3;
/**
 * Größere Ausschnitte werden nur hochgerechnet, nicht geschärft: Das kommt nur bei leichter
 * Vergrößerung vor, wo Schärfen kaum zu sehen ist – und es bleibt am Handy flüssig.
 */
export const MAX_SHARPEN_PIXELS = 2_500_000;
/** Die Schärfe-Ebene hat höchstens so viele Bildpunkte (Speicher am Handy). */
export const MAX_SHARP_PIXELS = 12_000_000;
export const MAX_SHARP_EDGE = 4096;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isPositive = (value) => Number.isFinite(value) && value > 0;

/** Volle Auflösung, die gespeichert wird: das Original, notfalls verkleinert auf die Grenzen. */
export function detailSize(width, height) {
  const factor = Math.min(
    1,
    MAP_DETAIL_MAX_EDGE / Math.max(width, height),
    Math.sqrt(MAP_DETAIL_MAX_PIXELS / (width * height)),
  );
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)) };
}

/**
 * Detailstufen über dem Vorschaubild: Stufe 0 in voller Auflösung, jede weitere halb so groß –
 * solange sie deutlich mehr zeigt als das Vorschaubild. Leer, wenn das Vorschaubild reicht.
 * @returns {{ scale, width, height, cols, rows }[]}  scale = Bildpunkte je Kartenpunkt
 */
export function planDetailLevels(fullWidth, fullHeight, baseWidth, tileSize = TILE_SIZE) {
  const levels = [];
  for (let scale = 1; scale > 1 / 64; scale /= 2) {
    const width = Math.round(fullWidth * scale);
    const height = Math.round(fullHeight * scale);
    if (width <= baseWidth * 1.1) break;
    levels.push({ scale, width, height, cols: Math.ceil(width / tileSize), rows: Math.ceil(height / tileSize) });
  }
  return levels;
}

/** Anzahl aller Kacheln. */
export function tileCount(levels) {
  return levels.reduce((sum, level) => sum + level.cols * level.rows, 0);
}

/** Speicherpfad einer Kachel. */
export function tilePath(detail, levelIndex, col, row) {
  return `${detail.path}/${levelIndex}/${col}-${row}.${detail.ext}`;
}

/** Alle Kachelpfade (zum Aufräumen beim Löschen der Karte). */
export function allTilePaths(detail) {
  const paths = [];
  detail.levels.forEach((level, index) => {
    for (let row = 0; row < level.rows; row += 1) {
      for (let col = 0; col < level.cols; col += 1) paths.push(tilePath(detail, index, col, row));
    }
  });
  return paths;
}

/**
 * Detailangaben vom Server prüfen – null, wenn keine da sind oder sie nicht zur Karte passen.
 * @param {object} value  { path, tile, ext, levels: [{ scale, width, height, cols, rows }] }
 */
export function normalizeDetail(value, map) {
  if (!value || typeof value !== 'object' || !map) return null;
  const { path, tile, ext } = value;
  if (typeof path !== 'string' || path === '' || path.includes('..')) return null;
  if (!['webp', 'jpg'].includes(ext) || !Number.isInteger(tile) || tile < 64 || tile > 4096) return null;
  const levels = (Array.isArray(value.levels) ? value.levels : []).filter(
    (level) =>
      level &&
      isPositive(level.scale) &&
      level.scale <= 1 &&
      Number.isInteger(level.width) &&
      Number.isInteger(level.height) &&
      Math.abs(level.width - map.width * level.scale) <= 2 &&
      Math.abs(level.height - map.height * level.scale) <= 2 &&
      level.cols === Math.ceil(level.width / tile) &&
      level.rows === Math.ceil(level.height / tile),
  );
  if (levels.length === 0 || levels.length !== value.levels.length) return null;
  const clean = levels.map(({ scale, width, height, cols, rows }) => ({ scale, width, height, cols, rows }));
  return { path, tile, ext, levels: clean.sort((a, b) => b.scale - a.scale) };
}

/**
 * Welche Bildquelle braucht die Ansicht? Die gröbste, die (bis auf SHARPEN_FROM) reicht –
 * sonst die feinste vorhandene.
 * @param {number} needed  Bildpunkte je Kartenpunkt für volle Schärfe (Zoom × devicePixelRatio)
 * @param {number} baseScale  Bildpunkte je Kartenpunkt des Vorschaubilds
 * @param {object[]} levels  Detailstufen (siehe planDetailLevels)
 * @returns {{ level: number|null, scale: number, magnification: number }}
 *   level null = Vorschaubild; magnification > 1 = die Quelle wird hochgerechnet
 */
export function chooseDetailSource(needed, baseScale, levels = []) {
  const sources = [
    { level: null, scale: baseScale },
    ...levels.map((level, index) => ({ level: index, scale: level.scale })),
  ]
    .filter((source) => isPositive(source.scale))
    .sort((a, b) => a.scale - b.scale);
  const chosen = sources.find((source) => source.scale * SHARPEN_FROM >= needed) ?? sources[sources.length - 1];
  return { level: chosen.level, scale: chosen.scale, magnification: needed / chosen.scale };
}

/**
 * Sichtbarer Kartenbereich plus Rand (zum Verschieben ohne neues Zeichnen), begrenzt auf die
 * Karte. In Kartenpunkten; null, wenn nichts von der Karte zu sehen ist.
 */
export function visibleRegion(view, viewport, map, margin = 0.15) {
  const width = viewport.width / view.scale;
  const height = viewport.height / view.scale;
  const left = -view.x / view.scale - width * margin;
  const top = -view.y / view.scale - height * margin;
  const x0 = clamp(left, 0, map.width);
  const y0 = clamp(top, 0, map.height);
  const x1 = clamp(left + width * (1 + 2 * margin), 0, map.width);
  const y1 = clamp(top + height * (1 + 2 * margin), 0, map.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Bereich auf ganze Bildpunkte der Quelle (Maßstab scale) ausdehnen. */
export function snapRegion(region, scale) {
  const x0 = Math.floor(region.x * scale);
  const y0 = Math.floor(region.y * scale);
  const x1 = Math.ceil((region.x + region.width) * scale);
  const y1 = Math.ceil((region.y + region.height) * scale);
  return {
    source: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) },
    region: { x: x0 / scale, y: y0 / scale, width: Math.max(1, x1 - x0) / scale, height: Math.max(1, y1 - y0) / scale },
  };
}

/**
 * Plan für die Schärfe-Ebene – null, wenn das Kartenbild selbst scharf genug ist.
 * @param {object} options
 * @param {{scale, x, y}} options.view
 * @param {{width, height}} options.viewport  Bildschirmpunkte (CSS)
 * @param {{width, height}} options.map       Kartenpunkte
 * @param {number} options.dpr                devicePixelRatio
 * @param {number} options.baseScale          Bildpunkte je Kartenpunkt des Vorschaubilds
 * @param {object[]} [options.levels]         Detailstufen
 * @returns {null | { region, source: { level, scale, magnification }, sharpen, crop, width, height }}
 *   region in Kartenpunkten, crop = Ausschnitt der Quelle in ihren Bildpunkten (nur beim Schärfen),
 *   width/height = Größe der Leinwand in Bildpunkten
 */
export function planSharpLayer({ view, viewport, map, dpr, baseScale, levels = [] }) {
  if (!isPositive(view?.scale) || !isPositive(baseScale) || !map?.width || !map?.height) return null;
  const needed = view.scale * (isPositive(dpr) ? dpr : 1);
  if (needed <= baseScale * SHARPEN_FROM) return null;
  const source = chooseDetailSource(needed, baseScale, levels);
  const sharpen = source.magnification > SHARPEN_FROM;
  let region = visibleRegion(view, viewport, map);
  if (!region) return null;
  if (region.width * region.height * needed * needed > MAX_SHARP_PIXELS) {
    region = visibleRegion(view, viewport, map, 0) ?? region; // ohne Rand
  }
  let crop = null;
  if (sharpen) ({ source: crop, region } = snapRegion(region, source.scale));
  // Zu groß für den Speicher (sehr großer Bildschirm): etwas unter Bildschirmauflösung zeichnen.
  const pixels = region.width * region.height * needed * needed;
  const factor = Math.min(
    1,
    Math.sqrt(MAX_SHARP_PIXELS / pixels),
    MAX_SHARP_EDGE / (region.width * needed),
    MAX_SHARP_EDGE / (region.height * needed),
  );
  return {
    region,
    source,
    sharpen,
    crop,
    width: Math.max(1, Math.round(region.width * needed * factor)),
    height: Math.max(1, Math.round(region.height * needed * factor)),
  };
}

/**
 * Kacheln einer Stufe, die einen Kartenbereich berühren – mit ihrem Ausschnitt in Bildpunkten
 * der Stufe und in Kartenpunkten.
 */
export function tilesInRegion(level, tileSize, region) {
  const toTile = (value) => Math.floor((value * level.scale) / tileSize);
  const col0 = clamp(toTile(region.x), 0, level.cols - 1);
  const row0 = clamp(toTile(region.y), 0, level.rows - 1);
  const col1 = clamp(Math.ceil(((region.x + region.width) * level.scale) / tileSize) - 1, 0, level.cols - 1);
  const row1 = clamp(Math.ceil(((region.y + region.height) * level.scale) / tileSize) - 1, 0, level.rows - 1);
  const tiles = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const x = col * tileSize;
      const y = row * tileSize;
      const width = Math.min(tileSize, level.width - x);
      const height = Math.min(tileSize, level.height - y);
      tiles.push({
        col,
        row,
        pixels: { x, y, width, height },
        map: { x: x / level.scale, y: y / level.scale, width: width / level.scale, height: height / level.scale },
      });
    }
  }
  return tiles;
}

/** Stärke der Schärfung je nach Vergrößerung: etwas sanfter bei wenig, kräftiger bei viel. */
export function sharpenAmount(magnification) {
  return clamp(0.6 + 0.12 * magnification, 0.8, 1.4);
}
