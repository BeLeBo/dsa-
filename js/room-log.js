/**
 * room-log.js – Gemeinsames Würfelprotokoll eines Raums (Tabelle `rolls`).
 *
 *  - Jeder Wurf wird sofort angezeigt und im Hintergrund übertragen.
 *  - Offline bleibt er in einer Warteschlange auf dem Gerät und wird später nachgereicht.
 *  - Würfe anderer kommen live per Realtime (receive); die Datenbank liefert nur,
 *    was man sehen darf (öffentlich / nur Meister / verdeckt).
 * Bietet dieselben Funktionen wie das Geräteprotokoll in log.js.
 */
import { getClient, unwrap } from './supabase.js';
import { readJson, writeJson } from './storage.js';
import { MAX_LOG_ENTRIES, VISIBILITY, canSee } from './log.js';

const ROLL_COLUMNS = 'id, user_id, character_id, actor, visibility, data, created_at';
const MAX_ACTOR_LENGTH = 80;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function fetchRolls(roomId, limit = MAX_LOG_ENTRIES) {
  const client = await getClient();
  return unwrap(
    client
      .from('rolls')
      .select(ROLL_COLUMNS)
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function insertRoll(roomId, record) {
  const client = await getClient();
  await unwrap(
    client.from('rolls').insert({
      id: record.id,
      room_id: roomId,
      character_id: record.characterId ?? null,
      actor: String(record.actor).slice(0, MAX_ACTOR_LENGTH),
      visibility: record.visibility,
      data: record,
    }),
  );
}

export async function clearRolls(roomId) {
  const client = await getClient();
  await unwrap(client.rpc('clear_log', { p_room_id: roomId }));
}

/** Datenbankzeile → Protokolleintrag. */
export function rowToRecord(row) {
  return {
    ...row.data,
    id: row.id,
    actor: row.actor,
    visibility: row.visibility,
    userId: row.user_id,
    characterId: row.character_id,
    time: row.data?.time ?? row.created_at,
  };
}

function newestFirst(a, b) {
  return String(b.time).localeCompare(String(a.time));
}

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} options.roomId
 * @param {() => { isMaster: boolean, userId: string, characterId: string|null }} options.context
 * @param {(error: Error) => void} options.onError  nicht behebbarer Übertragungsfehler
 * @param {object} [options.api]  { fetchRolls, insertRoll, clearRolls } – austauschbar für Tests
 */
export function createRoomLog({ roomId, context, onError, api = { fetchRolls, insertRoll, clearRolls } }) {
  const queueKey = `dsa5.wurfwarteschlange.${roomId}`;
  const stored = readJson(queueKey, []);
  let pending = Array.isArray(stored) ? stored : [];
  let remote = [];
  const listeners = new Set();

  function visibleEntries() {
    const viewer = context();
    return [...pending.map((record) => ({ ...record, pending: true })), ...remote]
      .filter((record) => canSee(record, viewer))
      .sort(newestFirst)
      .slice(0, MAX_LOG_ENTRIES);
  }

  function emit(change) {
    const entries = visibleEntries();
    for (const listener of listeners) listener(entries, change);
  }

  function setPending(next) {
    pending = next;
    writeJson(queueKey, pending);
  }

  /** Übernimmt Einträge vom Server (ohne Dubletten) und streicht sie aus der Warteschlange. */
  function mergeRemote(records) {
    const ids = new Set(records.map((record) => record.id));
    remote = [...records, ...remote.filter((record) => !ids.has(record.id))]
      .sort(newestFirst)
      .slice(0, MAX_LOG_ENTRIES);
    if (pending.some((record) => ids.has(record.id))) setPending(pending.filter((record) => !ids.has(record.id)));
  }

  async function send(record) {
    try {
      await api.insertRoll(roomId, record);
      mergeRemote([record]);
    } catch (error) {
      if (error.offline) return; // bleibt in der Warteschlange
      setPending(pending.filter((item) => item.id !== record.id));
      if (error.code !== '23505') onError(error); // 23505: war schon übertragen
    }
    emit({ added: null, remote: false });
  }

  return {
    entries: visibleEntries,

    /** Neuer eigener Wurf: sofort anzeigen, dann übertragen. */
    add(record) {
      const { userId, characterId } = context();
      const full = {
        ...record,
        userId,
        characterId: Object.hasOwn(record, 'characterId') ? record.characterId : characterId,
        visibility: record.visibility ?? VISIBILITY.PUBLIC,
      };
      setPending([full, ...pending]);
      emit({ added: full, remote: false });
      return send(full);
    },

    /** Wurf per Realtime von der Datenbank. */
    receive(row) {
      const record = rowToRecord(row);
      if (remote.some((item) => item.id === record.id)) return;
      const ownPending = pending.some((item) => item.id === record.id);
      mergeRemote([record]);
      emit({ added: ownPending ? null : record, remote: !ownPending && record.userId !== context().userId });
    },

    /** Lädt die letzten Würfe vom Server und reicht Wartendes nach. */
    async load() {
      const records = (await api.fetchRolls(roomId)).map(rowToRecord);
      remote = [];
      mergeRemote(records);
      emit({ added: null, remote: false });
      await Promise.all(pending.map(send));
    },

    /** Reicht Würfe aus der Warteschlange nach (z. B. wieder online). */
    flushPending: () => Promise.all(pending.map(send)),

    canClear: () => context().isMaster,
    clearQuestion: 'Das Protokoll für alle im Raum leeren?',

    async clear() {
      await api.clearRolls(roomId);
      remote = [];
      emit({ added: null, remote: false });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
