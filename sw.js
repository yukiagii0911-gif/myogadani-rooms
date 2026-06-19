const CACHE_NAME = "myogadani-v20260619b";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./floors.js",
  "./icons.js",
  "./data/schedule.json",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(APP_SHELL).catch((err) => console.warn("[sw] addAll partial fail", err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// HTML / JS / CSS / manifest は network-first (デプロイ反映を優先)
const NETWORK_FIRST = [/\.html(\?.*)?$/, /\/$/, /app\.js/, /style\.css/, /manifest\.json/];

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 外部 (Firebase 等) は介入しない
  const path = url.pathname + url.search;
  if (NETWORK_FIRST.some((r) => r.test(path))) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(cacheFirst(e.request));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}
