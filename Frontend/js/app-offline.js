function openOfflineDatabase() {
  if (!window.indexedDB)
    return Promise.reject(new Error("IndexedDB unavailable"));
  if (!offlineDatabasePromise) {
    offlineDatabasePromise = new Promise((resolve, reject) => {
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
      request.onerror = () =>
        reject(request.error || new Error("Could not open offline queue"));
    });
  }
  return offlineDatabasePromise;
}

async function getCachedApiResponse(cacheKey) {
  const database = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("apiCache", "readonly")
      .objectStore("apiCache")
      .get(cacheKey);
    request.onsuccess = () =>
      resolve(request.result ? request.result.response : null);
    request.onerror = () =>
      reject(request.error || new Error("Could not read API cache"));
  });
}

async function saveCachedApiResponse(cacheKey, response) {
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("apiCache", "readwrite");
    transaction.objectStore("apiCache").put({
      cacheKey,
      response,
      cachedAt: new Date().toISOString(),
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save API cache"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("API cache update was cancelled"));
  });
}

async function clearCachedApiResponses() {
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("apiCache", "readwrite");
    transaction.objectStore("apiCache").clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not clear API cache"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("API cache clear was cancelled"));
  });
}

async function getCachedRoster() {
  if (!cachedRosterPromise) {
    cachedRosterPromise = openOfflineDatabase()
      .then(
        (database) =>
          new Promise((resolve, reject) => {
            const request = database
              .transaction("roster", "readonly")
              .objectStore("roster")
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
              reject(request.error || new Error("Could not read saved roster"));
          }),
      )
      .catch((error) => {
        cachedRosterPromise = null;
        throw error;
      });
  }
  return cachedRosterPromise;
}

function findCachedPersonName(roster, id) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return "";
  const person = roster.find(
    (entry) =>
      String(entry.id).trim() === cleanId ||
      String(entry.qrId || "").trim() === cleanId,
  );
  return person ? String(person.name || "") : "";
}

async function getCachedPersonName(id) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return "";
  return findCachedPersonName(await getCachedRoster(), cleanId);
}

async function hydrateOfflinePersonNames(events) {
  const scansMissingName = events.filter(
    (event) => event.type === "scan" && !event.personName && event.qrText,
  );
  if (!scansMissingName.length) return events;
  try {
    const roster = await getCachedRoster();
    scansMissingName.forEach((event) => {
      event.personName = findCachedPersonName(roster, event.qrText);
    });
  } catch (error) {
    console.warn(
      "Could not match queued attendance IDs to the saved roster.",
      error,
    );
  }
  return events;
}

async function saveCachedRoster(roster) {
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(
      ["roster", "metadata"],
      "readwrite",
    );
    const store = transaction.objectStore("roster");
    store.clear();
    roster.forEach((person) => store.put(person));
    transaction.objectStore("metadata").put({
      key: "roster",
      syncedAt: new Date().toISOString(),
      count: roster.length,
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save roster"));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("Roster cache update was cancelled"),
      );
  });
  offlineRosterSearchCache = null;
  cachedRosterPromise = Promise.resolve(roster);
}

async function getCachedRosterMetadata() {
  const database = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("metadata", "readonly");
    const request = transaction.objectStore("metadata").get("roster");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(request.error || new Error("Could not read roster cache details"));
  });
}

async function refreshRosterCache() {
  if (!navigator.onLine || !currentUser || !googleIdToken) return false;
  try {
    const response = await apiCall("get_roster", {}, async (freshResponse) => {
      await cacheRosterResponse(freshResponse);
    });
    if (!response || !response.success || !Array.isArray(response.roster)) {
      throw new Error(
        response && response.message
          ? response.message
          : "Invalid roster response",
      );
    }
    await cacheRosterResponse(response);
    return true;
  } catch (error) {
    console.error("Could not refresh the saved offline roster.", error);
    showToast(
      `${translations[currentLang].offlineSearchCacheFailed} ${error.message || ""}`.trim(),
      "info",
      8000,
    );
    return false;
  }
}

async function cacheRosterResponse(response) {
  if (!response || !response.success || !Array.isArray(response.roster)) {
    throw new Error(
      response && response.message
        ? response.message
        : "Invalid roster response",
    );
  }
  const roster = response.roster
    .filter((person) => person && person.id != null && person.name)
    .map((person) => ({
      id: String(person.id).trim(),
      name: String(person.name),
      qrId: String(person.qrId || "").trim(),
    }));
  await saveCachedRoster(roster);
  await updateOfflineStatus();
}

async function manuallyRefreshRosterCache() {
  if (await refreshRosterCache()) {
    showToast(translations[currentLang].offlineRosterUpdated, "success");
  }
}

function normalizeSearchName(name) {
  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistanceAtMostOne(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex++;
      rightIndex++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) leftIndex++;
    else if (right.length > left.length) rightIndex++;
    else {
      leftIndex++;
      rightIndex++;
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) edits++;
  return edits <= 1;
}

function scoreCachedName(nameTokens, queryTokens) {
  let score = 0;
  for (const queryToken of queryTokens) {
    let bestScore = 0;
    for (const nameToken of nameTokens) {
      if (nameToken === queryToken) bestScore = Math.max(bestScore, 100);
      else if (nameToken.startsWith(queryToken))
        bestScore = Math.max(bestScore, 80);
      else if (nameToken.includes(queryToken))
        bestScore = Math.max(bestScore, 60);
      else if (
        queryToken.length >= 4 &&
        editDistanceAtMostOne(nameToken, queryToken)
      ) {
        bestScore = Math.max(bestScore, 40);
      }
    }
    if (!bestScore) return -1;
    score += bestScore;
  }
  return score;
}

function getOfflineRosterSearchIndex(roster) {
  if (offlineRosterSearchCache && offlineRosterSearchCache.roster === roster) {
    return offlineRosterSearchCache;
  }
  const exactNames = new Map();
  const people = roster.map((person) => {
    const normalizedName = normalizeSearchName(person.name);
    if (!exactNames.has(normalizedName)) exactNames.set(normalizedName, person);
    return {
      id: person.id,
      name: person.name,
      normalizedName,
      nameTokens: normalizedName.split(" "),
    };
  });
  offlineRosterSearchCache = { roster, exactNames, people };
  return offlineRosterSearchCache;
}

function searchCachedRoster(roster, inputName) {
  const query = normalizeSearchName(inputName);
  if (!query) return { status: "error" };
  const index = getOfflineRosterSearchIndex(roster);
  const exactMatch = index.exactNames.get(query);
  if (exactMatch) {
    return { status: "exact_match", id: exactMatch.id, name: exactMatch.name };
  }
  const queryTokens = query.split(" ");
  const matches = index.people
    .map((person) => ({
      id: person.id,
      name: person.name,
      score: scoreCachedName(person.nameTokens, queryTokens),
    }))
    .filter((person) => person.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.length - right.name.length ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 8)
    .map(({ id, name }) => ({ id, name }));
  return matches.length
    ? { status: "suggestions", matches }
    : { status: "no_match" };
}

async function saveOfflineEvent(
  event,
  refreshStatus = true,
  persistSyncCredentials = false,
) {
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const stores =
      persistSyncCredentials && currentUser && googleIdToken && API_URL
        ? ["events", "metadata"]
        : ["events"];
    const transaction = database.transaction(stores, "readwrite");
    transaction.objectStore("events").put(event);
    if (stores.includes("metadata")) {
      transaction.objectStore("metadata").put({
        key: "syncCredentials",
        apiUrl: API_URL,
        idToken: googleIdToken,
        email: currentUser.email,
      });
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save offline event"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("Offline save was cancelled"));
  });
  if (refreshStatus) await updateOfflineStatus();
}

async function clearBackgroundSyncCredentialsIfQueueEmpty() {
  const events = await getOfflineEvents();
  if (events.length) return;
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("metadata", "readwrite");
    transaction.objectStore("metadata").delete("syncCredentials");
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(
        transaction.error ||
          new Error("Could not clear background sync credentials"),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ||
          new Error("Background sync credential clear was cancelled"),
      );
  });
}

function registerPendingEventsSync() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      if (!registration.sync) {
        console.warn(
          "Background Sync is unavailable; use manual sync when online.",
        );
        return;
      }
      return registration.sync.register("sync-pending-events");
    })
    .catch((error) => {
      console.warn("Could not register background event sync.", error);
    });
}

async function getOfflineEvents() {
  const database = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("events", "readonly")
      .objectStore("events")
      .getAll();
    request.onsuccess = () =>
      resolve(
        request.result.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      );
    request.onerror = () =>
      reject(request.error || new Error("Could not read offline queue"));
  });
}

async function getOfflineEventCount() {
  const database = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("events", "readonly")
      .objectStore("events")
      .getAll();
    request.onsuccess = () => {
      resolve(
        request.result.filter((event) => event.syncMode !== "online").length,
      );
    };
    request.onerror = () =>
      reject(request.error || new Error("Could not count saved actions"));
  });
}

async function removeOfflineEvent(eventId) {
  const database = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("events", "readwrite");
    transaction.objectStore("events").delete(eventId);
    transaction.oncomplete = resolve;
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not update offline queue"));
  });
  await clearBackgroundSyncCredentialsIfQueueEmpty();
}

async function queueOfflineEvent(event) {
  const finishUserAction = beginUserActionRequest();
  try {
    if (!currentUser || (navigator.onLine && !googleIdToken)) {
      throw new Error(
        "Offline actions require a previously authenticated session.",
      );
    }
    const queuedEvent = {
      ...event,
      eventId: event.eventId || crypto.randomUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
      queuedBy: currentUser.email,
      status: "pending",
      syncMode: event.syncMode || (navigator.onLine ? "online" : "offline"),
    };
    await saveOfflineEvent(queuedEvent, false, true);
    updateOfflineStatus().catch((error) => {
      console.error("Could not refresh offline queue status.", error);
    });
    if (googleIdToken && API_URL) registerPendingEventsSync();
    return queuedEvent;
  } finally {
    finishUserAction();
  }
}

async function updateOfflineStatus() {
  const toolbarButton = document.getElementById("syncNowToolbarButton");
  const toolbarCount = document.getElementById("syncNowCount");
  const menuBadge = document.getElementById("syncMenuBadge");
  updateOnlineOnlyControls();
  try {
    const count = await getOfflineEventCount();
    if (toolbarButton) {
      toolbarButton.hidden =
        !currentUser || currentActiveViewId === "loginView";
      toolbarButton.disabled = isSyncingOfflineQueue;
      toolbarButton.setAttribute("aria-busy", String(isSyncingOfflineQueue));
    }
    if (toolbarCount) {
      toolbarCount.hidden = count === 0;
      toolbarCount.textContent = count > 99 ? "99+" : String(count);
    }
    if (menuBadge) {
      menuBadge.hidden = count === 0;
      menuBadge.textContent = count > 99 ? "99+" : String(count);
    }
    const rosterStatus = document.getElementById("offlineRosterStatus");
    if (rosterStatus) {
      const metadata = await getCachedRosterMetadata();
      rosterStatus.textContent = metadata
        ? translations[currentLang].offlineRosterLastUpdated
            .replace("{count}", String(metadata.count))
            .replace(
              "{date}",
              new Date(metadata.syncedAt).toLocaleString(
                currentLang === "ar" ? "ar" : "en",
                { dateStyle: "medium", timeStyle: "short" },
              ),
            )
        : translations[currentLang].offlineRosterNotSaved;
    }
  } catch (error) {
    if (toolbarButton) toolbarButton.hidden = true;
    if (toolbarCount) toolbarCount.hidden = true;
    if (menuBadge) menuBadge.hidden = true;
    console.error("Could not read local offline readiness data.", error);
    const rosterStatus = document.getElementById("offlineRosterStatus");
    if (rosterStatus)
      rosterStatus.textContent =
        translations[currentLang].offlineRosterStatusFailed;
  }
}

function updateOnlineOnlyControls() {
  document.querySelectorAll("[data-online-only]").forEach((element) => {
    if (element.id === "syncNowToolbarButton") return;
    if (!navigator.onLine) {
      element.setAttribute("data-offline-disabled", "");
      element.disabled = true;
      return;
    }
    if (element.hasAttribute("data-offline-disabled")) {
      element.disabled = element.dataset.busy === "true";
      element.removeAttribute("data-offline-disabled");
    }
  });
  const currentAttendeesTile = document.getElementById("currentAttendeesTile");
  if (currentAttendeesTile) {
    currentAttendeesTile.disabled = !navigator.onLine;
    if (typeof updateCurrentAttendeesTileState === "function") {
      updateCurrentAttendeesTileState();
    }
  }
}

function addSearchAgainButton(results, input) {
  if (!results || !input || results.querySelector(".search-again-button"))
    return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn secondary search-again-button";
  button.dataset.i18n = "searchAnotherPerson";
  button.textContent = translations[currentLang].searchAnotherPerson;
  button.addEventListener("click", () => {
    input.value = "";
    results.replaceChildren();
    input.focus();
  });
  results.appendChild(button);
}

function createOfflineSyncProgress(events) {
  if (currentActiveViewId !== "offlineQueueView") return null;
  const section = document.getElementById("offlineSyncProgress");
  const progressBar = document.getElementById("offlineSyncProgressBar");
  const count = document.getElementById("offlineSyncProgressCount");
  const lane = document.getElementById("offlineSyncProgressLane");
  const results = document.getElementById("offlineSyncProgressResults");
  if (!section || !progressBar || !count || !lane || !results) return null;

  section.hidden = false;
  progressBar.max = Math.max(events.length, 1);
  progressBar.value = 0;
  count.textContent = translations[currentLang].offlineSyncProgressCount
    .replace("{completed}", "0")
    .replace("{total}", String(events.length));
  results.replaceChildren();
  lane
    .querySelectorAll(".sync-progress-flight")
    .forEach((flight) => flight.remove());
  const entries = new Map();
  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "sync-progress-item";
    const heading = document.createElement("div");
    heading.className = "sync-progress-event";
    const title = document.createElement("strong");
    title.textContent = offlineEventDescription(event);
    const status = document.createElement("span");
    status.className = "sync-progress-status";
    status.dataset.i18n = "offlineSyncProgressWaiting";
    status.textContent = translations[currentLang].offlineSyncProgressWaiting;
    const message = document.createElement("p");
    message.className = "sync-progress-message";
    message.hidden = true;
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn secondary sync-retry-button";
    retryButton.dataset.onlineOnly = "";
    retryButton.textContent = translations[currentLang].offlineRetry;
    retryButton.hidden = true;
    retryButton.addEventListener("click", () =>
      syncOfflineQueue(event.eventId, true),
    );
    heading.append(title, status);
    item.append(heading, message, retryButton);
    results.appendChild(item);
    entries.set(event.eventId, {
      event,
      item,
      status,
      message,
      retryButton,
      finished: false,
      flight: null,
    });
  });
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = translations[currentLang].noOfflineEvents;
    results.appendChild(empty);
  }
  return {
    entries,
    progressBar,
    count,
    lane,
    results,
    total: events.length,
    completed: 0,
    failed: 0,
  };
}

function updateOfflineSyncProgress(progress, eventId, state, message = "") {
  if (!progress) return;
  const entry = progress.entries.get(eventId);
  if (!entry) return;
  const translationKey = `offlineSyncProgress${state}`;
  entry.status.dataset.i18n = translationKey;
  entry.status.textContent = translations[currentLang][translationKey];
  entry.item.classList.remove(
    "is-complete",
    "is-failed",
    "is-not-synced",
    "is-syncing",
  );
  if (state === "Complete") entry.item.classList.add("is-complete");
  else if (state === "Failed") entry.item.classList.add("is-failed");
  else if (state === "NotSynced") entry.item.classList.add("is-not-synced");
  else if (state === "Syncing") entry.item.classList.add("is-syncing");
  if (state === "Syncing" && !entry.flight) {
    entry.flight = document.createElement("div");
    entry.flight.className = "sync-progress-flight";
    entry.flight.textContent = offlineEventDescription(entry.event);
    progress.lane.appendChild(entry.flight);
    const flightDistance = Math.max(
      0,
      progress.lane.clientWidth - entry.flight.offsetWidth - 62,
    );
    entry.flight.style.setProperty(
      "--sync-flight-distance",
      `${flightDistance}px`,
    );
    const animateFlight = () =>
      entry.flight && entry.flight.classList.add("is-moving");
    if (window.requestAnimationFrame)
      window.requestAnimationFrame(animateFlight);
    else window.setTimeout(animateFlight, 0);
  } else if (state !== "Waiting" && state !== "Syncing" && entry.flight) {
    entry.flight.remove();
    entry.flight = null;
  }
  entry.message.textContent = message;
  entry.message.hidden = !message;
  entry.retryButton.hidden = state !== "Failed" && state !== "NotSynced";
  if (state !== "Waiting" && state !== "Syncing" && !entry.finished) {
    entry.finished = true;
    progress.completed++;
    if (state === "Failed" || state === "NotSynced") progress.failed++;
    progress.progressBar.value = progress.completed;
    progress.count.textContent = translations[
      currentLang
    ].offlineSyncProgressCount
      .replace("{completed}", String(progress.completed))
      .replace("{total}", String(progress.total));
  }
}

async function saveOfflineSyncFailure(event, message) {
  await saveOfflineEvent({
    ...event,
    status: "pending",
    lastSyncError: message,
    lastSyncFailedAt: new Date().toISOString(),
  });
}

var immediateOfflineSyncIds = new Set();

async function syncQueuedEventImmediately(event) {
  if (immediateOfflineSyncIds.has(event.eventId)) return null;
  immediateOfflineSyncIds.add(event.eventId);
  let lastError = null;
  try {
    for (const delay of [0, 750, 2000, 4000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!currentUser || !googleIdToken) break;
      try {
        const response = await apiCall("sync_offline_events", {
          events: [event],
        });
        if (
          !response ||
          !response.success ||
          !Array.isArray(response.results)
        ) {
          throw new Error(
            response && response.message
              ? response.message
              : translations[currentLang].offlineSyncProgressNoResult,
          );
        }
        const eventResult = response.results.find(
          (item) => item && item.eventId === event.eventId,
        );
        if (eventResult && eventResult.status === "complete") {
          const result = eventResult.result || {};
          if (result.success === false || result.kind === "error") {
            await saveOfflineSyncFailure(
              event,
              result.message || translations[currentLang].offlineSyncFailed,
            );
          } else {
            await removeOfflineEvent(event.eventId);
          }
          return result;
        }
        if (!eventResult || eventResult.status !== "pending") {
          throw new Error(
            eventResult && eventResult.message
              ? eventResult.message
              : translations[currentLang].offlineSyncProgressNoResult,
          );
        }
        lastError = new Error(
          translations[currentLang].offlineSyncProgressNoResult,
        );
      } catch (error) {
        lastError = error;
        if (!navigator.onLine) break;
      }
    }
    if (lastError) {
      await saveOfflineSyncFailure(event, lastError.message);
      console.warn(
        "Immediate event sync did not complete; the event remains queued.",
        lastError,
      );
      registerPendingEventsSync();
    }
    return null;
  } finally {
    immediateOfflineSyncIds.delete(event.eventId);
    await updateOfflineStatus();
  }
}

var immediateEventSyncChain = Promise.resolve();
var immediateEventPersistenceChain = Promise.resolve();

function enqueueOnlineEventForSync(event) {
  const persistenceTask = immediateEventPersistenceChain.then(() =>
    queueOfflineEvent({ ...event, syncMode: "online" }),
  );
  immediateEventPersistenceChain = persistenceTask.catch((error) => {
    console.error(
      "Could not persist an online action for background sync.",
      error,
    );
  });
  const syncTask = immediateEventSyncChain.then(async () =>
    syncQueuedEventImmediately(await persistenceTask),
  );
  immediateEventSyncChain = syncTask.catch((error) => {
    console.error("Could not sync an online action in the background.", error);
  });
  return syncTask;
}

function offlineEventDescription(event) {
  if (event.type === "add_student") {
    const attendanceChoice = event.attendIfOpen
      ? translations[currentLang].offlineAttendYes
      : translations[currentLang].offlineAttendNo;
    return `${translations[currentLang].offlineEventAdd}: ${event.name} · ${attendanceChoice}`;
  }
  const person =
    event.personName ||
    `${translations[currentLang].offlineUnknownPerson} (${event.qrText || "?"})`;
  return `${translations[currentLang].offlineEventScan}: ${person}`;
}

function getOfflineSyncBatch(events, targetEventId, groupType, accountEmail) {
  if (targetEventId) {
    const target = events.find((event) => event.eventId === targetEventId);
    return target &&
      target.queuedBy === accountEmail &&
      target.syncMode !== "online"
      ? [target]
      : null;
  }
  const eligibleEvents = events.filter(
    (event) =>
      event.queuedBy === accountEmail &&
      event.status !== "complete" &&
      event.syncMode !== "online",
  );
  if (groupType) {
    return eligibleEvents
      .filter((event) => event.type === groupType)
      .slice(0, 20);
  }
  if (!eligibleEvents.length) return null;
  const first = eligibleEvents[0];
  const batch = [];
  for (const event of eligibleEvents) {
    if (batch.length >= 20 || event.type !== first.type) break;
    batch.push(event);
  }
  return batch;
}

async function syncOfflineQueue(
  targetEventId = "",
  showProgress = false,
  groupType = "",
) {
  if (
    isSyncingOfflineQueue ||
    !navigator.onLine ||
    !currentUser ||
    !googleIdToken
  )
    return null;
  isSyncingOfflineQueue = true;
  let targetResult = null;
  let progress = null;
  try {
    await updateOfflineStatus();
    let events = await hydrateOfflinePersonNames(await getOfflineEvents());
    events = events.filter((event) => event.syncMode !== "online");
    const selectedBatch = getOfflineSyncBatch(
      events,
      targetEventId,
      groupType,
      currentUser.email,
    );
    if ((targetEventId || groupType) && !selectedBatch) return null;
    const progressEvents = targetEventId
      ? selectedBatch
      : groupType
        ? events.filter(
            (event) =>
              event.queuedBy === currentUser.email && event.type === groupType,
          )
        : events.filter((event) => event.queuedBy === currentUser.email);
    progress = showProgress ? createOfflineSyncProgress(progressEvents) : null;
    while (events.length && navigator.onLine && currentUser && googleIdToken) {
      const batch = getOfflineSyncBatch(
        events,
        targetEventId,
        groupType,
        currentUser.email,
      );
      if (!batch) break;
      const requestBatch = showProgress ? batch.slice(0, 1) : batch;
      const batchStartedAt = Date.now();
      requestBatch.forEach((candidate) =>
        updateOfflineSyncProgress(progress, candidate.eventId, "Syncing"),
      );
      if (showProgress) {
        await new Promise((resolve) => {
          if (window.requestAnimationFrame)
            window.requestAnimationFrame(resolve);
          else window.setTimeout(resolve, 0);
        });
      }
      let response = null;
      for (const delay of [0, 750, 2000, 4000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (!navigator.onLine || !currentUser || !googleIdToken) break;
        response = await apiCall("sync_offline_events", {
          events: requestBatch,
        });
        if (!response || !response.success || !Array.isArray(response.results))
          break;
        if (!response.results.some((item) => item && item.status === "pending"))
          break;
      }
      if (showProgress) {
        const animationRemaining = Math.max(
          0,
          750 - (Date.now() - batchStartedAt),
        );
        if (animationRemaining) {
          await new Promise((resolve) =>
            setTimeout(resolve, animationRemaining),
          );
        }
      }
      if (!response || !response.success || !Array.isArray(response.results)) {
        for (const candidate of requestBatch) {
          await saveOfflineSyncFailure(
            candidate,
            translations[currentLang].offlineSyncProgressNoResult,
          );
          updateOfflineSyncProgress(
            progress,
            candidate.eventId,
            "NotSynced",
            translations[currentLang].offlineSyncProgressNoResult,
          );
        }
        showToast(
          translations[currentLang].offlineSyncProgressNoResult,
          "error",
        );
        break;
      }
      let shouldStop = response.results.length !== requestBatch.length;
      for (let index = 0; index < requestBatch.length; index++) {
        const eventResult = response.results[index];
        if (!eventResult || eventResult.status !== "complete") {
          const failureMessage =
            eventResult && eventResult.message
              ? eventResult.message
              : translations[currentLang].offlineSyncProgressNoResult;
          await saveOfflineSyncFailure(requestBatch[index], failureMessage);
          updateOfflineSyncProgress(
            progress,
            requestBatch[index].eventId,
            "Failed",
            failureMessage,
          );
          showToast(failureMessage, "error");
          shouldStop = true;
          break;
        }
        const completedEvent = requestBatch[index];
        const result = eventResult.result || {};
        const failed = result.success === false || result.kind === "error";
        if (failed) {
          const failureMessage =
            result.message || translations[currentLang].offlineSyncFailed;
          await saveOfflineSyncFailure(completedEvent, failureMessage);
        } else {
          await removeOfflineEvent(completedEvent.eventId);
        }
        updateOfflineSyncProgress(
          progress,
          completedEvent.eventId,
          failed ? "Failed" : "Complete",
          typeof result.message === "string" ? result.message : "",
        );
        if (completedEvent.eventId === targetEventId) targetResult = result;
        if (completedEvent.type === "add_student" && result.success) {
          await refreshRosterCache();
        }
        if (failed) {
          showToast(
            result.message || translations[currentLang].offlineSyncFailed,
            "error",
          );
          shouldStop = true;
          break;
        }
      }
      if (shouldStop) {
        for (const candidate of requestBatch) {
          const entry = progress && progress.entries.get(candidate.eventId);
          if (!entry || entry.finished) continue;
          await saveOfflineSyncFailure(
            candidate,
            translations[currentLang].offlineSyncProgressNoResult,
          );
          updateOfflineSyncProgress(
            progress,
            candidate.eventId,
            "NotSynced",
            translations[currentLang].offlineSyncProgressNoResult,
          );
        }
      }
      if (shouldStop) break;
      if (targetEventId || (groupType && !showProgress)) break;
      events = await getOfflineEvents();
    }
    if (progress) {
      for (const [eventId, entry] of progress.entries) {
        if (!entry.finished) {
          await saveOfflineSyncFailure(
            entry.event,
            translations[currentLang].offlineSyncProgressNoResult,
          );
          updateOfflineSyncProgress(
            progress,
            eventId,
            "NotSynced",
            translations[currentLang].offlineSyncProgressNoResult,
          );
        }
      }
      if (progress && progress.completed > 0 && progress.failed === 0) {
        showToast(translations[currentLang].offlineSyncComplete, "success");
      }
    }
  } catch (error) {
    if (progress) {
      for (const [eventId, entry] of progress.entries) {
        if (!entry.finished) {
          await saveOfflineSyncFailure(
            entry.event,
            translations[currentLang].offlineSyncProgressNoResult,
          );
          updateOfflineSyncProgress(
            progress,
            eventId,
            "NotSynced",
            translations[currentLang].offlineSyncProgressNoResult,
          );
        }
      }
    }
    if (currentUser && googleIdToken)
      showToast(translations[currentLang].offlineSyncFailed, "error");
  } finally {
    if (progress && progress.completed > 0) {
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    const progressSection = document.getElementById("offlineSyncProgress");
    if (progressSection) progressSection.hidden = true;
    isSyncingOfflineQueue = false;
    try {
      await clearBackgroundSyncCredentialsIfQueueEmpty();
    } catch (error) {
      console.error(
        "Could not clear unused background sync credentials.",
        error,
      );
    }
    await updateOfflineStatus();
    if (currentActiveViewId === "offlineQueueView") await renderOfflineQueue();
  }
  return targetResult;
}

async function triggerManualSync() {
  return syncOfflineQueue("", true);
}

window.triggerManualSync = triggerManualSync;

async function openOfflineQueueView() {
  showView("offlineQueueView");
  await renderOfflineQueue();
}

async function syncFromToolbar() {
  if (!currentUser) return;
  await openOfflineQueueView();
}

async function renderOfflineQueue() {
  const container = document.getElementById("offlineQueueResults");
  const syncButton = document.getElementById("syncOfflineEventsButton");
  if (!container || !syncButton) return;
  try {
    const events = (
      await hydrateOfflinePersonNames(await getOfflineEvents())
    ).filter((event) => event.syncMode !== "online");
    container.replaceChildren();
    const eventGroups = new Map();
    events.forEach((event) => {
      const group = eventGroups.get(event.type) || [];
      group.push(event);
      eventGroups.set(event.type, group);
    });
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = translations[currentLang].noOfflineEvents;
      container.appendChild(empty);
    }
    for (const [type, groupEvents] of eventGroups) {
      const groupPanel = document.createElement("section");
      groupPanel.className = "report-panel offline-event-group";
      const heading = document.createElement("div");
      heading.className = "report-panel-heading";
      const groupTitle = document.createElement("strong");
      groupTitle.textContent =
        type === "add_student"
          ? translations[currentLang].offlineEventAdd
          : translations[currentLang].offlineEventScan;
      const groupSync = document.createElement("button");
      groupSync.type = "button";
      groupSync.className = "btn secondary offline-group-sync";
      groupSync.dataset.onlineOnly = "";
      groupSync.textContent = translations[currentLang].offlineSyncGroup;
      groupSync.disabled =
        !groupEvents.some((event) => event.queuedBy === currentUser?.email) ||
        isSyncingOfflineQueue;
      groupSync.addEventListener("click", () =>
        syncOfflineQueue("", true, type),
      );
      heading.append(groupTitle, groupSync);
      groupPanel.appendChild(heading);
      for (const event of groupEvents) {
        const item = document.createElement("article");
        item.className = "attendance-person-card offline-event-card";
        const details = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = offlineEventDescription(event);
        const metadata = document.createElement("small");
        metadata.style.cssText =
          "display:block;color:var(--text-sub);margin-top:4px;";
        metadata.textContent = `${new Date(event.timestamp).toLocaleString(currentLang === "ar" ? "ar" : "en")} · ${event.queuedBy || ""}`;
        details.append(title, metadata);
        const status = document.createElement("small");
        status.className = event.lastSyncError
          ? "offline-event-error"
          : "offline-event-pending";
        status.textContent = event.lastSyncError
          ? `${translations[currentLang].offlineEventFailed}: ${event.lastSyncError}`
          : translations[currentLang].offlineEventWaiting;
        details.appendChild(status);
        const actions = document.createElement("div");
        actions.className = "offline-event-actions";
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "btn secondary";
        retryButton.dataset.onlineOnly = "";
        retryButton.textContent = event.lastSyncError
          ? translations[currentLang].offlineRetry
          : translations[currentLang].offlineSyncEvent;
        retryButton.disabled =
          event.queuedBy !== currentUser?.email || isSyncingOfflineQueue;
        retryButton.addEventListener("click", () =>
          syncOfflineQueue(event.eventId, true),
        );
        actions.appendChild(retryButton);
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "admin-del-btn";
        deleteButton.textContent =
          translations[currentLang].deleteOfflineEventBtn;
        deleteButton.disabled = isSyncingOfflineQueue;
        deleteButton.addEventListener("click", () =>
          deleteQueuedOfflineEvent(event.eventId),
        );
        actions.appendChild(deleteButton);
        item.append(details, actions);
        groupPanel.appendChild(item);
      }
      container.appendChild(groupPanel);
    }
    updateOnlineOnlyControls();
    syncButton.disabled =
      !events.length ||
      !navigator.onLine ||
      !currentUser ||
      !googleIdToken ||
      isSyncingOfflineQueue;
  } catch (error) {
    container.replaceChildren();
    const message = document.createElement("p");
    message.className = "search-empty";
    message.textContent = translations[currentLang].offlineStorageError;
    container.appendChild(message);
    syncButton.disabled = true;
  }
}

async function deleteQueuedOfflineEvent(eventId) {
  if (isSyncingOfflineQueue) return;
  if (!window.confirm(translations[currentLang].confirmDeleteOfflineEvent))
    return;
  try {
    await removeOfflineEvent(eventId);
    await updateOfflineStatus();
    await renderOfflineQueue();
  } catch (error) {
    showToast(translations[currentLang].offlineStorageError, "error");
  }
}

function extractId(text) {
  if (!text) return "";
  text = String(text).trim();
  if (
    /^[A-Za-z0-9_-]+$/.test(text) &&
    !text.includes("http") &&
    !text.includes("{")
  )
    return text;
  var m = text.match(/[?&]id=([^&#]+)/);
  if (m && m[1]) return decodeURIComponent(m[1]).trim();
  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.id) return String(parsed.id).trim();
  } catch (e) {}
  return text;
}
