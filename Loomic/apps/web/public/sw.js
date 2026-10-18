/**
 * Helstera Service Worker
 *
 * Caching strategy:
 * - Navigation and JavaScript: network-first so deployments take effect
 * - Images and fonts: cache-first
 * - API: network-first with cache fallback
 */

const DISABLE_SERVICE_WORKER = true;
const CACHE_VERSION = "helstera-v6";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/logo-helstera.png",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  if (DISABLE_SERVICE_WORKER) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  if (DISABLE_SERVICE_WORKER) {
    event.waitUntil(
      Promise.all([
        self.registration.unregister(),
        caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
        self.clients.claim(),
      ]),
    );
    return;
  }
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (DISABLE_SERVICE_WORKER) return;
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, non-http(s) requests
  if (request.method !== "GET" || !url.protocol.startsWith("http")) return;

  // API requests: network-first, fallback to cache
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/functions/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js")) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Images and fonts are content-addressed or long-lived.
  if (
    url.pathname.startsWith("/icons/") ||
    /\.(png|jpg|jpeg|svg|webp|woff2?|ttf)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigation requests must observe the latest deployment.
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const offline = await caches.match("/offline.html");
        return (
          offline ??
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) ?? new Response("Offline", { status: 503 });
  }
}

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
  } catch {
    return cached ?? new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
