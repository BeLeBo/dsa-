/**
 * sync.js – Helden mit dem Server abgleichen.
 *
 *  - Laden, Anlegen, Löschen von Helden (Tabelle `characters`).
 *  - Speichern mit Verzögerung (~800 ms) und Statusanzeige.
 *  - Offline: Jede Änderung landet zuerst im Gerätespeicher; sobald wieder eine
 *    Verbindung besteht, wird mit dem Serverstand zusammengeführt und gespeichert.
 *  - Live: Änderungen anderer (z. B. des Meisters) werden per Realtime empfangen
 *    und mit eigenen, noch ungespeicherten Eingaben zusammengeführt (merge.js).
 */
import { getClient, unwrap, ServerError } from './supabase.js';
import { createSaver, SAVE_DELAY_MS } from './saver.js';
import { mergeJson } from './merge.js';
import { normalizeHero, structureSignature } from './sheet.js';
import { REMOTE } from './store.js';
import { readJson, writeJson } from './storage.js';
import { clone, deepEqual, isPlainObject } from './util.js';

const CHARACTER_COLUMNS = 'id, room_id, owner_id, data, updated_at, updated_by';
const RETRY_INTERVAL_MS = 30000;

// ---------------------------------------------------------------------------
// Datenzugriff
// ---------------------------------------------------------------------------

/** Alle Helden des Raums, die man sehen darf (Spieler: nur den eigenen, Meister: alle). */
export async function fetchCharacters(roomId) {
  const client = await getClient();
  return unwrap(client.from('characters').select(CHARACTER_COLUMNS).eq('room_id', roomId).order('updated_at'));
}

export async function fetchCharacter(id) {
  const client = await getClient();
  return unwrap(client.from('characters').select(CHARACTER_COLUMNS).eq('id', id).maybeSingle());
}

export async function createCharacter(roomId, data) {
  const client = await getClient();
  return unwrap(client.from('characters').insert({ room_id: roomId, data }).select(CHARACTER_COLUMNS).single());
}

export async function deleteCharacter(id) {
  const client = await getClient();
  await unwrap(client.from('characters').delete().eq('id', id));
  removeCachedCharacter(id);
}

export async function saveCharacterData(id, data) {
  const client = await getClient();
  const rows = await unwrap(client.from('characters').update({ data }).eq('id', id).select('id, updated_at'));
  if (rows.length === 0) {
    throw new ServerError('Der Held wurde gelöscht oder du darfst ihn nicht mehr bearbeiten.');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Gerätespeicher (für offline)
// ---------------------------------------------------------------------------

const cacheKey = (id) => `dsa5.held.${id}`;

/** Zwischengespeicherter Stand: { data (lokal), synced (letzter Serverstand) } oder null. */
export function readCachedCharacter(id) {
  const cached = readJson(cacheKey(id), null);
  return cached?.data && cached?.synced ? cached : null;
}

function writeCachedCharacter(id, data, synced) {
  writeJson(cacheKey(id), { data, synced, savedAt: new Date().toISOString() });
}

function removeCachedCharacter(id) {
  writeJson(cacheKey(id), null);
}

/** Hat der Gerätespeicher Änderungen, die noch nicht auf dem Server sind? */
function hasUnsyncedChanges(cached) {
  return Boolean(cached) && !deepEqual(cached.data, cached.synced);
}

// ---------------------------------------------------------------------------
// Abgleich eines geöffneten Helden
// ---------------------------------------------------------------------------

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Startet den Abgleich für einen Helden und legt ihn in den Heldenspeicher.
 *
 * @param {object} options
 * @param {string} options.id            ID des Helden
 * @param {object} options.store         Heldenspeicher (store.js)
 * @param {object} options.serverData    zuletzt vom Server gelesener Stand
 * @param {(status: string, error?: Error) => void} options.onStatus
 *        'saving' | 'saved' | 'offline' | 'error'
 * @param {Function} [options.save]         (id, data) => Promise – austauschbar für Tests
 * @param {Function} [options.fetchLatest]  (id) => Promise<row|null> – austauschbar für Tests
 * @param {number}   [options.delay]        Verzögerung beim Speichern
 */
export function createCharacterSync({
  id,
  store,
  serverData,
  onStatus,
  save = saveCharacterData,
  fetchLatest = fetchCharacter,
  delay = SAVE_DELAY_MS,
}) {
  let synced = normalizeHero(serverData); // letzter bekannter Serverstand
  let lastSent = null;
  let disposed = false;

  const saver = createSaver({
    delay,
    save: async () => {
      const snapshot = clone(store.hero);
      writeCachedCharacter(id, snapshot, synced); // zuerst sicher auf dem Gerät ablegen
      if (isOffline()) throw new ServerError('Offline', { offline: true });
      lastSent = snapshot;
      await save(id, snapshot);
      synced = snapshot;
      writeCachedCharacter(id, snapshot, snapshot);
    },
    onStatus: (status, error) => {
      if (disposed) return;
      if (status === 'error' && error?.offline) onStatus('offline', null);
      else if (status === 'saving' && isOffline()) onStatus('offline', null);
      else onStatus(status, error);
    },
  });

  /** Bringt einen neuen Stand in den Speicher; strukturelle Änderungen bauen Listen neu auf. */
  function showMerged(next) {
    const kind = structureSignature(next) === structureSignature(store.hero) ? 'value' : 'structure';
    store.update(next, kind, REMOTE);
  }

  /** Verarbeitet einen neuen Serverstand (Realtime oder nach Wiederverbindung). */
  function applyRemote(remoteData) {
    if (disposed || !isPlainObject(remoteData)) return;
    const remote = normalizeHero(remoteData);
    if (deepEqual(remote, lastSent) || deepEqual(remote, synced)) {
      synced = remote; // eigenes Echo oder nichts Neues
      return;
    }
    const merged = normalizeHero(mergeJson(synced, store.hero, remote));
    synced = remote;
    showMerged(merged);
    writeCachedCharacter(id, merged, synced);
    if (!deepEqual(merged, remote)) saver.schedule(); // eigene Änderungen sind noch nicht auf dem Server
  }

  /** Holt den aktuellen Serverstand, führt zusammen und speichert Offen-Gebliebenes. */
  async function resync() {
    if (disposed || isOffline()) return;
    try {
      const row = await fetchLatest(id);
      if (row) applyRemote(row.data);
      await saver.flush();
    } catch (error) {
      if (!error.offline) onStatus('error', error);
    }
  }

  // Start: ungespeicherte Änderungen aus dem Gerätespeicher mit dem Serverstand zusammenführen.
  const cached = readCachedCharacter(id);
  const startHero = hasUnsyncedChanges(cached)
    ? normalizeHero(mergeJson(normalizeHero(cached.synced), normalizeHero(cached.data), synced))
    : clone(synced);
  store.replace(startHero, REMOTE);
  writeCachedCharacter(id, startHero, synced);

  const unsubscribe = store.subscribe((kind, source) => {
    if (source !== REMOTE && store.hero) saver.schedule();
  });
  if (!deepEqual(startHero, synced)) saver.schedule();

  const onOnline = () => resync();
  window.addEventListener('online', onOnline);
  const retryTimer = setInterval(() => {
    if (saver.hasPendingChanges() && !isOffline()) resync();
  }, RETRY_INTERVAL_MS);

  return {
    id,
    applyRemote,
    resync,
    flush: () => saver.flush(),
    /** Beendet den Abgleich; offene Änderungen werden vorher gespeichert (falls möglich). */
    async dispose({ save: saveFirst = true } = {}) {
      unsubscribe();
      window.removeEventListener('online', onOnline);
      clearInterval(retryTimer);
      if (saveFirst) await saver.flush().catch(() => {});
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Live-Änderungen (Supabase Realtime)
// ---------------------------------------------------------------------------

/**
 * Abonniert Änderungen an Helden und Mitgliedern eines Raums.
 * Die Zugriffsregeln gelten auch hier: Spieler erhalten nur ihren eigenen Helden.
 * @returns {Promise<() => void>} Funktion zum Beenden des Abos
 */
export async function subscribeToRoom(
  roomId,
  { onCharacter, onCharacterDeleted, onMembersChanged, onReconnect, onLive },
) {
  const client = await getClient();
  let connectedBefore = false;
  const channel = client
    .channel(`raum-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'characters', filter: `room_id=eq.${roomId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') onCharacterDeleted(payload.old?.id);
        else onCharacter(payload.new);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
      () => onMembersChanged(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onLive(true);
        if (connectedBefore) onReconnect(); // Verpasstes nachholen
        connectedBefore = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onLive(false);
      }
    });
  return () => client.removeChannel(channel);
}
