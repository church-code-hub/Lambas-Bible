      function openOfflineDatabase() {
        if (!window.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
        if (!offlineDatabasePromise) {
          offlineDatabasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open("lambas-attendance-offline", 2);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("events")) {
                request.result.createObjectStore("events", { keyPath: "eventId" });
              }
              if (!request.result.objectStoreNames.contains("roster")) {
                request.result.createObjectStore("roster", { keyPath: "id" });
              }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Could not open offline queue"));
          });
        }
        return offlineDatabasePromise;
      }

      async function getCachedRoster() {
        const database = await openOfflineDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction("roster", "readonly").objectStore("roster").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Could not read saved roster"));
        });
      }

      async function saveCachedRoster(roster) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("roster", "readwrite");
          const store = transaction.objectStore("roster");
          store.clear();
          roster.forEach((person) => store.put(person));
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not save roster"));
          transaction.onabort = () => reject(transaction.error || new Error("Roster cache update was cancelled"));
        });
      }

      async function refreshRosterCache() {
        if (!navigator.onLine || !currentUser || !googleIdToken) return false;
        try {
          const response = await apiCall("get_roster");
          if (!response || !response.success || !Array.isArray(response.roster)) {
            throw new Error(response && response.message ? response.message : "Invalid roster response");
          }
          const roster = response.roster.filter(
            (person) => person && person.id != null && person.name,
          ).map((person) => ({
            id: String(person.id),
            name: String(person.name),
          }));
          await saveCachedRoster(roster);
          return true;
        } catch (error) {
          showToast(translations[currentLang].offlineSearchCacheFailed, "info");
          return false;
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

      function scoreCachedName(cleanName, queryTokens) {
        const nameTokens = cleanName.split(" ");
        let score = 0;
        for (const queryToken of queryTokens) {
          let bestScore = 0;
          for (const nameToken of nameTokens) {
            if (nameToken === queryToken) bestScore = Math.max(bestScore, 100);
            else if (nameToken.startsWith(queryToken)) bestScore = Math.max(bestScore, 80);
            else if (nameToken.includes(queryToken)) bestScore = Math.max(bestScore, 60);
            else if (queryToken.length >= 4 && editDistanceAtMostOne(nameToken, queryToken)) {
              bestScore = Math.max(bestScore, 40);
            }
          }
          if (!bestScore) return -1;
          score += bestScore;
        }
        return score;
      }

      function searchCachedRoster(roster, inputName) {
        const query = normalizeSearchName(inputName);
        if (!query) return { status: "error" };
        const exactMatch = roster.find((person) => normalizeSearchName(person.name) === query);
        if (exactMatch) {
          return { status: "exact_match", id: exactMatch.id, name: exactMatch.name };
        }
        const queryTokens = query.split(" ");
        const matches = roster
          .map((person) => ({
            id: person.id,
            name: person.name,
            score: scoreCachedName(normalizeSearchName(person.name), queryTokens),
          }))
          .filter((person) => person.score >= 0)
          .sort((left, right) =>
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

      async function saveOfflineEvent(event) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("events", "readwrite");
          transaction.objectStore("events").put(event);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not save offline event"));
          transaction.onabort = () => reject(transaction.error || new Error("Offline save was cancelled"));
        });
        await updateOfflineStatus();
      }

      async function getOfflineEvents() {
        const database = await openOfflineDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction("events", "readonly").objectStore("events").getAll();
          request.onsuccess = () => resolve(request.result.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
          request.onerror = () => reject(request.error || new Error("Could not read offline queue"));
        });
      }

      async function removeOfflineEvent(eventId) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("events", "readwrite");
          transaction.objectStore("events").delete(eventId);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not update offline queue"));
        });
      }

      async function queueOfflineEvent(event) {
        if (!currentUser || (navigator.onLine && !googleIdToken)) throw new Error("Offline actions require a previously authenticated session.");
        const queuedEvent = {
          ...event,
          eventId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          queuedBy: currentUser.email,
        };
        await saveOfflineEvent(queuedEvent);
        return queuedEvent;
      }

      async function updateOfflineStatus() {
        const toolbarButton = document.getElementById("syncNowToolbarButton");
        const toolbarCount = document.getElementById("syncNowCount");
        if (toolbarButton) {
          toolbarButton.hidden = !currentUser || currentActiveViewId === "loginView";
          toolbarButton.disabled = isSyncingOfflineQueue || !navigator.onLine;
          toolbarButton.setAttribute("aria-busy", String(isSyncingOfflineQueue));
        }
        updateOnlineOnlyControls();
        try {
          const events = await getOfflineEvents();
          const count = events.length;
          if (toolbarCount) {
            toolbarCount.hidden = count === 0;
            toolbarCount.textContent = count > 99 ? "99+" : String(count);
          }
        } catch (error) {
          if (toolbarCount) toolbarCount.hidden = true;
          console.error("Could not read saved sync count.", error);
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
      }

      function addSearchAgainButton(results, input) {
        if (!results || !input || results.querySelector(".search-again-button")) return;
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
        const results = document.getElementById("offlineSyncProgressResults");
        if (!section || !progressBar || !count || !results) return null;

        section.hidden = false;
        progressBar.max = Math.max(events.length, 1);
        progressBar.value = 0;
        count.textContent = translations[currentLang].offlineSyncProgressCount
          .replace("{completed}", "0")
          .replace("{total}", String(events.length));
        results.replaceChildren();
        const entries = new Map();
        events.forEach((event) => {
          const item = document.createElement("div");
          item.className = "sync-progress-item";
          const heading = document.createElement("div");
          heading.className = "sync-progress-event";
          const title = document.createElement("strong");
          title.textContent = event.type === "add_student"
            ? translations[currentLang].offlineEventAdd + ": " + event.name
            : translations[currentLang].offlineEventScan;
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
          retryButton.addEventListener("click", () => syncOfflineQueue());
          heading.append(title, status);
          item.append(heading, message, retryButton);
          entries.set(event.eventId, { event, item, status, message, retryButton, finished: false });
        });
        if (!events.length) {
          const empty = document.createElement("p");
          empty.className = "report-note";
          empty.textContent = translations[currentLang].noOfflineEvents;
          results.appendChild(empty);
        }
        return { entries, progressBar, count, results, total: events.length, completed: 0 };
      }

      function updateOfflineSyncProgress(progress, eventId, state, message = "") {
        if (!progress) return;
        const entry = progress.entries.get(eventId);
        if (!entry) return;
        const translationKey = `offlineSyncProgress${state}`;
        entry.status.dataset.i18n = translationKey;
        entry.status.textContent = translations[currentLang][translationKey];
        entry.item.classList.remove("is-complete", "is-failed", "is-not-synced", "is-syncing");
        if (state === "Complete") entry.item.classList.add("is-complete");
        else if (state === "Failed") entry.item.classList.add("is-failed");
        else if (state === "NotSynced") entry.item.classList.add("is-not-synced");
        else if (state === "Syncing") entry.item.classList.add("is-syncing");
        entry.message.textContent = message;
        entry.message.hidden = !message;
        entry.retryButton.hidden = state !== "Failed" && state !== "NotSynced";
        if ((state === "Failed" || state === "NotSynced") && !entry.item.isConnected) {
          progress.results.appendChild(entry.item);
        }
        if (state !== "Waiting" && state !== "Syncing" && !entry.finished) {
          entry.finished = true;
          progress.completed++;
          progress.progressBar.value = progress.completed;
          progress.count.textContent = translations[currentLang].offlineSyncProgressCount
            .replace("{completed}", String(progress.completed))
            .replace("{total}", String(progress.total));
        }
      }

      async function saveOfflineSyncFailure(event, message) {
        await saveOfflineEvent({
          ...event,
          lastSyncError: message,
          lastSyncFailedAt: new Date().toISOString(),
        });
      }

      async function syncOfflineQueue(targetEventId = "", showProgress = false) {
        if (isSyncingOfflineQueue || !navigator.onLine || !currentUser || !googleIdToken) return null;
        isSyncingOfflineQueue = true;
        let targetResult = null;
        let progress = null;
        await updateOfflineStatus();
        try {
          let events = await getOfflineEvents();
          progress = showProgress ? createOfflineSyncProgress(events) : null;
          while (events.length && navigator.onLine && currentUser && googleIdToken) {
            const event = events[0];
            if (event.queuedBy !== currentUser.email) break;
            const batch = [];
            for (const candidate of events) {
              if (
                batch.length >= 20 ||
                candidate.queuedBy !== currentUser.email ||
                candidate.type !== event.type ||
                (event.type !== "scan" && batch.length > 0)
              ) break;
              batch.push(candidate);
            }
            batch.forEach((candidate) => updateOfflineSyncProgress(progress, candidate.eventId, "Syncing"));
            let response = null;
            for (const delay of [0, 750, 2000, 4000]) {
              if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
              if (!navigator.onLine || !currentUser || !googleIdToken) break;
              response = await apiCall("sync_offline_events", { events: batch });
              if (!response || !response.success || !Array.isArray(response.results)) break;
              if (!response.results.some((item) => item && item.status === "pending")) break;
            }
            if (!response || !response.success || !Array.isArray(response.results)) {
              for (const candidate of batch) {
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
              break;
            }
            let shouldStop = response.results.length !== batch.length;
            for (let index = 0; index < batch.length; index++) {
              const eventResult = response.results[index];
              if (!eventResult || eventResult.status !== "complete") {
                const failureMessage = eventResult && eventResult.message
                  ? eventResult.message
                  : translations[currentLang].offlineSyncProgressNoResult;
                await saveOfflineSyncFailure(batch[index], failureMessage);
                updateOfflineSyncProgress(
                  progress,
                  batch[index].eventId,
                  "Failed",
                  failureMessage,
                );
                showToast(
                  failureMessage,
                  "error",
                  4500,
                );
                shouldStop = true;
                break;
              }
              const completedEvent = batch[index];
              const result = eventResult.result || {};
              const failed = result.success === false || result.kind === "error";
              if (failed) {
                const failureMessage = result.message || translations[currentLang].offlineSyncFailed;
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
              const eventTitle = completedEvent.type === "add_student"
                ? `${translations[currentLang].offlineEventAdd}: ${completedEvent.name}`
                : translations[currentLang].offlineEventScan;
              const eventMessage = [eventTitle, result.title, result.name, result.message]
                .filter((part) => typeof part === "string" && part.trim())
                .join(" · ");
              showToast(
                eventMessage || translations[currentLang].offlineSyncFailed,
                failed ? "error" : result.cardGenerationFailed ? "info" : "success",
                4500,
              );
              if (failed) {
                shouldStop = true;
                break;
              }
            }
            if (shouldStop) {
              for (const candidate of batch) {
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
          if (currentUser && googleIdToken) showToast(translations[currentLang].offlineSyncFailed, "error");
        } finally {
          const progressSection = document.getElementById("offlineSyncProgress");
          if (progressSection) progressSection.hidden = true;
          isSyncingOfflineQueue = false;
          await updateOfflineStatus();
          if (currentActiveViewId === "offlineQueueView") await renderOfflineQueue();
        }
        return targetResult;
      }

      async function openOfflineQueueView() {
        showView("offlineQueueView");
        await renderOfflineQueue();
      }

      async function syncFromToolbar() {
        if (!currentUser) return;
        await openOfflineQueueView();
        if (!navigator.onLine || !googleIdToken) return;
        await syncOfflineQueue("", true);
      }

      async function renderOfflineQueue() {
        const container = document.getElementById("offlineQueueResults");
        const syncButton = document.getElementById("syncOfflineEventsButton");
        if (!container || !syncButton) return;
        try {
          const events = await getOfflineEvents();
          container.replaceChildren();
          const failedEvents = events.filter((event) => event.lastSyncError);
          if (!failedEvents.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = events.length
              ? translations[currentLang].noSyncFailures
              : translations[currentLang].noOfflineEvents;
            container.appendChild(empty);
          }
          failedEvents.forEach((event) => {
            const item = document.createElement("div");
            item.className = "admin-item";
            const details = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = event.type === "add_student"
              ? translations[currentLang].offlineEventAdd + ": " + event.name
              : translations[currentLang].offlineEventScan;
            const metadata = document.createElement("small");
            metadata.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
            metadata.textContent = `${new Date(event.timestamp).toLocaleString(currentLang === "ar" ? "ar" : "en")} · ${event.queuedBy || ""}`;
            details.append(title, metadata);
            if (event.lastSyncError) {
              const error = document.createElement("small");
              error.className = "offline-event-error";
              error.textContent = `${translations[currentLang].offlineEventFailed}: ${event.lastSyncError}`;
              details.appendChild(error);
            }
            const actions = document.createElement("div");
            actions.className = "offline-event-actions";
            if (event.lastSyncError) {
              const retryButton = document.createElement("button");
              retryButton.type = "button";
              retryButton.className = "btn secondary";
              retryButton.dataset.onlineOnly = "";
              retryButton.textContent = translations[currentLang].offlineRetry;
              retryButton.addEventListener("click", () => syncOfflineQueue(event.eventId));
              actions.appendChild(retryButton);
            }
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "admin-del-btn";
            deleteButton.textContent = translations[currentLang].deleteOfflineEventBtn;
            deleteButton.addEventListener("click", () => deleteQueuedOfflineEvent(event.eventId));
            actions.appendChild(deleteButton);
            item.append(details, actions);
            container.appendChild(item);
          });
          updateOnlineOnlyControls();
          syncButton.disabled = !events.length || !navigator.onLine || !currentUser || !googleIdToken || isSyncingOfflineQueue;
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
        if (!window.confirm(translations[currentLang].confirmDeleteOfflineEvent)) return;
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

