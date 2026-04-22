/**
 * service-worker.js — OpenDocTools
 * Caches core app shell for full offline support.
 * Uses a Cache-First strategy for local assets,
 * and Network-First for CDN libraries with fallback.
 */

const CACHE_VERSION = 'v1.0.0';
const APP_CACHE     = `opendoctools-app-${CACHE_VERSION}`;
const CDN_CACHE     = `opendoctools-cdn-${CACHE_VERSION}`;

/* ── App Shell: cache on install ── */
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './pdf-utils.js',
  './tiff-utils.js',
  './signature.js',
  './manifest.json',
];

/* ── CDN resources to cache when first fetched ── */
const CDN_PREFETCH = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
];

/* ════════════════════════════════════════
   INSTALL — cache app shell
════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install cache error:', err))
  );
});

/* ════════════════════════════════════════
   ACTIVATE — clean old caches
════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== APP_CACHE && key !== CDN_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ════════════════════════════════════════
   FETCH — routing strategy
════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and non-http(s) requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Skip Google Fonts (always online-first, no CORS cache issues)
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(networkFirst(event.request, CDN_CACHE));
    return;
  }

  // CDN resources → network-first with CDN cache fallback
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(networkFirst(event.request, CDN_CACHE));
    return;
  }

  // Local app shell → cache-first
  event.respondWith(cacheFirst(event.request, APP_CACHE));
});

/* ────────────────────────────────────────
   Cache-First: serve from cache, fallback to network
──────────────────────────────────────── */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return offlineFallback(request);
  }
}

/* ────────────────────────────────────────
   Network-First: try network, fallback to cache
──────────────────────────────────────── */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

/* ────────────────────────────────────────
   Offline Fallback
──────────────────────────────────────── */
function offlineFallback(request) {
  if (request.destination === 'document') {
    return caches.match('./index.html');
  }
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

/* ════════════════════════════════════════
   MESSAGE — skip waiting trigger
════════════════════════════════════════ */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
