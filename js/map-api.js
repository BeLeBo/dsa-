/**
 * map-api.js – Karte auf dem Server: Karten und Figuren laden und ändern, Bilder im
 * Supabase-Speicher ablegen, laden und löschen, Live-Änderungen abonnieren.
 *
 * Bilder ändern sich nie (neues Bild = neuer Dateiname). Deshalb werden sie nach dem
 * ersten Laden auf dem Gerät gespeichert (Cache API) und nicht erneut heruntergeladen.
 */
import { getClient, unwrap, ServerError } from './supabase.js';
import { newId } from './util.js';

export const IMAGE_BUCKET = 'karten';
const MAP_COLUMNS = 'id, room_id, name, image_path, width, height, grid, revision, created_at';
const TOKEN_COLUMNS =
  'id, room_id, map_id, character_id, name, image_path, color, size, x, y, hidden, le_current, le_max, updated_at';
const TEMPLATE_COLUMNS = 'id, room_id, name, image_path, color, size, le_max, ini_base, updated_at';
const IMAGE_CACHE = 'dsa5-bilder';
const IMAGE_CACHE_HOST = 'https://dsa5-bilder.invalid/';
const MAX_CACHED_IMAGES = 60;
const EXTENSIONS = Object.freeze({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' });

function requireRows(rows, message) {
  if (!rows || rows.length === 0) throw new ServerError(message);
  return rows;
}

// ---------------------------------------------------------------------------
// Karten
// ---------------------------------------------------------------------------

/** Sichtbare Karten des Raums (Meister: alle, Spieler: nur die gezeigte). */
export async function fetchMaps(roomId) {
  const client = await getClient();
  return unwrap(client.from('maps').select(MAP_COLUMNS).eq('room_id', roomId).order('created_at'));
}

export async function createMap(fields) {
  const client = await getClient();
  return unwrap(client.from('maps').insert(fields).select(MAP_COLUMNS).single());
}

/** Meister: Name oder Raster ändern. */
export async function updateMap(mapId, changes) {
  const client = await getClient();
  const rows = await unwrap(client.from('maps').update(changes).eq('id', mapId).select(MAP_COLUMNS));
  return requireRows(rows, 'Nur der Meister kann Karten ändern.')[0];
}

export async function deleteMap(mapId) {
  const client = await getClient();
  const rows = await unwrap(client.from('maps').delete().eq('id', mapId).select('id'));
  requireRows(rows, 'Nur der Meister kann Karten löschen.');
}

/** Meister: Karte für alle zeigen (null = keine Karte zeigen). */
export async function setActiveMap(roomId, mapId) {
  const client = await getClient();
  const rows = await unwrap(client.from('rooms').update({ active_map_id: mapId }).eq('id', roomId).select('id'));
  requireRows(rows, 'Nur der Meister kann Karten zeigen.');
}

// ---------------------------------------------------------------------------
// Gespeicherte Figuren (Vorlagen des Meisters)
// ---------------------------------------------------------------------------

/** Meister: gespeicherte Figuren des Raums. */
export async function fetchTemplates(roomId) {
  const client = await getClient();
  return unwrap(client.from('figure_templates').select(TEMPLATE_COLUMNS).eq('room_id', roomId));
}

/** Meister: Figur für später speichern – gleicher Name (ohne Groß/klein) ersetzt die alte. */
export async function saveTemplate(roomId, template) {
  const client = await getClient();
  const rows = await unwrap(
    client.rpc('save_figure_template', {
      p_room_id: roomId,
      p_name: template.name,
      p_color: template.color,
      p_size: template.size,
      p_le_max: template.le_max,
      p_ini_base: template.ini_base,
      p_image_path: template.image_path,
    }),
  );
  return requireRows(rows, 'Nur der Meister kann Figuren speichern.')[0];
}

/** Meister: gespeicherte Figur bearbeiten (auch umbenennen). */
export async function updateTemplate(templateId, template) {
  const client = await getClient();
  const rows = await unwrap(
    client.rpc('update_figure_template', {
      p_template_id: templateId,
      p_name: template.name,
      p_color: template.color,
      p_size: template.size,
      p_le_max: template.le_max,
      p_ini_base: template.ini_base,
      p_image_path: template.image_path,
    }),
  );
  return requireRows(rows, 'Diese gespeicherte Figur gibt es nicht (mehr).')[0];
}

export async function deleteTemplate(templateId) {
  const client = await getClient();
  const rows = await unwrap(client.from('figure_templates').delete().eq('id', templateId).select('id'));
  requireRows(rows, 'Nur der Meister kann gespeicherte Figuren löschen.');
}

/** Meister: Stelle markieren (Ping) – steht in der Raumzeile und geht so live an alle Geräte. */
export async function sendPing(roomId, ping) {
  const client = await getClient();
  const rows = await unwrap(client.from('rooms').update({ ping }).eq('id', roomId).select('id'));
  requireRows(rows, 'Nur der Meister kann Stellen auf der Karte markieren.');
}

// ---------------------------------------------------------------------------
// Figuren
// ---------------------------------------------------------------------------

/** Figuren einer Karte; zuletzt bewegte liegen oben. */
export async function fetchTokens(mapId) {
  const client = await getClient();
  return unwrap(client.from('tokens').select(TOKEN_COLUMNS).eq('map_id', mapId).order('updated_at'));
}

/** Meister: Bilder aller Heldenfiguren im Raum (um sie auf neuen Karten wiederzuverwenden). */
export async function fetchHeroTokenImages(roomId) {
  const client = await getClient();
  const rows = await unwrap(
    client.from('tokens').select('character_id, image_path, updated_at').eq('room_id', roomId).order('updated_at'),
  );
  const images = new Map();
  for (const row of rows) {
    if (row.character_id && row.image_path) images.set(row.character_id, row.image_path); // neuestes gewinnt
  }
  return images;
}

export async function createTokens(rows) {
  const client = await getClient();
  return unwrap(client.from('tokens').insert(rows).select(TOKEN_COLUMNS));
}

export async function updateToken(tokenId, changes) {
  const client = await getClient();
  const rows = await unwrap(client.from('tokens').update(changes).eq('id', tokenId).select(TOKEN_COLUMNS));
  return requireRows(rows, 'Nur der Meister kann Figuren bearbeiten.')[0];
}

export async function deleteToken(tokenId) {
  const client = await getClient();
  await unwrap(client.from('tokens').delete().eq('id', tokenId));
}

/** Figur bewegen (Meister jede, Spieler die eigene) – der Server prüft und begrenzt. */
/** Spieler: Figur des eigenen Helden auf die gezeigte Karte stellen (Prüfung auf dem Server). */
export async function placeOwnToken(mapId, x, y, color, imagePath) {
  const client = await getClient();
  const rows = await unwrap(
    client.rpc('place_own_token', { p_map_id: mapId, p_x: x, p_y: y, p_color: color, p_image_path: imagePath }),
  );
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function moveToken(tokenId, x, y) {
  const client = await getClient();
  await unwrap(client.rpc('move_token', { p_token_id: tokenId, p_x: x, p_y: y }));
}

// ---------------------------------------------------------------------------
// Bilder
// ---------------------------------------------------------------------------

async function openImageCache() {
  try {
    return 'caches' in globalThis ? await caches.open(IMAGE_CACHE) : null;
  } catch {
    return null; // z. B. privates Fenster: dann eben ohne Gerätespeicher
  }
}

const cacheKey = (path) => new Request(`${IMAGE_CACHE_HOST}${encodeURI(path)}`);

async function readCachedImage(path) {
  const cache = await openImageCache();
  const response = await cache?.match(cacheKey(path)).catch(() => null);
  return response ? response.blob() : null;
}

/** Legt ein Bild im Gerätespeicher ab; die ältesten fallen heraus, wenn es zu viele werden. */
async function rememberImage(path, blob) {
  const cache = await openImageCache();
  if (!cache) return;
  try {
    await cache.put(cacheKey(path), new Response(blob, { headers: { 'content-type': blob.type } }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_CACHED_IMAGES)).map((key) => cache.delete(key)));
  } catch {
    // Speicher voll: Bild wird beim nächsten Mal wieder geladen.
  }
}

async function forgetImages(paths) {
  const cache = await openImageCache();
  await Promise.all(paths.map((path) => cache?.delete(cacheKey(path)).catch(() => false)));
}

/** Meister: Bild in den Raumordner hochladen. Liefert den Pfad im Speicher. */
export async function uploadImage(roomId, blob) {
  const extension = EXTENSIONS[blob.type];
  if (!extension) throw new ServerError('Dieses Bildformat wird nicht unterstützt (nur JPG, PNG, WebP).');
  const path = `${roomId}/${newId()}.${extension}`;
  const client = await getClient();
  await unwrap(
    client.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' }),
  );
  await rememberImage(path, blob);
  return path;
}

/**
 * Meister: Bilder löschen, die keine Karte und keine Figur mehr benutzt.
 * Aufräumen darf scheitern (z. B. offline) – dann bleibt nur ungenutzter Speicher belegt.
 */
export async function removeUnusedImages(roomId, paths) {
  const candidates = [...new Set(paths.filter(Boolean))];
  if (candidates.length === 0) return;
  const client = await getClient();
  const rows = await unwrap(client.rpc('unused_images', { p_room_id: roomId, p_paths: candidates }));
  const unused = rows.map((row) => row.path);
  if (unused.length === 0) return;
  await unwrap(client.storage.from(IMAGE_BUCKET).remove(unused));
  await forgetImages(unused);
}

/** Löscht ein gerade hochgeladenes Bild wieder (wenn danach etwas schiefging). */
export async function discardUpload(path) {
  const client = await getClient();
  await unwrap(client.storage.from(IMAGE_BUCKET).remove([path]));
  await forgetImages([path]);
}

const objectUrls = new Map();

/**
 * Adresse zum Anzeigen eines Bildes (Object-URL). Erst aus dem Gerätespeicher,
 * sonst vom Server (mit Anmeldung – der Speicher ist nicht öffentlich).
 */
export function imageUrl(path) {
  if (!objectUrls.has(path)) {
    const promise = (async () => {
      let blob = await readCachedImage(path);
      if (!blob) {
        const client = await getClient();
        blob = await unwrap(client.storage.from(IMAGE_BUCKET).download(path));
        await rememberImage(path, blob);
      }
      return URL.createObjectURL(blob);
    })();
    promise.catch(() => objectUrls.delete(path)); // beim nächsten Mal neu versuchen
    objectUrls.set(path, promise);
  }
  return objectUrls.get(path);
}

// ---------------------------------------------------------------------------
// Live-Änderungen
// ---------------------------------------------------------------------------

/**
 * Eigener Kanal für die Karte: Fehlt die Karte im Schema noch (SQL nicht erneut
 * ausgeführt), bleiben Helden, Würfe und Kampf trotzdem live.
 * Gelöschte Zeilen melden nur ihre ID (und kommen raumübergreifend an).
 * @returns {Promise<() => void>} Funktion zum Beenden des Abos
 */
export async function subscribeToMapChanges(roomId, handlers) {
  const { onMap, onMapDeleted, onToken, onTokenDeleted, onReconnect } = handlers;
  const client = await getClient();
  const inRoom = `room_id=eq.${roomId}`;
  let connectedBefore = false;
  const channel = client
    .channel(`karte-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'maps', filter: inRoom }, (payload) => {
      if (payload.eventType === 'DELETE') onMapDeleted(payload.old?.id);
      else onMap(payload.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: inRoom }, (payload) => {
      if (payload.eventType === 'DELETE') onTokenDeleted(payload.old?.id);
      else onToken(payload.new);
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (connectedBefore) onReconnect(); // Verpasstes nachholen
      connectedBefore = true;
    });
  return () => client.removeChannel(channel);
}
