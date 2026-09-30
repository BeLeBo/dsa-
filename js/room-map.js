/**
 * room-map.js – Karte im Raum: lädt Karten und Figuren, hält sie live aktuell und führt
 * die Aktionen aus. Meister: Karten hochladen, zeigen, Raster einstellen, Figuren verwalten.
 * Alle: die eigene Figur bewegen (Spieler nur die ihres Helden).
 *
 * Der Meister kann eine Karte vorbereiten, ohne dass die Spieler sie sehen: `viewMapId`
 * ist die Karte, die auf diesem Gerät angezeigt wird, `activeMapId` die für alle gezeigte.
 */
import * as serverApi from './map-api.js';
import { prepareMapImage, prepareTokenImage } from './image.js';
import { createObservable } from './store.js';
import { readJson, writeJson } from './storage.js';
import { normalizeHero, heroName } from './sheet.js';
import {
  defaultGrid,
  normalizeGrid,
  numberedNames,
  placeTokens,
  colorForIndex,
  clampToMap,
  parseLife,
  lifeAfterMaxChange,
  MAX_TOKEN_NAME_LENGTH,
  MAX_MAP_NAME_LENGTH,
} from './map.js';

/** Rasteränderungen werden gesammelt und nach dieser Pause gespeichert. */
export const GRID_SAVE_DELAY_MS = 600;

function upsertById(list, row) {
  const index = list.findIndex((entry) => entry.id === row.id);
  return index === -1 ? [...list, row] : list.map((entry, position) => (position === index ? row : entry));
}

const withoutId = (list, id) => list.filter((entry) => entry.id !== id);

/** Welche Karte zeigt dieses Gerät? Spieler: die gezeigte. Meister: gewählte, sonst gezeigte, sonst erste. */
export function chooseViewMap({ maps, activeMapId, preferredMapId, isMaster }) {
  const exists = (id) => id && maps.some((map) => map.id === id);
  if (!isMaster) return exists(activeMapId) ? activeMapId : null;
  if (exists(preferredMapId)) return preferredMapId;
  if (exists(activeMapId)) return activeMapId;
  return maps[0]?.id ?? null;
}

/**
 * @param {object} options
 * @param {string} options.roomId
 * @param {() => boolean} options.isMaster
 * @param {() => object[]} options.characters  sichtbare Helden (Zeilen vom Server)
 * @param {(map: object) => void} options.onShown  Meister zeigt eine neue Karte (für Spieler)
 * @param {(error: Error) => void} options.onError Fehler beim Speichern im Hintergrund
 * @param {object} [options.api]  Serverfunktionen (für Tests austauschbar)
 * @param {object} [options.images] { prepareMapImage, prepareTokenImage } (für Tests austauschbar)
 */
export function createMapController({
  roomId,
  isMaster,
  characters,
  onShown = () => {},
  onError = () => {},
  api = serverApi,
  images = { prepareMapImage, prepareTokenImage },
}) {
  const preferenceKey = `dsa5.karte.${roomId}`;
  const state = createObservable({
    status: 'idle', // idle | loading | ready | offline | error
    error: '',
    maps: [],
    activeMapId: null,
    viewMapId: null,
    tokens: [],
  });
  let gridTimer = null;
  let pendingGrid = null;

  const viewMap = () => state.get().maps.find((map) => map.id === state.get().viewMapId) ?? null;

  async function loadTokens(mapId) {
    const tokens = mapId ? await api.fetchTokens(mapId) : [];
    if (state.get().viewMapId === mapId) state.update({ tokens: tokens.map(withPendingLife) });
  }

  /** Bestimmt die angezeigte Karte neu und lädt ihre Figuren, wenn nötig. */
  async function refreshView({ reloadTokens = false } = {}) {
    const { maps, activeMapId, viewMapId } = state.get();
    const next = chooseViewMap({
      maps,
      activeMapId,
      preferredMapId: readJson(preferenceKey, null),
      isMaster: isMaster(),
    });
    if (next !== viewMapId) {
      state.update({ viewMapId: next, tokens: [] });
      await loadTokens(next);
    } else if (reloadTokens) {
      await loadTokens(next);
    }
  }

  /** Lädt alles neu (Start, Wiederverbindung, neue Karte für Spieler). */
  async function load() {
    if (state.get().status !== 'ready') state.update({ status: 'loading', error: '' });
    try {
      const maps = await api.fetchMaps(roomId);
      state.update({ maps });
      await refreshView({ reloadTokens: true });
      state.update({ status: 'ready', error: '' });
    } catch (error) {
      state.update({ status: error.offline ? 'offline' : 'error', error: error.message });
    }
  }

  // -------------------------------------------------------------------------
  // Live-Änderungen
  // -------------------------------------------------------------------------

  /** Keine Verbindung beim Start: Karte zeigt „offline“ statt „wird geladen“. */
  function markOffline() {
    if (state.get().status !== 'ready') state.update({ status: 'offline' });
  }

  /** Raumzeile (Start oder live): Welche Karte ist für alle gezeigt? */
  function handleRoomRow(row) {
    if (!row || !Object.hasOwn(row, 'active_map_id') || row.active_map_id === state.get().activeMapId) return;
    state.update({ activeMapId: row.active_map_id });
    if (state.get().status === 'idle') return; // noch nicht geladen – load() folgt
    if (isMaster()) {
      refreshView().catch(onError);
      return;
    }
    load().then(() => {
      const map = viewMap();
      if (map) onShown(map);
    });
  }

  function handleMapRow(incoming) {
    if (!incoming?.id || incoming.room_id !== roomId) return;
    // Noch nicht gespeicherte Rastereingaben nicht durch ein älteres Echo überschreiben.
    const row = pendingGrid?.mapId === incoming.id ? { ...incoming, grid: pendingGrid.grid } : incoming;
    const previous = state.get().maps.find((map) => map.id === row.id);
    state.update({ maps: upsertById(state.get().maps, row) });
    if (!previous) {
      refreshView().catch(() => {});
    } else if (row.id === state.get().viewMapId && row.revision !== previous.revision) {
      // Figur verborgen oder entfernt – solche Änderungen erfahren Spieler nur so.
      loadTokens(row.id).catch(() => {});
    }
  }

  function handleMapDeleted(id) {
    if (!state.get().maps.some((map) => map.id === id)) return;
    state.update({ maps: withoutId(state.get().maps, id) });
    refreshView().catch(() => {});
  }

  function handleTokenRow(incoming) {
    if (!incoming?.id || incoming.map_id !== state.get().viewMapId) return;
    const row = withPendingLife(incoming);
    const tokens = state.get().tokens;
    const previous = tokens.find((token) => token.id === row.id);
    const moved = !previous || previous.x !== row.x || previous.y !== row.y;
    state.update({
      // Bewegte Figur nach oben; sonst (z. B. neue LeP) bleibt die Reihenfolge.
      tokens: moved
        ? upsertById(withoutId(tokens, row.id), row)
        : tokens.map((token) => (token.id === row.id ? row : token)),
    });
  }

  function handleTokenDeleted(id) {
    if (state.get().tokens.some((token) => token.id === id))
      state.update({ tokens: withoutId(state.get().tokens, id) });
  }

  // -------------------------------------------------------------------------
  // Aktionen: Karten (Meister)
  // -------------------------------------------------------------------------

  async function uploadMap(file, name) {
    const prepared = await images.prepareMapImage(file);
    const path = await api.uploadImage(roomId, prepared.blob);
    let map;
    try {
      map = await api.createMap({
        room_id: roomId,
        name: String(name ?? '')
          .trim()
          .slice(0, MAX_MAP_NAME_LENGTH),
        image_path: path,
        width: prepared.width,
        height: prepared.height,
        grid: defaultGrid(prepared.width, prepared.height),
      });
    } catch (error) {
      api.discardUpload(path).catch(() => {});
      throw error;
    }
    state.update({ maps: upsertById(state.get().maps, map) });
    writeJson(preferenceKey, map.id); // neue Karte gleich ansehen (noch nicht für alle)
    await refreshView();
    return map;
  }

  /** Meister: Karte für alle zeigen (null = ausblenden). */
  async function showMap(mapId) {
    await api.setActiveMap(roomId, mapId);
    state.update({ activeMapId: mapId });
    if (mapId) writeJson(preferenceKey, null); // folgt ab jetzt der gezeigten Karte
    await refreshView();
  }

  /** Meister: eine Karte ansehen, ohne sie zu zeigen (Vorbereitung). */
  async function selectMap(mapId) {
    await flushGrid();
    writeJson(preferenceKey, mapId);
    await refreshView();
  }

  async function renameMap(mapId, name) {
    const map = await api.updateMap(mapId, {
      name: String(name ?? '')
        .trim()
        .slice(0, MAX_MAP_NAME_LENGTH),
    });
    state.update({ maps: upsertById(state.get().maps, map) });
  }

  async function removeMap(mapId) {
    const map = state.get().maps.find((entry) => entry.id === mapId);
    if (!map) return;
    const tokens = mapId === state.get().viewMapId ? state.get().tokens : await api.fetchTokens(mapId);
    await api.deleteMap(mapId);
    state.update({
      maps: withoutId(state.get().maps, mapId),
      activeMapId: state.get().activeMapId === mapId ? null : state.get().activeMapId,
    });
    await refreshView();
    await api.removeUnusedImages(roomId, [map.image_path, ...tokens.map((token) => token.image_path)]).catch(onError);
  }

  async function saveGrid() {
    clearTimeout(gridTimer);
    gridTimer = null;
    if (!pendingGrid) return;
    const { mapId, grid } = pendingGrid;
    pendingGrid = null;
    try {
      const map = await api.updateMap(mapId, { grid });
      if (!pendingGrid) state.update({ maps: upsertById(state.get().maps, map) });
    } catch (error) {
      onError(error);
      await load();
    }
  }

  /** Meister: Raster sofort anzeigen, kurz danach speichern (viele kleine Schritte = eine Speicherung). */
  function updateGrid(changes) {
    const map = viewMap();
    if (!map) return;
    const grid = normalizeGrid({ ...normalizeGrid(map.grid, map), ...changes }, map);
    state.update({ maps: upsertById(state.get().maps, { ...map, grid }) });
    pendingGrid = { mapId: map.id, grid };
    clearTimeout(gridTimer);
    gridTimer = setTimeout(saveGrid, GRID_SAVE_DELAY_MS);
  }

  /** Offene Rasteränderung sofort speichern (z. B. beim Schließen des Dialogs). */
  function flushGrid() {
    return saveGrid();
  }

  // -------------------------------------------------------------------------
  // Aktionen: Figuren
  // -------------------------------------------------------------------------

  async function uploadTokenImage(file) {
    return api.uploadImage(roomId, await images.prepareTokenImage(file));
  }

  /**
   * Meister: neue Figur(en) aufstellen.
   * @param {object} spec  { name, count, characterId, size, color, hidden, imageFile }
   * @param {{ x: number, y: number }} center  Mitte des sichtbaren Kartenausschnitts
   */
  async function addTokens(spec, center) {
    const map = viewMap();
    if (!map) throw new Error('Bitte zuerst eine Karte hochladen.');
    const grid = normalizeGrid(map.grid, map);
    const names = numberedNames(
      spec.name,
      spec.count,
      state.get().tokens.map((token) => token.name),
    );
    const size = Number(spec.size) || 1;
    const positions = placeTokens(names.length, clampToMap(center, map), size, grid, map, state.get().tokens);
    const imagePath = spec.imageFile ? await uploadTokenImage(spec.imageFile) : null;
    const leMax = spec.characterId ? null : parseLife(spec.leMax, 0); // Helden haben ihre LeP im Bogen
    const rows = names.map((name, index) => ({
      room_id: roomId,
      map_id: map.id,
      character_id: spec.characterId || null,
      name,
      image_path: imagePath,
      color: spec.color,
      size,
      x: positions[index].x,
      y: positions[index].y,
      hidden: spec.hidden === true,
      le_max: leMax,
      le_current: leMax,
    }));
    try {
      const created = await api.createTokens(rows);
      state.update({ tokens: created.reduce(upsertById, state.get().tokens) });
      return created;
    } catch (error) {
      if (imagePath) api.discardUpload(imagePath).catch(() => {});
      throw error;
    }
  }

  /** Meister: alle Helden des Raums, die noch fehlen, auf die Karte stellen. */
  async function addHeroes(center) {
    const map = viewMap();
    if (!map) throw new Error('Bitte zuerst eine Karte hochladen.');
    const present = new Set(
      state
        .get()
        .tokens.map((token) => token.character_id)
        .filter(Boolean),
    );
    const missing = characters().filter((character) => !present.has(character.id));
    if (missing.length === 0) return [];
    const heroImages = await api.fetchHeroTokenImages(roomId);
    const grid = normalizeGrid(map.grid, map);
    const positions = placeTokens(missing.length, clampToMap(center, map), 1, grid, map, state.get().tokens);
    const rows = missing.map((character, index) => ({
      room_id: roomId,
      map_id: map.id,
      character_id: character.id,
      name: heroName(normalizeHero(character.data)).slice(0, MAX_TOKEN_NAME_LENGTH),
      image_path: heroImages.get(character.id) ?? null,
      color: colorForIndex(state.get().tokens.length + index),
      size: 1,
      x: positions[index].x,
      y: positions[index].y,
      hidden: false,
    }));
    const created = await api.createTokens(rows);
    state.update({ tokens: created.reduce(upsertById, state.get().tokens) });
    return created;
  }

  /**
   * Meister: Figur bearbeiten.
   * @param {object} changes  { name, characterId, size, color, hidden, leMax (Text/Zahl, leer = keine LeP) }
   * @param {object} image    { file } neues Bild, { remove: true } Bild entfernen, sonst unverändert
   */
  async function editToken(tokenId, changes, image = {}) {
    const token = state.get().tokens.find((entry) => entry.id === tokenId);
    if (!token) throw new Error('Diese Figur gibt es nicht mehr.');
    const newPath = image.file ? await uploadTokenImage(image.file) : null;
    const update = {
      name:
        String(changes.name ?? token.name)
          .trim()
          .slice(0, MAX_TOKEN_NAME_LENGTH) || token.name,
      character_id: changes.characterId === undefined ? token.character_id : changes.characterId || null,
      size: Number(changes.size ?? token.size) || 1,
      color: changes.color ?? token.color,
      hidden: changes.hidden ?? token.hidden,
    };
    if (changes.leMax !== undefined) Object.assign(update, lifeAfterMaxChange(token, parseLife(changes.leMax, 0)));
    if (newPath || image.remove) update.image_path = newPath;
    let saved;
    try {
      saved = await api.updateToken(tokenId, update);
    } catch (error) {
      if (newPath) api.discardUpload(newPath).catch(() => {});
      throw error;
    }
    handleTokenRow(saved);
    if (token.image_path && token.image_path !== saved.image_path) {
      await api.removeUnusedImages(roomId, [token.image_path]).catch(onError);
    }
    return saved;
  }

  async function removeToken(tokenId) {
    const token = state.get().tokens.find((entry) => entry.id === tokenId);
    await api.deleteToken(tokenId);
    handleTokenDeleted(tokenId);
    if (token?.image_path) await api.removeUnusedImages(roomId, [token.image_path]).catch(onError);
  }

  /**
   * Figuren bewegen (eine oder mehrere): sofort auf dem Gerät, dann auf dem Server.
   * Was der Server ablehnt, springt an den alten Platz zurück; der erste Fehler wird gemeldet.
   * @param {{ id: string, x: number, y: number }[]} moves
   */
  async function moveTokens(moves) {
    const map = viewMap();
    const before = new Map(state.get().tokens.map((token) => [token.id, token]));
    const valid = moves
      .filter((move) => before.has(move.id) && map)
      .map((move) => ({ id: move.id, ...clampToMap(move, map) }));
    if (valid.length === 0) return;
    const movedIds = new Set(valid.map((move) => move.id));
    const moved = valid.map((move) => ({ ...before.get(move.id), x: move.x, y: move.y }));
    state.update({ tokens: [...state.get().tokens.filter((token) => !movedIds.has(token.id)), ...moved] }); // bewegte oben

    const results = await Promise.allSettled(valid.map((move) => api.moveToken(move.id, move.x, move.y)));
    const failed = valid.filter((move, index) => results[index].status === 'rejected');
    if (failed.length === 0) return;
    for (const move of failed) {
      const current = state.get().tokens.find((token) => token.id === move.id);
      const original = before.get(move.id);
      if (current) handleTokenRow({ ...current, x: original.x, y: original.y });
    }
    throw results.find((result) => result.status === 'rejected').reason;
  }

  /** Eine Figur bewegen (Kurzform von moveTokens). */
  function moveToken(tokenId, point) {
    return moveTokens([{ id: tokenId, x: point.x, y: point.y }]);
  }

  // -------------------------------------------------------------------------
  // LeP von Gegnern und NSC (Meister)
  // -------------------------------------------------------------------------

  /**
   * Neuester LeP-Wert je Figur, der noch gespeichert wird. Er liegt über allem, was vom Server
   * kommt – so springt die Anzeige bei schnellen Tipps nicht auf einen Zwischenstand zurück.
   */
  const pendingLife = new Map();
  let lifeQueue = Promise.resolve();

  function withPendingLife(row) {
    const pending = pendingLife.get(row.id);
    return pending ? { ...row, le_current: pending.value } : row;
  }

  /** Setzt die aktuellen LeP einer Figur (sofort sichtbar; gespeichert wird der Reihe nach). */
  function setTokenLife(tokenId, value) {
    const token = state.get().tokens.find((entry) => entry.id === tokenId);
    if (!token) return Promise.resolve();
    const current = parseLife(value);
    const before = token.le_current ?? null;
    const ticket = { value: current };
    pendingLife.set(tokenId, ticket);
    const showLife = (life) =>
      state.update({
        tokens: state.get().tokens.map((entry) => (entry.id === tokenId ? { ...entry, le_current: life } : entry)),
      });
    showLife(current);
    const saving = lifeQueue.then(() => api.updateToken(tokenId, { le_current: current }));
    lifeQueue = saving.catch(() => {});
    const isLatest = () => pendingLife.get(tokenId) === ticket;
    return saving.then(
      (row) => {
        if (!isLatest()) return; // eine neuere Änderung folgt noch
        pendingLife.delete(tokenId);
        handleTokenRow(row);
      },
      (error) => {
        if (isLatest()) {
          pendingLife.delete(tokenId);
          showLife(before);
        }
        throw error;
      },
    );
  }

  /** LeP einer Figur um delta ändern (ohne erfasste LeP: ausgehend vom Maximum bzw. 0). */
  function adjustTokenLife(tokenId, delta) {
    const token = state.get().tokens.find((entry) => entry.id === tokenId);
    if (!token) return Promise.resolve();
    return setTokenLife(tokenId, (token.le_current ?? token.le_max ?? 0) + delta);
  }

  /** Meister: mehrere Figuren verbergen oder zeigen. */
  async function setTokensHidden(tokenIds, hidden) {
    const saved = await Promise.all(tokenIds.map((id) => api.updateToken(id, { hidden })));
    for (const row of saved) handleTokenRow(row);
  }

  /** Meister: mehrere Figuren entfernen (Bilder, die niemand mehr nutzt, werden aufgeräumt). */
  async function removeTokens(tokenIds) {
    const tokens = state.get().tokens.filter((token) => tokenIds.includes(token.id));
    const results = await Promise.allSettled(tokens.map((token) => api.deleteToken(token.id)));
    const removed = tokens.filter((token, index) => results[index].status === 'fulfilled');
    for (const token of removed) handleTokenDeleted(token.id);
    const imagePaths = removed.map((token) => token.image_path).filter(Boolean);
    if (imagePaths.length) await api.removeUnusedImages(roomId, imagePaths).catch(onError);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  return {
    state,
    viewMap,
    load,
    markOffline,
    handleRoomRow,
    handleMapRow,
    handleMapDeleted,
    handleTokenRow,
    handleTokenDeleted,
    actions: {
      uploadMap,
      showMap,
      selectMap,
      renameMap,
      removeMap,
      updateGrid,
      flushGrid,
      addTokens,
      addHeroes,
      editToken,
      removeToken,
      removeTokens,
      setTokensHidden,
      setTokenLife,
      adjustTokenLife,
      moveToken,
      moveTokens,
    },
  };
}
