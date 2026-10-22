      function setCameraStatus(translationKey) {
        const status = document.getElementById("cameraStatus");
        status.setAttribute("data-i18n", translationKey);
        status.textContent = translations[currentLang][translationKey];
      }

      function loadQrLibrary() {
        if (window.Html5Qrcode) return Promise.resolve();
        if (!qrLibraryPromise) {
          qrLibraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "./vendor/html5-qrcode.min.js";
            script.async = true;
            script.onload = () => {
              if (window.Html5Qrcode) resolve();
              else reject(new Error("QR scanner library did not initialize."));
            };
            script.onerror = () => reject(new Error("QR scanner library could not be loaded."));
            document.head.appendChild(script);
          }).catch((error) => {
            qrLibraryPromise = null;
            throw error;
          });
        }
        return qrLibraryPromise;
      }

      async function startLiveScanner() {
        if (isScannerRunning || isScannerStarting) return;
        const generation = ++scannerStartGeneration;
        isScannerStarting = true;
        setCameraStatus("cameraStarting");
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };

        try {
          await loadQrLibrary();
          if (generation !== scannerStartGeneration || currentActiveViewId !== "scanView") return;
          if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");
          try {
            await html5QrCode.start(
              { facingMode: "environment" },
              config,
              onScanSuccess,
              onScanError,
            );
          } catch (environmentCameraError) {
            await html5QrCode.start(
              { facingMode: "user" },
              config,
              onScanSuccess,
              onScanError,
            );
          }
          isScannerRunning = true;
          setCameraStatus("cameraActive");
        } catch (err) {
          isScannerRunning = false;
          setCameraStatus(window.Html5Qrcode ? "cameraUnavailable" : "cameraError");
        } finally {
          isScannerStarting = false;
          if (
            generation !== scannerStartGeneration &&
            currentActiveViewId === "scanView"
          ) {
            window.setTimeout(startLiveScanner, 0);
          }
        }
      }

      function stopLiveScanner() {
        scannerStartGeneration++;
        if (html5QrCode && isScannerRunning) {
          return html5QrCode
            .stop()
            .then(() => {
              isScannerRunning = false;
            })
            .catch(() => {
              isScannerRunning = false;
            })
            .finally(() => {
              if (currentActiveViewId === "scanView") {
                window.setTimeout(startLiveScanner, 150);
              }
            });
        }
        return Promise.resolve();
      }

      function restartScanner() {
        isProcessingScan = false;
        stopLiveScanner().then(() => {
          setTimeout(startLiveScanner, 200);
        });
      }

      function onScanSuccess(text) {
        if (isProcessingScan) return;
        isProcessingScan = true;
        const eventContext = {
          eventId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };
        stopLiveScanner();
        processScannedText(text, eventContext).finally(() => {
          isProcessingScan = false;
        });
      }
      function onScanError(err) {}

      function beginDelayedAttendanceFeedback(fromNameSearch, event) {
        const feedback = { event, fromNameSearch, queuedEvent: null, result: null, shown: false, timer: 0 };
        feedback.timer = window.setTimeout(() => {
          feedback.shown = true;
          const result = feedback.result &&
            feedback.result.success !== false &&
            feedback.result.kind !== "error"
            ? feedback.result
            : {
              kind: "queued",
              title: "offlineQueuedTitle",
              name: feedback.queuedEvent?.personName || event.personName || "",
              message: "offlineScanQueued",
            };
          renderResult(result, feedback.fromNameSearch);
        }, 1000 + Math.floor(Math.random() * 1001));
        return feedback;
      }

      async function processAttendanceId(rawId, fromNameSearch = false, personName = "", eventContext = {}) {
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          renderResult({
            kind: "error",
            title: "Sign-in required",
            message: "offlineNeedsLogin",
          }, fromNameSearch);
          return;
        }
        const id = String(rawId);
        const feedback = beginDelayedAttendanceFeedback(fromNameSearch, {
          eventId: eventContext.eventId || crypto.randomUUID(),
          timestamp: eventContext.timestamp || new Date().toISOString(),
          personName,
        });
        try {
          const queuedEvent = await queueOfflineEvent({
            type: "scan",
            qrText: id,
            personName,
            eventId: feedback.event.eventId,
            timestamp: feedback.event.timestamp,
          });
          feedback.queuedEvent = queuedEvent;
          syncQueuedEventImmediately(queuedEvent)
            .then((result) => {
              feedback.result = result;
              if (feedback.shown && result && result.success !== false && result.kind !== "error") {
                renderResult(result, fromNameSearch);
              }
            })
            .catch((error) => {
              console.error("Could not complete immediate attendance sync.", error);
            });
        } catch (error) {
          window.clearTimeout(feedback.timer);
          renderResult({
            kind: "error",
            title: "Error",
            message: "offlineStorageError",
          }, fromNameSearch);
        }
      }

      async function processScannedText(text, eventContext = {}) {
        var id = extractId(text);
        if (!id) {
          renderResult({
            kind: "error",
            title: "Invalid Code",
            message: "Make sure to scan a valid card",
          });
          return;
        }
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          renderResult({ kind: "error", title: "Sign-in required", message: "offlineNeedsLogin" });
          return;
        }
        await processAttendanceId(id, false, "", eventContext);
      }

      async function processDirectAttendance(rawId, fromNameSearch = false, personName = "") {
        return processAttendanceId(
          rawId,
          fromNameSearch,
          personName,
          { eventId: crypto.randomUUID(), timestamp: new Date().toISOString() },
        );
      }

      function renderNameSearchResults(result, isOffline) {
        const results = document.getElementById("searchResults");
        results.replaceChildren();
        if (!result || result.status === "no_match" || result.status === "error") {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = translateText("noSearchMatches");
          results.appendChild(empty);
          return;
        }
        if (isOffline) {
          const note = document.createElement("div");
          note.className = "search-suggestions-heading";
          note.dataset.translationKey = "offlineSearchResults";
          note.textContent = translateText("offlineSearchResults");
          results.appendChild(note);
        }
        if (result.status === "exact_match") {
          processDirectAttendance(result.id, true, result.name || "");
          return;
        }
        if (result.status === "suggestions" && Array.isArray(result.matches)) {
          const heading = document.createElement("div");
          heading.className = "search-suggestions-heading";
          heading.dataset.translationKey = "searchSuggestions";
          heading.textContent = "💡 " + translateText("searchSuggestions");
          results.appendChild(heading);
          result.matches.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "suggestion-btn";
            const icon = document.createElement("i");
            icon.className = "fa-solid fa-user";
            const label = document.createElement("span");
            label.textContent = item.name;
            button.append(icon, label);
            button.onclick = () => processDirectAttendance(item.id, true, item.name);
            results.appendChild(button);
          });
        }
      }

      async function executeSearch() {
        var name = document.getElementById("searchNameInput").value.trim();
        var resDiv = document.getElementById("searchResults");
        if (!name) {
          showToast("⚠️ Please enter a name", "error");
          return;
        }
        if (isNameSearchRunning) return;
        isNameSearchRunning = true;
        const searchButton = document.getElementById("btnSearch");
        searchButton.disabled = true;
        let finishOfflineSearch = null;
        try {
          if (!navigator.onLine) {
            finishOfflineSearch = beginUserActionRequest();
            showSearchLoader(resDiv);
            const roster = await getCachedRoster();
            if (!roster.length) {
              resDiv.replaceChildren();
              const empty = document.createElement("div");
              empty.className = "search-empty";
              empty.textContent = translateText("offlineSearchNoCache");
              resDiv.appendChild(empty);
              return;
            }
            renderNameSearchResults(searchCachedRoster(roster, name), true);
          } else {
            showSearchLoader(resDiv);
            const response = await apiCall("search", { name: name }, (freshResponse) => {
              if (
                currentActiveViewId === "searchView" &&
                document.getElementById("searchNameInput").value.trim() === name &&
                freshResponse &&
                freshResponse.success !== false
              ) {
                renderNameSearchResults(freshResponse, false);
              }
            });
            if (response && response.success === false) {
              resDiv.replaceChildren();
              showToast(response.message || "Error", "error");
              return;
            }
            renderNameSearchResults(response, false);
          }
        } catch (err) {
          if (navigator.onLine) {
            try {
              const roster = await getCachedRoster();
              if (roster.length) {
                renderNameSearchResults(searchCachedRoster(roster, name), true);
                return;
              }
            } catch (cacheError) {
              showToast(translations[currentLang].offlineSearchCacheFailed, "info");
            }
          }
          resDiv.replaceChildren();
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = navigator.onLine
            ? "❌ Error during search"
            : translateText("offlineSearchNoCache");
          resDiv.appendChild(empty);
          if (navigator.onLine) showToast("❌ Error during search", "error");
        } finally {
          isNameSearchRunning = false;
          searchButton.disabled = false;
          if (finishOfflineSearch) finishOfflineSearch();
          if (currentActiveViewId === "searchView") {
            addSearchAgainButton(resDiv, document.getElementById("searchNameInput"));
          }
        }
      }

      function renderCardShareResults(res, resDiv) {
        if (res && res.success === false) {
          resDiv.replaceChildren();
          showToast(res.message || "Error", "error");
          return;
        }
        resDiv.replaceChildren();
        if (res && res.status === "success" && Array.isArray(res.matches)) {
          res.matches.forEach((item) => {
            const cardBox = document.createElement("button");
            cardBox.type = "button";
            cardBox.className = "card-result";
            cardBox.dataset.onlineOnly = "";
            cardBox.style.cssText =
              "background:var(--chip-bg); backdrop-filter:blur(15px); border:1.5px solid var(--card-border); padding:14px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition: all 0.2s;";

            const statusText = item.isNew
              ? translations[currentLang].notShared
              : translations[currentLang].alreadyShared;
            const statusColor = item.isNew ? "#f59e0b" : "#16a34a";

            const nameLabel = document.createElement("div");
            nameLabel.className = "card-result-name";
            nameLabel.textContent = "👤 " + item.name;
            const statusLabel = document.createElement("div");
            statusLabel.className = "card-result-status";
            statusLabel.dataset.i18nKey = item.isNew ? "notShared" : "alreadyShared";
            statusLabel.style.color = statusColor;
            statusLabel.textContent = statusText;
            cardBox.append(nameLabel, statusLabel);
            cardBox.onclick = () => openCardPreview(item.fileId, item.driveUrl, item.name);
            resDiv.appendChild(cardBox);
          });
          updateOnlineOnlyControls();
        } else {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.dataset.i18nKey = "noCardsFound";
          empty.textContent = "❌ " + translateText("No cards found");
          resDiv.appendChild(empty);
        }
      }

      // Card Share Search with Visible Tech Loader -> Clicking opens Preview View
      async function executeCardSearch() {
        var name = document.getElementById("shareNameInput").value.trim();
        var resDiv = document.getElementById("shareResults");
        if (!name) {
          showToast("⚠️ Please enter a servant name", "error");
          return;
        }
        if (!navigator.onLine) {
          showToast(translateText("searchRequiresInternet"), "info");
          return;
        }

        if (isCardSearchRunning) return;
        isCardSearchRunning = true;
        const searchButton = document.querySelector("#cardShareView .btn");
        searchButton.disabled = true;
        searchButton.dataset.busy = "true";
        showSearchLoader(resDiv);
        try {
          const payload = {
            name: name,
            filter: document.getElementById("cardShareFilter").value,
          };
          const res = await apiCall("search_card_share", payload, (freshResponse) => {
            if (
              currentActiveViewId === "cardShareView" &&
              document.getElementById("shareNameInput").value.trim() === payload.name &&
              document.getElementById("cardShareFilter").value === payload.filter
            ) renderCardShareResults(freshResponse, resDiv);
          });
          renderCardShareResults(res, resDiv);
        } catch (e) {
          resDiv.innerHTML = "";
          showToast("❌ Search error", "error");
        } finally {
          isCardSearchRunning = false;
          delete searchButton.dataset.busy;
          searchButton.disabled = !navigator.onLine;
          if (currentActiveViewId === "cardShareView") {
            addSearchAgainButton(resDiv, document.getElementById("shareNameInput"));
          }
        }
      }
