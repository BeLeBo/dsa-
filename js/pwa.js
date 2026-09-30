/**
 * pwa.js – App-Funktionen fürs Handy: Service Worker (offline starten), Installation
 * auf dem Startbildschirm und „Bildschirm anlassen“ am Spieltisch.
 */
import { SUPABASE_JS_URL } from './supabase.js';
import { readJson, writeJson } from './storage.js';

const KEEP_AWAKE_KEY = 'dsa5.ui.wachbleiben';
/** Bleibt die App lange offen, wird beim Zurückkehren höchstens so oft nach einer neuen Version gesucht. */
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Service Worker
// ---------------------------------------------------------------------------

/** Alle bisher geladenen Dateien der App (für den Offline-Speicher). */
function loadedFiles() {
  const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
  return [...new Set([window.location.href, ...urls])].filter(
    (href) => href.startsWith(window.location.origin) || href === SUPABASE_JS_URL,
  );
}

/**
 * Übernimmt eine neue App-Version (neuer Service Worker) die Seite, wird einmal neu geladen –
 * sonst liefen bis zum nächsten Öffnen noch die alten Dateien. Beim allerersten Besuch
 * (noch kein Service Worker) passiert nichts. Ungespeicherte Heldenänderungen liegen im
 * Gerätespeicher und werden nach dem Neuladen übertragen.
 */
function reloadOnUpdate() {
  if (!navigator.serviceWorker.controller) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/** Registriert den Service Worker und lässt alle geladenen Dateien für offline speichern. */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    reloadOnUpdate();
    // updateViaCache „none“: auch sw.js selbst nie aus dem Browser-Cache – Updates kommen sofort an.
    await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    const registration = await navigator.serviceWorker.ready;
    // Beim Öffnen prüft der Browser selbst; danach beim Zurückkehren in die App.
    let lastUpdateCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastUpdateCheck = Date.now();
      registration.update().catch(() => {}); // offline: beim nächsten Mal
    });
    const sendFiles = () => registration.active?.postMessage({ type: 'cache-urls', urls: loadedFiles() });
    sendFiles();
    // supabase-js wird erst im Raum geladen – danach noch einmal melden.
    setTimeout(sendFiles, 5000);
  } catch (error) {
    console.warn('Service Worker nicht verfügbar – die App funktioniert, aber nicht offline.', error);
  }
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // eigener Knopf im Menü statt Browser-Banner
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
});

export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** Kann der Browser die App direkt installieren (Chrome, Edge, Android)? */
export function canPromptInstall() {
  return installPrompt !== null && !isInstalled();
}

/** Zeigt den Installationsdialog des Browsers. Liefert true, wenn installiert wurde. */
export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome === 'accepted';
}

/** Anleitung für Browser ohne Installationsknopf (iPhone/iPad), sonst null. */
export function installHint() {
  if (isInstalled()) return null;
  const isApple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  return isApple ? 'Als App installieren: In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.' : null;
}

// ---------------------------------------------------------------------------
// Bildschirm anlassen (Screen Wake Lock)
// ---------------------------------------------------------------------------

let wakeLock = null;
let keepAwakeWanted = readJson(KEEP_AWAKE_KEY, false) === true;

export function canKeepAwake() {
  return 'wakeLock' in navigator;
}

export function keepAwakeEnabled() {
  return keepAwakeWanted;
}

async function acquireWakeLock() {
  if (!canKeepAwake() || !keepAwakeWanted || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null; // z. B. im Stromsparmodus nicht erlaubt
  }
}

/** Schaltet „Bildschirm anlassen“ ein oder aus (wird pro Gerät gemerkt). */
export async function setKeepAwake(enabled) {
  keepAwakeWanted = enabled;
  writeJson(KEEP_AWAKE_KEY, enabled);
  if (enabled) await acquireWakeLock();
  else {
    await wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
}

// Nach dem Wechsel zurück in die App muss die Sperre neu angefordert werden.
document.addEventListener('visibilitychange', acquireWakeLock);
acquireWakeLock();
