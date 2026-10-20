const CACHE_NAME = "lambas-bible-shell-v38";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css?v=38",
  "./js/app-state.js?v=38",
  "./js/app-i18n.js?v=38",
  "./js/app-core.js?v=38",
  "./js/app-offline.js?v=38",
  "./js/app-views.js?v=38",
  "./js/app-auth.js?v=38",
  "./js/app-scanner-search.js?v=38",
  "./js/app-cards-admin.js?v=38",
  "./js/config.example.js",
  "./manifest.json",
  "./Assets/icons/icon-192.png",
  "./Assets/icons/icon-512.png",
  "./Assets/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("lambas-bible-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
      }
      return response;
    })
  );
});
