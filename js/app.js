/**
 * app.js – Einstieg: entscheidet zwischen Startseite, Raum und „Ohne Raum“.
 *
 *  - Gespeicherte Raum-Sitzung → direkt in den Raum.
 *  - Zuletzt ohne Raum gespielt → direkt zum Heldenbogen auf diesem Gerät.
 *  - Sonst (oder mit Einladungslink ?raum=CODE) → Startseite.
 */
import { showError } from './ui/toast.js';
import { applyTheme } from './ui/theme.js';
import { renderHome } from './ui/home-view.js';
import { isServerConfigured } from './supabase.js';
import { loadRoomSession, saveRoomSession, normalizeRoomCode, createRoom, joinRoom } from './room.js';
import { startRoomMode } from './mode-room.js';
import { startLocalMode } from './mode-local.js';
import { readJson, writeJson } from './storage.js';

const MODE_KEY = 'dsa5.modus';
const NAME_KEY = 'dsa5.name';
const MESSAGE_KEY = 'dsa5.startMeldung';

// Fehler nie still verschlucken
window.addEventListener('error', (event) => showError(event.error ?? event.message, 'Unerwarteter Fehler'));
window.addEventListener('unhandledrejection', (event) => showError(event.reason, 'Unerwarteter Fehler'));

/** Liest einen Raumcode aus dem Einladungslink und entfernt ihn aus der Adresszeile. */
function takeInviteCode() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('raum')) return '';
  history.replaceState(null, '', window.location.pathname);
  return normalizeRoomCode(params.get('raum'));
}

/** Zur Startseite: Seite neu laden, damit Abos und Ansichten sauber beendet werden. */
function returnToHome(message = '') {
  writeJson(MODE_KEY, null);
  writeJson(MESSAGE_KEY, message || null);
  window.location.reload();
}

function enterRoom(session) {
  writeJson(MODE_KEY, 'raum');
  writeJson(NAME_KEY, session.displayName);
  saveRoomSession(session);
  startRoomMode(session, { onLeave: returnToHome });
}

function enterLocal() {
  writeJson(MODE_KEY, 'lokal');
  startLocalMode({ onLeave: returnToHome });
}

function showHome(prefillCode) {
  const message = readJson(MESSAGE_KEY, '') ?? '';
  writeJson(MESSAGE_KEY, null);
  renderHome(document.getElementById('app'), {
    configured: isServerConfigured(),
    prefillCode,
    lastName: readJson(NAME_KEY, '') ?? '',
    message,
    onJoin: async (values) => enterRoom(await joinRoom(values)),
    onCreate: async (values) => enterRoom(await createRoom(values)),
    onLocal: enterLocal,
  });
}

function start() {
  applyTheme();
  const invite = takeInviteCode();
  const session = loadRoomSession();
  if (session && isServerConfigured() && (!invite || invite === session.code)) {
    startRoomMode(session, { onLeave: returnToHome });
  } else if (!invite && readJson(MODE_KEY, null) === 'lokal') {
    startLocalMode({ onLeave: returnToHome });
  } else {
    showHome(invite);
  }
}

try {
  start();
} catch (error) {
  showError(error, 'Die App konnte nicht gestartet werden');
}
