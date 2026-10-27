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
        if (!currentAttendanceContext && currentUser) refreshAttendanceContext();
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

      function runTutorialScanDemo() {
        if (typeof isFirstRunTutorialActive !== "function" || !isFirstRunTutorialActive()) return;
        showToast([
          translateText("tutorialSampleName"),
          translateText("tutorialNotSaved"),
        ].join(" · "), "info");
        nextFirstRunTutorialStep();
      }

      function attendanceFeedback(event, fromNameSearch, offline = false, response = null) {
        const result = offline
          ? {
            kind: "queued",
            title: "offlineQueuedTitle",
            name: event.personName || "",
            message: "offlineScanQueued",
          }
          : response || {
            kind: "queued",
            title: "attendanceScanProcessing",
            name: event.personName || "",
          };
        if (fromNameSearch) renderResult(result, true);
        const toast = showToast(
          offline
            ? translations[currentLang].offlineScanQueued
            : [result.name, translateText(result.title), translateText(result.message)]
              .filter(Boolean)
              .join(" · "),
          offline || result.kind === "queued" || result.kind === "warn" || result.kind === "closed"
            ? "info"
            : result.kind === "error"
              ? "error"
              : "success",
        );
        return toast;
      }

      function showAttendanceResult(result, fromNameSearch) {
        if (fromNameSearch) {
          renderResult(result, true);
          return;
        }
        const message = [
          result?.name,
          result?.title ? translateText(result.title) : "",
          result?.message ? translateText(result.message) : "",
        ].filter(Boolean).join(" · ");
        showToast(message || translations[currentLang].offlineSyncFailed,
          result?.success === false || result?.kind === "error" ? "error" : "info");
      }

      function updateAttendanceToast(toast, result, event, fallbackMessage, type) {
        const message = result
          ? [
            result.name || event.personName,
            result.title ? translateText(result.title) : "",
            result.message ? translateText(result.message) : "",
          ].filter(Boolean).join(" · ") || fallbackMessage
          : fallbackMessage;
        if (!toast?.isConnected) return showToast(message, type);
        toast.dataset.message = message;
        toast.textContent = translateText(message);
        toast.classList.remove("success", "info", "error");
        toast.classList.add(type);
        return toast;
      }

      function applyAttendanceContext(context) {
        if (
          !context ||
          context.success !== true ||
          !context.settings ||
          !Array.isArray(context.attendance) ||
          !context.spreadsheetTimeZone ||
          !context.scriptTimeZone
        ) return false;
        currentAttendanceContext = {
          ...context,
          email: String(currentUser?.email || "").toLowerCase().trim(),
          loadedAt: Date.now(),
        };
        persistAttendanceContextCache(currentAttendanceContext);
        return true;
      }

      function persistAttendanceContextCache(context) {
        if (
          typeof saveCachedApiResponse !== "function" ||
          typeof createApiCacheKey !== "function" ||
          !currentUser
        ) return;
        saveCachedApiResponse(
          createApiCacheKey("get_attendance_context", {}),
          context,
        ).catch((error) => {
          console.error("Could not save the attendance context cache.", error);
        });
      }

      async function refreshAttendanceContext() {
        if (!currentUser) return null;
        if (
          currentAttendanceContext &&
          currentAttendanceContext.email === String(currentUser.email).toLowerCase().trim() &&
          Date.now() - currentAttendanceContext.loadedAt < 30_000
        ) return currentAttendanceContext;
        if (attendanceContextRefreshPromise) return attendanceContextRefreshPromise;
        attendanceContextRefreshPromise = (async () => {
          try {
            const result = await apiCall("get_attendance_context", {}, (freshResult) => {
              applyAttendanceContext(freshResult);
            });
            applyAttendanceContext(result);
            return currentAttendanceContext;
          } catch (error) {
            console.warn("Could not refresh local attendance context.", error);
            return currentAttendanceContext;
          } finally {
            attendanceContextRefreshPromise = null;
          }
        })();
        return attendanceContextRefreshPromise;
      }

      function zonedAttendanceParts(timestamp, timeZone) {
        const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          weekday: "short",
          hourCycle: "h23",
        }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
        const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return {
          dateKey: `${values.year}-${values.month}-${values.day}`,
          day: weekdays[values.weekday],
          minute: Number(values.hour) * 60 + Number(values.minute),
          hour: Number(values.hour),
          minuteOfHour: Number(values.minute),
        };
      }

      function previousAttendanceDate(dateKey) {
        const [year, month, day] = dateKey.split("-").map(Number);
        const previous = new Date(Date.UTC(year, month - 1, day - 1));
        return [
          previous.getUTCFullYear(),
          String(previous.getUTCMonth() + 1).padStart(2, "0"),
          String(previous.getUTCDate()).padStart(2, "0"),
        ].join("-");
      }

      function attendanceOccurrence(timestamp, context) {
        const parts = zonedAttendanceParts(timestamp, context.spreadsheetTimeZone);
        const settings = context.settings;
        const [startHour, startMinute] = settings.startTime.split(":").map(Number);
        const [endHour, endMinute] = settings.endTime.split(":").map(Number);
        const start = startHour * 60 + startMinute;
        let end = endHour * 60 + endMinute;
        if (end <= start) end += 24 * 60;
        const allowedDays = Array.isArray(settings.allowedDays) ? settings.allowedDays : [];
        const candidates = [
          { dateKey: parts.dateKey, day: parts.day, minute: parts.minute },
          {
            dateKey: previousAttendanceDate(parts.dateKey),
            day: (parts.day + 6) % 7,
            minute: parts.minute + 24 * 60,
          },
        ];
        const occurrence = candidates.find((candidate) =>
          allowedDays.includes(candidate.day) &&
          candidate.minute >= start &&
          candidate.minute <= end + 60,
        );
        return occurrence ? { ...occurrence, start, end } : null;
      }

      function formatAttendanceDuration(minutes) {
        if (minutes < 60) return `${minutes} دقيقة`;
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return remainder === 0
          ? `${hours} ساعة`
          : `${hours} ساعة و${remainder} دقيقة`;
      }

      function predictAttendanceResult(id, event, cachedPerson = null, contextOverride = null) {
        const context = contextOverride || currentAttendanceContext;
        if (!context || !context.settings) return null;
        const attendancePerson = context.attendance.find((person) =>
          String(person.id) === String(id) ||
          String(person.qrId) === String(id) ||
          (cachedPerson && String(person.id) === String(cachedPerson.id)),
        );
        if (!attendancePerson && !cachedPerson && !event.personName) return null;
        const rosterPerson = cachedPerson || attendancePerson;
        const cachedName = rosterPerson ? rosterPerson.name : "";
        const personName = event.personName || cachedName;
        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp)) return null;
        const occurrence = attendanceOccurrence(timestamp, context);
        const localDate = zonedAttendanceParts(timestamp, context.spreadsheetTimeZone).dateKey;
        const sessionDate = occurrence ? occurrence.dateKey : localDate;
        const existing = sessionDate === context.sessionDate
          ? context.attendance.find((person) =>
            String(person.id) === String(id) ||
            String(person.qrId) === String(id) ||
            (rosterPerson && String(person.id) === String(rosterPerson.id)),
          )
          : null;
        if (existing) {
          if (existing.checkedOut) {
            return {
              kind: "warn",
              title: "مسجّل حضور وانصراف!",
              name: personName,
              message: "تم رصد حضور وانصراف مسبقاً اليوم.",
            };
          }
          if (occurrence && occurrence.minute >= occurrence.end - 30 &&
              occurrence.minute <= occurrence.end + 60) {
            const checkoutTime = new Intl.DateTimeFormat("en-US", {
              timeZone: context.scriptTimeZone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }).format(new Date(timestamp));
            existing.checkedOut = true;
            existing.checkoutTime = timestamp;
            if (!contextOverride) persistAttendanceContextCache(context);
            return {
              kind: "out",
              title: "تم تسجيل الانصراف!",
              name: personName,
              message: `وقت الانصراف: ${checkoutTime}`,
            };
          }
          return {
            kind: "warn",
            title: "مسجّل حضور بالفعل!",
            name: personName,
            message: "تم تسجيل الحضور اليوم.",
          };
        }
        if (!occurrence || occurrence.minute > occurrence.end) {
          return {
            kind: "closed",
            title: "النظام مغلق الآن!",
            name: "",
            message: "يستقبل التسجيل في المواعيد الرسمية فقط.",
          };
        }
        const scriptTime = zonedAttendanceParts(timestamp, context.scriptTimeZone);
        const checkinMinute = scriptTime.hour * 60 + scriptTime.minuteOfHour;
        const [startHour, startMinute] = context.settings.startTime.split(":").map(Number);
        const deadline = startHour * 60 + startMinute + (Number(context.settings.acceptedDelay) || 0);
        const delay = Math.max(0, Math.ceil((checkinMinute - deadline) / 1));
        const result = delay > 0
          ? {
            kind: "late",
            title: "تم الحضور - متأخر",
            name: personName,
            message: `مقدار التأخير: ${formatAttendanceDuration(delay)}`,
          }
          : {
            kind: "success",
            title: "تم تسجيل الحضور بنجاح!",
            name: personName,
            message: "🎯 في الموعد المحدد",
          };
        context.attendance.push({
          id: rosterPerson ? rosterPerson.id : String(id),
          qrId: rosterPerson ? rosterPerson.qrId : String(id),
          name: personName,
          checkinTime: timestamp,
          checkoutTime: null,
          checkedOut: false,
        });
        if (!contextOverride) persistAttendanceContextCache(context);
        return result;
      }

      async function processAttendanceId(rawId, fromNameSearch = false, personName = "", eventContext = {}) {
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          showAttendanceResult({
            kind: "error",
            title: "Sign-in required",
            message: "offlineNeedsLogin",
          }, fromNameSearch);
          return;
        }
        const id = String(rawId);
        const event = {
          eventId: eventContext.eventId || crypto.randomUUID(),
          timestamp: eventContext.timestamp || new Date().toISOString(),
          personName,
        };
        if (typeof isFirstRunTutorialActive === "function" && isFirstRunTutorialActive()) {
          let cachedPerson = null;
          try {
            const roster = await getCachedRoster();
            cachedPerson = roster.find((person) =>
              String(person.id).trim() === id || String(person.qrId || "").trim() === id,
            ) || null;
            if (cachedPerson && !event.personName) event.personName = cachedPerson.name;
          } catch (error) {
            console.warn("Could not read the saved attendee name for the tutorial demo.", error);
          }
          const simulatedContext = currentAttendanceContext
            ? {
              ...currentAttendanceContext,
              settings: { ...currentAttendanceContext.settings },
              attendance: currentAttendanceContext.attendance.map((person) => ({ ...person })),
            }
            : null;
          const result = simulatedContext
            ? predictAttendanceResult(id, event, cachedPerson, simulatedContext)
            : null;
          showToast([
            event.personName || result?.name || "",
            result?.title ? translateText(result.title) : "",
            result?.message ? translateText(result.message) : "",
            translateText("tutorialNotSaved"),
          ].filter(Boolean).join(" · "), "info");
          if (tutorialHighlightedTarget?.id === "tutorialScanDemoButton") {
            nextFirstRunTutorialStep();
          }
          return;
        }
        if (navigator.onLine) {
          let cachedPerson = null;
          try {
            const roster = await getCachedRoster();
            cachedPerson = roster.find((person) =>
              String(person.id).trim() === id || String(person.qrId || "").trim() === id,
            ) || null;
            if (cachedPerson && !event.personName) event.personName = cachedPerson.name;
          } catch (error) {
            console.warn("Could not read the saved attendee name.", error);
          }
          currentAttendanceEventId = event.eventId;
          const toast = showToast(
            [event.personName, translations[currentLang].attendanceScanProcessing]
              .filter(Boolean)
              .join(" · "),
            "info",
          );
          try {
            const result = await apiCall("scan", { id });
            if (!result || typeof result !== "object") {
              throw new Error("The attendance service returned an invalid response.");
            }
            const attendanceResult = result.success === false && !result.kind
              ? { ...result, kind: "error" }
              : result;
            const type = attendanceResult.success === false || attendanceResult.kind === "error"
              ? "error"
              : attendanceResult.kind === "warn" || attendanceResult.kind === "closed"
                ? "info"
                : "success";
            updateAttendanceToast(
              toast,
              attendanceResult,
              event,
              translations[currentLang].offlineSyncFailed,
              type,
            );
            if (currentAttendanceEventId === event.eventId) {
              if (fromNameSearch) renderResult(attendanceResult, true);
              refreshAttendanceContext();
            }
          } catch (error) {
            console.error("Could not submit attendance scan.", error);
            updateAttendanceToast(
              toast,
              null,
              event,
              "Connection error.",
              "error",
            );
            if (fromNameSearch) {
              showAttendanceResult({
                kind: "error",
                title: "Connection error.",
                message: "Connection error.",
              }, true);
            }
          }
          return;
        }
        try {
          const queuedEvent = await queueOfflineEvent({
            type: "scan",
            qrText: id,
            personName,
            eventId: event.eventId,
            timestamp: event.timestamp,
          });
          currentAttendanceEventId = queuedEvent.eventId;
          attendanceFeedback(queuedEvent, fromNameSearch, true);
        } catch (error) {
          showAttendanceResult({
            kind: "error",
            title: "Error",
            message: "offlineStorageError",
          }, fromNameSearch);
        }
      }

      async function processScannedText(text, eventContext = {}) {
        var id = extractId(text);
        if (!id) {
          showToast([
            translateText("Invalid Code"),
            translateText("Make sure to scan a valid card"),
          ].join(" · "), "error");
          return;
        }
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          showToast(translateText("offlineNeedsLogin"), "error");
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

      function runTutorialSearchDemo() {
        if (typeof isFirstRunTutorialActive !== "function" || !isFirstRunTutorialActive()) return;
        showToast([
          translateText("tutorialSampleName"),
          translateText("tutorialNotSaved"),
        ].join(" · "), "info");
        nextFirstRunTutorialStep();
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
