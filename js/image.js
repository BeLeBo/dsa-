/**
 * image.js – Bilder vor dem Hochladen vorbereiten: Karten als Vorschaubild (verkleinert) und –
 * bei großen Bildern – zusätzlich in voller Auflösung als Detailkacheln, Figurenbilder quadratisch
 * zuschneiden, gebaute Karten umwandeln. Spart Speicher und Datenvolumen am Handy.
 * Ergebnis ist WebP; Browser ohne WebP-Unterstützung liefern JPEG (Karte) bzw. PNG (Figur).
 */
import { scaledSize, MAP_MAX_EDGE, TOKEN_IMAGE_EDGE } from './map.js';
import { detailSize, planDetailLevels, TILE_SIZE } from './map-detail.js';

/** Obergrenze des Speichers je Bild (siehe schema.sql). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const QUALITY = 0.85;
/** Ist das Ergebnis noch zu groß, wird es in diesen Schritten weiter verkleinert. */
const SHRINK_FACTOR = 0.8;
const MAX_ATTEMPTS = 5;

export class ImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageError';
  }
}

async function decode(file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) {
    throw new ImageError('Das ist kein Bild. Bitte eine JPG-, PNG- oder WebP-Datei wählen.');
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { image, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageError(
      'Dieses Bild kann der Browser nicht öffnen (z. B. HEIC vom iPhone). Bitte als JPG oder PNG speichern und erneut wählen.',
    );
  }
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function encode(canvas, fallbackType) {
  const webp = await canvasToBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return webp;
  const blob = await canvasToBlob(canvas, fallbackType);
  if (!blob) throw new ImageError('Das Bild konnte nicht umgewandelt werden. Bitte ein kleineres Bild versuchen.');
  return blob;
}

/**
 * Zeichnet einen Ausschnitt des Bildes auf eine Leinwand der Zielgröße.
 * @param {object} source  { x, y, width, height } im Originalbild
 */
function draw(image, source, width, height, background) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('Dieser Browser kann keine Bilder bearbeiten.');
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height);
  return canvas;
}

/** Vorschaubild einer Karte: höchstens MAP_MAX_EDGE Punkte (notfalls kleiner, bis es unter die Speichergrenze passt). */
async function mapPreview(image) {
  const source = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  let edge = MAP_MAX_EDGE;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { width, height } = scaledSize(source.width, source.height, edge);
    const blob = await encode(draw(image, source, width, height, '#ffffff'), 'image/jpeg');
    if (blob.size <= MAX_IMAGE_BYTES) return { blob, width, height };
    edge = Math.round(Math.max(width, height) * SHRINK_FACTOR);
  }
  throw new ImageError('Das Bild ist zu groß. Bitte ein kleineres Bild wählen.');
}

/**
 * Detailkacheln einer großen Karte, eine nach der anderen (Stufe 0 = volle Auflösung, dann
 * halbiert – siehe map-detail.js). Jede Kachel höchstens TILE_SIZE × TILE_SIZE Punkte.
 * @returns {AsyncGenerator<{ levelIndex, col, row, blob }>}
 */
async function* mapTiles(image, full, levels) {
  const ratio = image.naturalWidth / full.width; // Bildpunkte des Originals je Kartenpunkt
  for (const [levelIndex, level] of levels.entries()) {
    const perTilePixel = ratio / level.scale; // Originalpunkte je Kachelpunkt
    for (let row = 0; row < level.rows; row += 1) {
      for (let col = 0; col < level.cols; col += 1) {
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const width = Math.min(TILE_SIZE, level.width - x);
        const height = Math.min(TILE_SIZE, level.height - y);
        const source = {
          x: x * perTilePixel,
          y: y * perTilePixel,
          width: Math.min(width * perTilePixel, image.naturalWidth - x * perTilePixel),
          height: Math.min(height * perTilePixel, image.naturalHeight - y * perTilePixel),
        };
        const blob = await encode(draw(image, source, width, height, '#ffffff'), 'image/jpeg');
        yield { levelIndex, col, row, blob };
      }
    }
  }
}

/**
 * Karte zum Hochladen vorbereiten: Vorschaubild (höchstens MAP_MAX_EDGE Punkte) und – wenn das Bild
 * deutlich größer ist – seine volle Auflösung als Detailkacheln. So bleiben große Stadtkarten
 * beim Hineinzoomen scharf, ohne dass ein Handy je das ganze Bild laden muss.
 * Nach dem Hochladen der Kacheln release() aufrufen (gibt das entpackte Bild frei).
 * @returns {Promise<{ blob, width, height, detail: null | { width, height, levels, tiles() }, release() }>}
 */
export async function prepareMapUpload(file) {
  const { image, release } = await decode(file);
  try {
    const preview = await mapPreview(image);
    const full = detailSize(image.naturalWidth, image.naturalHeight);
    const levels = planDetailLevels(full.width, full.height, preview.width);
    if (levels.length === 0) {
      release();
      return { ...preview, detail: null, release: () => {} };
    }
    return { ...preview, detail: { ...full, levels, tiles: () => mapTiles(image, full, levels) }, release };
  } catch (error) {
    release();
    throw error;
  }
}

/**
 * Selbst gezeichnete Karte (Leinwand aus dem Karten-Editor) als Bild für den Speicher.
 * Liefert null, wenn das Bild über der Speichergrenze liegt – dann kleiner zeichnen.
 * @returns {Promise<Blob|null>}
 */
export async function canvasToMapImage(canvas) {
  const blob = await encode(canvas, 'image/jpeg');
  return blob.size <= MAX_IMAGE_BYTES ? blob : null;
}

/** Figur: mittiger quadratischer Ausschnitt, höchstens TOKEN_IMAGE_EDGE Punkte (Transparenz bleibt). */
export async function prepareTokenImage(file) {
  const { image, release } = await decode(file);
  try {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const source = {
      x: (image.naturalWidth - side) / 2,
      y: (image.naturalHeight - side) / 2,
      width: side,
      height: side,
    };
    const edge = Math.min(side, TOKEN_IMAGE_EDGE);
    return await encode(draw(image, source, edge, edge, null), 'image/png');
  } finally {
    release();
  }
}
