/* Puma Utilities service worker.
 * - cache-first for immutable Next.js assets (/_next/static) and fonts
 * - network-first for page navigations, falling back to the cached page or /offline
 * - never touches /api/* or cross-origin requests
 */
const CACHE_PREFIX = 'puma-utilities-';
const VERSION = `${CACHE_PREFIX}v10`;
const OFFLINE_URL = '/offline';
const APP_SHELL = [OFFLINE_URL, '/manifest.webmanifest', '/apple-touch-icon.png', '/pwa-icon-192', '/pwa-icon-512'];

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    try {
      const cache = await caches.open(VERSION);
      await cache.put(request, response.clone());
    } catch {
      // A successful network response must remain usable even when cache persistence fails.
    }
  }
  return response;
}

async function precacheShell() {
  const cache = await caches.open(VERSION);
  const results = await Promise.allSettled(APP_SHELL.map(async (path) => {
    const request = new Request(path, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Failed to precache ${path}: ${response.status}`);
    await cache.put(request, response.clone());
  }));
  // The offline page is required; icons are best-effort.
  if (results[0]?.status === 'rejected') throw results[0].reason;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== VERSION)
      .map((key) => caches.delete(key)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* optional */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_STALE_PUMA_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== VERSION)
          .map((key) => caches.delete(key)),
      )),
    );
  }
});

function isFont(url) {
  return url.pathname.startsWith('/_next/static/media/') || /\.(woff2?|ttf|otf)$/.test(url.pathname);
}

async function networkFirstNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || await fetch(event.request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(caches.open(VERSION).then((cache) => cache.put(event.request, copy)).catch(() => undefined));
    }
    return response;
  } catch {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;
  // Unsubscribe and tracking links must always hit the network.
  if (requestUrl.pathname.startsWith('/u/') || requestUrl.pathname.startsWith('/t/') || requestUrl.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (requestUrl.pathname.startsWith('/_next/static/') || isFont(requestUrl)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetchAndCache(event.request)),
    );
    return;
  }

  if (APP_SHELL.includes(requestUrl.pathname)) {
    event.respondWith(
      fetchAndCache(event.request).catch(() => caches.match(request).then((cached) => cached || Response.error())),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Puma Utilities', body: 'You have a new Puma alert.', href: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Puma Utilities', {
    body: payload.body || 'You have a new Puma alert.',
    icon: '/pwa-icon-192',
    badge: '/pwa-icon-192',
    data: { href: payload.href || '/' },
    tag: `puma-${payload.href || 'alert'}`,
  }));
});

function safeNotificationTarget(href) {
  try {
    const candidate = new URL(typeof href === 'string' ? href : '/', self.location.origin);
    if (candidate.origin !== self.location.origin) return `${self.location.origin}/`;
    return candidate.href;
  } catch {
    return `${self.location.origin}/`;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = event.notification.data?.href || '/';
  const target = safeNotificationTarget(href);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});
