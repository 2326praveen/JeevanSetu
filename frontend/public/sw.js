// =====================================================================
// JeevanSetu AI - Enhanced Service Worker (v2)
// Network-first for API, cache-first for tiles & static assets,
// background sync for queued SOS, push notification scaffolding
// =====================================================================

const STATIC_CACHE = 'jeevansetu-static-v2';
const TILE_CACHE = 'jeevansetu-map-tiles-v1';
const API_CACHE = 'jeevansetu-api-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/safety-guidance',
  '/assistant'
];

// Install: cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== TILE_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch handler: strategy per request type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // 1. OSM Tile requests -> Cache-first (offline map support)
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;

          return fetch(event.request)
            .then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Return a transparent 1x1 PNG tile placeholder
              return new Response(
                new Uint8Array([
                  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
                  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00,
                  0x01, 0x03, 0x00, 0x00, 0x00, 0x66, 0xbc, 0x3a, 0x25, 0x00, 0x00, 0x00,
                  0x03, 0x50, 0x4c, 0x54, 0x45, 0xee, 0xee, 0xee, 0x56, 0xd4, 0xaa, 0x6d,
                  0x00, 0x00, 0x00, 0x1f, 0x49, 0x44, 0x41, 0x54, 0x68, 0x81, 0xed, 0xc1,
                  0x01, 0x0d, 0x00, 0x00, 0x00, 0xc2, 0xa0, 0xf7, 0x4f, 0x6d, 0x0e, 0x37,
                  0xa0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xbe, 0x0d, 0x21,
                  0x00, 0x00, 0x01, 0x9a, 0x60, 0xe1, 0xd5, 0x00, 0x00, 0x00, 0x00, 0x49,
                  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
                ]).buffer,
                { headers: { 'Content-Type': 'image/png' } }
              );
            });
        });
      })
    );
    return;
  }

  // 2. Supabase API / edge functions -> Network-first, short cache fallback
  if (url.pathname.includes('/functions/') || url.pathname.includes('/rest/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Static assets & app shell -> Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Background Sync for offline SOS
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sos') {
    event.waitUntil(notifyClientToSync());
  }
});

async function notifyClientToSync() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage({ type: 'SYNC_SOS' }));
}

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_TILES') {
    // Client can request tile caching through the SW
    event.waitUntil(
      cacheTilesFromClient(event.data.tiles || [])
    );
  }
});

async function cacheTilesFromClient(tileUrls) {
  const cache = await caches.open(TILE_CACHE);
  for (const url of tileUrls) {
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const resp = await fetch(url);
        if (resp.ok) {
          await cache.put(url, resp);
        }
      }
    } catch (e) {
      // silently skip failed tiles
    }
  }
}
