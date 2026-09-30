/**
 * sw.js – Service Worker: macht die App installierbar und offline startbar.
 *
 *  - Seiten und App-Dateien: immer zuerst frisch vom Netz (am Browser-Cache vorbei), damit eine
 *    neue Version – auch eine geänderte js/config.js – sofort gilt. Nur ohne Verbindung (oder wenn
 *    das Netz zu lange braucht) kommt die gespeicherte Kopie.
 *  - supabase-js vom CDN: feste Version, einmal geladen und dann aus dem Speicher.
 *  - Anfragen an den Server (Helden, Würfe, Anmeldung, Kartenbilder) werden hier nie
 *    zwischengespeichert; dafür sorgt die App selbst (Gerätespeicher, Warteschlange, Bildspeicher).
 *
 * Beim Start meldet die App alle geladenen Dateien (Nachricht „cache-urls“), damit auch
 * Module offline verfügbar sind, die hier nicht einzeln aufgeführt sind.
 */
const CACHE_NAME = 'dsa5-app-v4';
/** Alte App-Versionen werden gelöscht; der Bildspeicher der Karte (siehe map-api.js) bleibt. */
const APP_CACHE_PREFIX = 'dsa5-app-';
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
/** So lange wird aufs Netz gewartet, bevor die gespeicherte Kopie kommt (schlechter Empfang). */
const NETWORK_TIMEOUT_MS = 4000;

/** Mindestausstattung, die schon bei der Installation gespeichert wird. */
const CORE_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // „reload“: am Browser-Cache vorbei, sonst könnte eine veraltete Kopie gespeichert werden.
      .then((cache) => cache.addAll(CORE_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheable(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'cors');
}

async function putInCache(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

/**
 * Frisch vom Server: „no-cache“ fragt nach, ob sich die Datei geändert hat (kostet kaum Daten).
 * Seitenaufrufe lassen sich nicht umbauen – der Browser prüft sie ohnehin.
 */
function fetchFresh(request) {
  return fetch(request.mode === 'navigate' ? request : new Request(request, { cache: 'no-cache' }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Netz zuerst, gespeicherte Kopie ohne Verbindung. Antwortet das Netz nicht rechtzeitig,
 * kommt die Kopie – die Antwort aus dem Netz landet trotzdem noch im Speicher.
 */
async function networkFirst(request, event) {
  const isPage = request.mode === 'navigate';
  const cached = async () =>
    (await caches.match(request, { ignoreSearch: isPage })) ?? (isPage ? await caches.match('./index.html') : null);

  const network = fetchFresh(request);
  event.waitUntil(network.then((response) => putInCache(request, response.clone())).catch(() => {}));

  const slowNetwork = wait(NETWORK_TIMEOUT_MS).then(async () => (await cached()) ?? network);
  try {
    return await Promise.race([network, slowNetwork]);
  } catch (error) {
    const copy = await cached();
    if (copy) return copy;
    if (isPage) throw error;
    return Response.error();
  }
}

/** Unveränderliche Datei (feste Version): einmal laden, danach aus dem Speicher. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putInCache(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.href === SUPABASE_JS_URL) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) return; // Server-Anfragen nie zwischenspeichern
  event.respondWith(networkFirst(request, event));
});

/** Die App meldet alle beim Start geladenen Dateien – fehlende werden für offline gespeichert. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((href) => {
    try {
      const url = new URL(href);
      return url.origin === self.location.origin || url.href === SUPABASE_JS_URL;
    } catch {
      return false;
    }
  });
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        urls.map(async (href) => {
          if (await cache.match(href)) return;
          const request =
            href === SUPABASE_JS_URL
              ? new Request(href, { mode: 'cors', credentials: 'omit' })
              : new Request(href, { cache: 'no-cache' });
          const response = await fetch(request).catch(() => null);
          await putInCache(request, response);
        }),
      ),
    ),
  );
});
