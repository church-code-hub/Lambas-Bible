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
        if (!cachedRosterPromise) {
          cachedRosterPromise = openOfflineDatabase().then((database) =>
            new Promise((resolve, reject) => {
              const request = database.transaction("roster", "readonly").objectStore("roster").getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error || new Error("Could not read saved roster"));
            }),
          ).catch((error) => {
            cachedRosterPromise = null;
            throw error;
          });
        }
        return cachedRosterPromise;
      }

      function findCachedPersonName(roster, id) {
        const cleanId = String(id || "").trim();
        if (!cleanId) return "";
        const person = roster.find((entry) =>
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
          console.warn("Could not match queued attendance IDs to the saved roster.", error);
        }
        return events;
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
        offlineRosterSearchCache = null;
        cachedRosterPromise = Promise.resolve(roster);
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
            id: String(person.id).trim(),
            name: String(person.name),
            qrId: String(person.qrId || "").trim(),
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

      function scoreCachedName(nameTokens, queryTokens) {
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

      async function getOfflineEventCount() {
        const database = await openOfflineDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction("events", "readonly").objectStore("events").count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Could not count saved actions"));
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
        let personName = event.personName || "";
        if (event.type === "scan" && !personName) {
          try {
            personName = await getCachedPersonName(event.qrText);
          } catch (error) {
            console.warn("Could not find the scanned ID in the saved roster.", error);
          }
        }
        const queuedEvent = {
          ...event,
          ...(personName ? { personName } : {}),
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
          const count = await getOfflineEventCount();
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
        const currentAttendeesTile = document.getElementById("currentAttendeesTile");
        if (currentAttendeesTile) {
          currentAttendeesTile.disabled =
            !navigator.onLine || !currentAttendeesWindowOpen;
        }
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
          retryButton.addEventListener("click", () => syncOfflineQueue(event.eventId, true));
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

      function offlineEventDescription(event) {
        if (event.type === "add_student") {
          const attendanceChoice = event.attendIfOpen
            ? translations[currentLang].offlineAttendYes
            : translations[currentLang].offlineAttendNo;
          return `${translations[currentLang].offlineEventAdd}: ${event.name} · ${attendanceChoice}`;
        }
        const person = event.personName || `${translations[currentLang].offlineUnknownPerson} (${event.qrText || "?"})`;
        return `${translations[currentLang].offlineEventScan}: ${person}`;
      }

      function getOfflineSyncBatch(events, targetEventId, groupType, accountEmail) {
        if (!events.length || events[0].queuedBy !== accountEmail) return null;
        const first = events[0];
        if (targetEventId) {
          return first.eventId === targetEventId ? [first] : null;
        }
        if (groupType && first.type !== groupType) return null;
        const batch = [];
        for (const event of events) {
          if (
            batch.length >= 20 ||
            event.queuedBy !== accountEmail ||
            event.type !== first.type
          ) break;
          batch.push(event);
        }
        return batch;
      }

      async function syncOfflineQueue(targetEventId = "", showProgress = false, groupType = "") {
        if (isSyncingOfflineQueue || !navigator.onLine || !currentUser || !googleIdToken) return null;
        isSyncingOfflineQueue = true;
        let targetResult = null;
        let progress = null;
        await updateOfflineStatus();
        try {
          let events = await hydrateOfflinePersonNames(await getOfflineEvents());
          const selectedBatch = getOfflineSyncBatch(events, targetEventId, groupType, currentUser.email);
          if ((targetEventId || groupType) && !selectedBatch) {
            showToast(translations[currentLang].offlineSyncOrderBlocked, "info");
            return null;
          }
          const progressEvents = targetEventId || groupType ? selectedBatch : events;
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
            requestBatch.forEach((candidate) => updateOfflineSyncProgress(progress, candidate.eventId, "Syncing"));
            if (showProgress) {
              await new Promise((resolve) => {
                if (window.requestAnimationFrame) window.requestAnimationFrame(resolve);
                else window.setTimeout(resolve, 0);
              });
            }
            const resultStartedAt = Date.now();
            let response = null;
            for (const delay of [0, 750, 2000, 4000]) {
              if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
              if (!navigator.onLine || !currentUser || !googleIdToken) break;
              response = await apiCall("sync_offline_events", { events: requestBatch });
              if (!response || !response.success || !Array.isArray(response.results)) break;
              if (!response.results.some((item) => item && item.status === "pending")) break;
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
              if (showProgress) {
                showToast(
                  translations[currentLang].offlineSyncProgressNoResult,
                  "error",
                  3000,
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, 3000 - (Date.now() - resultStartedAt))),
                );
              }
              break;
            }
            let shouldStop = response.results.length !== requestBatch.length;
            for (let index = 0; index < requestBatch.length; index++) {
              const eventResult = response.results[index];
              if (!eventResult || eventResult.status !== "complete") {
                const failureMessage = eventResult && eventResult.message
                  ? eventResult.message
                  : translations[currentLang].offlineSyncProgressNoResult;
                await saveOfflineSyncFailure(requestBatch[index], failureMessage);
                updateOfflineSyncProgress(
                  progress,
                  requestBatch[index].eventId,
                  "Failed",
                  failureMessage,
                );
                showToast(failureMessage, "error", showProgress ? 3000 : 4500);
                if (showProgress) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, Math.max(0, 3000 - (Date.now() - resultStartedAt))),
                  );
                }
                shouldStop = true;
                break;
              }
              const completedEvent = requestBatch[index];
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
              const eventTitle = offlineEventDescription(completedEvent);
              const eventMessage = [eventTitle, result.title, result.name, result.message]
                .filter((part) => typeof part === "string" && part.trim())
                .join(" · ");
              showToast(
                eventMessage || translations[currentLang].offlineSyncFailed,
                failed ? "error" : result.cardGenerationFailed ? "info" : "success",
                showProgress ? 3000 : 4500,
              );
              if (showProgress) {
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(0, 3000 - (Date.now() - resultStartedAt))),
                );
              }
              if (failed) {
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
          const events = await hydrateOfflinePersonNames(await getOfflineEvents());
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
            groupTitle.textContent = type === "add_student"
              ? translations[currentLang].offlineEventAdd
              : translations[currentLang].offlineEventScan;
            const groupSync = document.createElement("button");
            groupSync.type = "button";
            groupSync.className = "btn secondary offline-group-sync";
            groupSync.dataset.onlineOnly = "";
            groupSync.textContent = translations[currentLang].offlineSyncGroup;
            groupSync.disabled = !events.length ||
              events[0].type !== type ||
              events[0].queuedBy !== currentUser?.email;
            groupSync.addEventListener("click", () => syncOfflineQueue("", true, type));
            heading.append(groupTitle, groupSync);
            groupPanel.appendChild(heading);
            for (const event of groupEvents) {
              const item = document.createElement("article");
              item.className = "attendance-person-card offline-event-card";
              const details = document.createElement("div");
              const title = document.createElement("strong");
              title.textContent = offlineEventDescription(event);
              const metadata = document.createElement("small");
              metadata.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
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
              retryButton.disabled = !events.length ||
                events[0].eventId !== event.eventId ||
                event.queuedBy !== currentUser?.email;
              retryButton.addEventListener("click", () => syncOfflineQueue(event.eventId, true));
              actions.appendChild(retryButton);
              const deleteButton = document.createElement("button");
              deleteButton.type = "button";
              deleteButton.className = "admin-del-btn";
              deleteButton.textContent = translations[currentLang].deleteOfflineEventBtn;
              deleteButton.addEventListener("click", () => deleteQueuedOfflineEvent(event.eventId));
              actions.appendChild(deleteButton);
              item.append(details, actions);
              groupPanel.appendChild(item);
            }
            container.appendChild(groupPanel);
          }
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
