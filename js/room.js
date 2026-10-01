/**
 * room.js – Räume: erstellen, beitreten (als Spieler oder als Meister),
 * verlassen, Mitglieder laden. Die Sitzung (welcher Raum, welche Rolle) wird
 * auf dem Gerät gespeichert, damit man nach dem Neuladen direkt weiterspielt.
 */
import { getClient, unwrap, ensureUser, ServerError } from './supabase.js';
import { fetchCharacters } from './sync.js';
import { readJson, writeJson } from './storage.js';

export const ROLES = Object.freeze({ MASTER: 'master', PLAYER: 'player' });
export const ROLE_NAMES = Object.freeze({ master: 'Meister', player: 'Spieler' });
export const ROOM_CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 40;
const SESSION_KEY = 'dsa5.raum';
// Alle Spalten: So lädt der Raum auch mit einer Datenbank, der neuere Spalten (z. B. ping) noch fehlen.
const ROOM_COLUMNS = '*';

// ---------------------------------------------------------------------------
// Eingaben prüfen (rein, ohne Server)
// ---------------------------------------------------------------------------

/** „abc-def“ → „ABCDEF“ (Leer- und Trennzeichen werden ignoriert). */
export function normalizeRoomCode(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function validateDisplayName(name) {
  const length = String(name ?? '').trim().length;
  if (length === 0) return 'Bitte deinen Namen eingeben.';
  if (length > MAX_NAME_LENGTH) return `Der Name darf höchstens ${MAX_NAME_LENGTH} Zeichen haben.`;
  return null;
}

export function validateRoomCode(code) {
  return normalizeRoomCode(code).length === ROOM_CODE_LENGTH
    ? null
    : `Der Raumcode hat ${ROOM_CODE_LENGTH} Zeichen (Buchstaben und Ziffern).`;
}

/** Erste Fehlermeldung für „Raum beitreten“ oder null. */
export function validateJoin({ code, displayName }) {
  return validateRoomCode(code) ?? validateDisplayName(displayName);
}

/** Erste Fehlermeldung für „Raum erstellen“ oder null. */
export function validateCreate({ displayName }) {
  return validateDisplayName(displayName);
}

/** Einladungslink, der die App mit vorausgefülltem Raumcode öffnet. */
export function inviteLink(code, { origin, pathname } = window.location) {
  return `${origin}${pathname}?raum=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Sitzung auf dem Gerät
// ---------------------------------------------------------------------------

/** { roomId, code, name, role, displayName, userId, characterId } oder null */
export function loadRoomSession() {
  const session = readJson(SESSION_KEY, null);
  return session?.roomId && session?.code ? session : null;
}

export function saveRoomSession(session) {
  writeJson(SESSION_KEY, session);
}

export function clearRoomSession() {
  writeJson(SESSION_KEY, null);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function sessionFromRow(row, displayName, userId) {
  return {
    roomId: row.room_id,
    code: row.code,
    name: row.name,
    role: row.role,
    displayName: displayName.trim(),
    userId,
    characterId: null,
  };
}

function rejectIfInvalid(problem) {
  if (problem) throw new ServerError(problem);
}

export async function createRoom({ roomName, displayName }) {
  rejectIfInvalid(validateCreate({ displayName }));
  const userId = await ensureUser();
  const client = await getClient();
  const rows = await unwrap(
    client.rpc('create_room', { p_room_name: roomName ?? '', p_display_name: displayName.trim() }),
  );
  return sessionFromRow(rows[0], displayName, userId);
}

/** Beitreten – mit asMaster als Meister (z. B. vom zweiten Gerät des Meisters), ohne PIN. */
export async function joinRoom({ code, displayName, asMaster = false }) {
  rejectIfInvalid(validateJoin({ code, displayName }));
  const userId = await ensureUser();
  const client = await getClient();
  const rows = await unwrap(
    client.rpc('join_room', {
      p_code: normalizeRoomCode(code),
      p_display_name: displayName.trim(),
      p_as_master: Boolean(asMaster),
    }),
  );
  if (rows.length === 0) throw new ServerError('Beitreten fehlgeschlagen. Bitte erneut versuchen.');
  return sessionFromRow(rows[0], displayName, userId);
}

export async function leaveRoom(session) {
  const client = await getClient();
  await unwrap(client.from('room_members').delete().eq('room_id', session.roomId).eq('user_id', session.userId));
}

export async function fetchMembers(roomId) {
  const client = await getClient();
  return unwrap(
    client
      .from('room_members')
      .select('user_id, display_name, role, joined_at')
      .eq('room_id', roomId)
      .order('joined_at'),
  );
}

/**
 * Alles für die Gruppenansicht: Raum, Mitglieder, sichtbare Helden.
 * `room` ist null, wenn man nicht (mehr) Mitglied ist.
 */
export async function fetchRoster(roomId) {
  const client = await getClient();
  const [room, members, characters] = await Promise.all([
    unwrap(client.from('rooms').select(ROOM_COLUMNS).eq('id', roomId).maybeSingle()),
    fetchMembers(roomId),
    fetchCharacters(roomId),
  ]);
  return { room, members, characters };
}

/** Meister: laufenden Kampf speichern (null = kein Kampf). */
export async function updateCombat(roomId, combat) {
  const client = await getClient();
  const rows = await unwrap(client.from('rooms').update({ combat }).eq('id', roomId).select('id'));
  if (rows.length === 0) throw new ServerError('Nur der Meister kann den Kampf führen.');
}

/** Meister: Helden einer Person im Raum zuweisen (z. B. nach Gerätewechsel). */
export async function assignCharacter(characterId, userId) {
  const client = await getClient();
  await unwrap(client.rpc('assign_character', { p_character_id: characterId, p_user_id: userId }));
}
