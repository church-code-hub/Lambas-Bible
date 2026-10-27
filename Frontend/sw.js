const CACHE_NAME = "lambas-bible-shell-v68";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css?v=68",
  "./js/app-state.js?v=67",
  "./js/app-i18n.js?v=67",
  "./js/app-core.js?v=67",
  "./js/app-offline.js?v=67",
  "./js/app-views.js?v=67",
  "./js/app-auth.js?v=67",
  "./js/app-scanner-search.js?v=67",
  "./js/app-cards-admin.js?v=67",
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

function openOfflineDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lambas-attendance-offline", 4);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("events")) {
        request.result.createObjectStore("events", { keyPath: "eventId" });
      }
      if (!request.result.objectStoreNames.contains("roster")) {
        request.result.createObjectStore("roster", { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains("metadata")) {
        request.result.createObjectStore("metadata", { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains("apiCache")) {
        request.result.createObjectStore("apiCache", { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline database"));
  });
}

async function readSyncData(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["events", "metadata"], "readonly");
    const eventsRequest = transaction.objectStore("events").getAll();
    const credentialsRequest = transaction.objectStore("metadata").get("syncCredentials");
    transaction.oncomplete = () => resolve({
      events: eventsRequest.result,
      credentials: credentialsRequest.result,
    });
    transaction.onerror = () => reject(transaction.error || new Error("Could not read pending events"));
  });
}

async function saveSyncResult(database, events, results) {
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(["events", "metadata"], "readwrite");
    const store = transaction.objectStore("events");
    for (const event of events) {
      const result = results.find((item) => item && item.eventId === event.eventId);
      if (result && result.status === "complete" &&
        result.result && result.result.success !== false && result.result.kind !== "error") {
        store.delete(event.eventId);
      } else {
        store.put({
          ...event,
          status: "pending",
          lastSyncError: result && (result.message || result.result?.message)
            ? result.message || result.result.message
            : "Background sync did not complete.",
          lastSyncFailedAt: new Date().toISOString(),
        });
      }
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save background sync results"));
  });
}

async function syncPendingEvents() {
  const database = await openOfflineDatabase();
  try {
    const { events, credentials } = await readSyncData(database);
    if (!credentials || !credentials.apiUrl || !credentials.idToken || !credentials.email) {
      if (events.some((event) => event.status !== "complete")) {
        throw new Error("Background sync credentials are unavailable.");
      }
      return;
    }
    const pendingEvents = events
      .filter((event) => event.queuedBy === credentials.email && event.status !== "complete")
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    for (let index = 0; index < pendingEvents.length; index += 20) {
      const batch = pendingEvents.slice(index, index + 20);
      const response = await fetch(credentials.apiUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "sync_offline_events",
          idToken: credentials.idToken,
          requestId: `sw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          events: batch,
        }),
      });
      if (!response.ok) throw new Error(`Background sync returned HTTP ${response.status}.`);
      const result = await response.json();
      if (!result || !result.success || !Array.isArray(result.results)) {
        throw new Error("Background sync returned an invalid response.");
      }
      await saveSyncResult(database, batch, result.results);
      if (
        result.results.length !== batch.length ||
        result.results.some((item) => !item || item.status === "pending")
      ) {
        throw new Error("The server has not completed all pending events.");
      }
    }
    const remaining = await new Promise((resolve, reject) => {
      const transaction = database.transaction("events", "readonly");
      const request = transaction.objectStore("events").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not count pending events"));
    });
    if (!remaining) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("metadata", "readwrite");
        transaction.objectStore("metadata").delete("syncCredentials");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not clear background credentials"));
      });
    }
  } finally {
    database.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-events") {
    event.waitUntil(syncPendingEvents());
  }
});
