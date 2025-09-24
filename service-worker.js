// === service-worker.js ===

// bump this when you want to reset cache
const CACHE_NAME = "kseb-cache-v8";  

const FILES_TO_CACHE = [
  "/kseb-bill-calculator/",
  "/kseb-bill-calculator/index.html",
  "/kseb-bill-calculator/history.html",
  "/kseb-bill-calculator/meterDiary.html",
  "/kseb-bill-calculator/backup.html",
  "/kseb-bill-calculator/style.css",
  "/kseb-bill-calculator/shared.js",
  "/kseb-bill-calculator/manifest.json",
  "/kseb-bill-calculator/icon-192.png",
  "/kseb-bill-calculator/icon-512.png"
];

// Install
self.addEventListener("install", event => {
  console.log("[SW] Install new version");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener("activate", event => {
  console.log("[SW] Activate and cleanup old caches");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : null)))
    )
  );
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage({ type: "NEW_VERSION" }));
  });
});

// Fetch strategy with cache-busting for index.html
// Fetch strategy with cache-busting for HTML files
self.addEventListener("fetch", event => {
  const req = event.request;

  // Handle all HTML pages (not just index.html)
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req, { cache: "reload" })
        .then(res => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(req.url, res.clone()); // cache the requested HTML page
            return res;
          });
        })
        .catch(() => caches.match(req.url)) // fallback to cached copy of that page
    );
    return;
  }

  // For other files (icons, CSS, JS) → cache first
  event.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req).then(res =>
        caches.open(CACHE_NAME).then(cache => {
          cache.put(req, res.clone());
          return res;
        })
      )
    )
  );
});
