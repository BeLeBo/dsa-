/**
 * sw.js – Service Worker: macht die App installierbar und offline startbar.
 *
 *  - Seitenaufrufe: erst Netz (immer die neueste Version), ohne Verbindung aus dem Speicher.
 *  - App-Dateien (JS, CSS, Icons): sofort aus dem Speicher, im Hintergrund aktualisiert.
 *    Eine neue Version ist damit spätestens beim übernächsten Öffnen aktiv.
 *  - supabase-js vom CDN: feste Version, einmal geladen und dann aus dem Speicher.
 *  - Anfragen an den Server (Helden, Würfe, Anmeldung, Kartenbilder) werden hier nie
 *    zwischengespeichert; dafür sorgt die App selbst (Gerätespeicher, Warteschlange, Bildspeicher).
 *
 * Beim Start meldet die App alle geladenen Dateien (Nachricht „cache-urls“), damit auch
 * Module offline verfügbar sind, die hier nicht einzeln aufgeführt sind.
 */
const CACHE_NAME = 'dsa5-app-v2';
/** Alte App-Versionen werden gelöscht; der Bildspeicher der Karte (siehe map-api.js) bleibt. */
const APP_CACHE_PREFIX = 'dsa5-app-';
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';

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
      .then((cache) => cache.addAll(CORE_FILES))
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

/** Seitenaufruf: Netz zuerst, ohne Verbindung die gespeicherte Startseite. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await putInCache(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await caches.match(request, { ignoreSearch: true })) ?? (await caches.match('./index.html'));
    if (cached) return cached;
    throw error;
  }
}

/** App-Dateien: sofort aus dem Speicher, parallel frisch vom Netz holen. */
async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      await putInCache(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response ?? Response.error();
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
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, event));
});

/** Die App meldet alle beim Start geladenen Dateien – sie werden für offline gespeichert. */
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
          const request = new Request(href, href === SUPABASE_JS_URL ? { mode: 'cors', credentials: 'omit' } : {});
          const response = await fetch(request).catch(() => null);
          await putInCache(request, response);
        }),
      ),
    ),
  );
});
