      window.addEventListener("DOMContentLoaded", async function () {
        setLanguage(currentLang);
        applyTheme(currentThemeMode);
        setDashboardLayout(localStorage.getItem("app_dashboard_layout") || "grouped");
        let savedUser = null;
        try {
          savedUser = JSON.parse(localStorage.getItem("app_user") || "null");
        } catch (error) {
          console.warn("Could not read the saved account profile.", error);
          localStorage.removeItem("app_user");
        }
        const hasSavedUser = Boolean(savedUser && savedUser.email);
        if (!hasSavedUser) {
          window.setTimeout(dismissStartupScreen, 1050);
        }
        initializeNumericPasswords();
        const enterActions = {
          searchNameInput: executeSearch,
          shareNameInput: executeCardSearch,
          newStudentName: submitNewStudent,
          adminGatePassword: unlockAdminSettings,
          cfgAdminName: updateMyName,
          cfgNewPassword: saveAdminSettings,
          newAdminEmail: () => document.getElementById("newAdminNameInput").focus(),
          newAdminNameInput: addNewAdmin,
          scheduleGatePassword: unlockScheduleSettings,
          cfgStartTime: saveScheduleSettings,
          cfgEndTime: saveScheduleSettings,
          cfgAcceptedDelay: saveScheduleSettings,
        };
        Object.entries(enterActions).forEach(([fieldId, action]) => {
          const field = document.getElementById(fieldId);
          if (!field) return;
          field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.isComposing) return;
            event.preventDefault();
            action();
          });
        });
        if (hasSavedUser) {
          currentUser = savedUser;
          setupUserProfileUI();
          checkDirectUrlScan();
          if (navigator.onLine) {
            initializeGoogleSignIn(false);
            if (googleIdToken) validateSavedSession();
            else beginSessionRestore(currentUser.email);
          }
        } else {
          if (navigator.onLine) initializeGoogleSignIn(true);
          showView("loginView", false);
        }
        await updateOfflineStatus();
      });

      async function validateSavedSession() {
        if (!currentUser || !googleIdToken || !navigator.onLine) return;
        const expectedEmail = currentUser.email.toLowerCase().trim();
        try {
          const authRes = await apiCall("check_auth", { email: expectedEmail });
          if (
            authRes &&
            authRes.authorized &&
            String(authRes.email || "").toLowerCase().trim() === expectedEmail
          ) {
            if (authRes.adminName) currentUser.name = authRes.adminName;
            currentUser.isOwner = authRes.isOwner === true;
            localStorage.setItem(OFFLINE_SESSION_KEY, expectedEmail);
            localStorage.setItem("app_user", JSON.stringify(currentUser));
            setupUserProfileUI();
            refreshRosterCache();
            refreshAttendanceContext();
            return;
          }
          if (authRes && authRes.code === "AUTH_INVALID") {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            beginSessionRestore(expectedEmail);
          } else if (authRes && authRes.success && !authRes.authorized) {
            logoutUser("❌ Unauthorized account.");
          } else if (authRes && authRes.authorized) {
            logoutUser("Please sign in again.");
          }
        } catch (error) {
          console.warn("Could not validate the saved Google session yet.", error);
        }
      }

      function dismissStartupScreen() {
        const startupScreen = document.getElementById("startupScreen");
        if (!startupScreen) return;
        startupScreen.classList.add("is-exiting");
        window.setTimeout(() => {
          startupScreen.hidden = true;
          startupScreen.setAttribute("aria-hidden", "true");
        }, 280);
      }

      function initializeGoogleSignIn(showErrors = true) {
        if (googleSignInInitialized) return true;
        const clientId = APP_CONFIG.googleClientId;
        const button = document.getElementById("g_id_signin");
        if (!clientId || !button) {
          if (showErrors) showLoginError("Application is not configured.");
          return false;
        }
        if (!window.google || !google.accounts || !google.accounts.id) {
          if (showErrors) showLoginError("Google sign-in could not be loaded.");
          return false;
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: true,
        });
        google.accounts.id.renderButton(button, {
          type: "standard",
          size: "large",
          theme: "outline",
          text: "sign_in_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
        googleSignInInitialized = true;
        return true;
      }

      function beginSessionRestore(email) {
        if (!navigator.onLine || !window.google || !google.accounts || !google.accounts.id) {
          isSilentSessionRestore = false;
          return;
        }
        pendingSessionRestoreEmail = String(email || "").toLowerCase().trim();
        isSilentSessionRestore = true;
        google.accounts.id.prompt((notification) => {
          const unavailable =
            (notification.isNotDisplayed && notification.isNotDisplayed()) ||
            (notification.isSkippedMoment && notification.isSkippedMoment()) ||
            (notification.isDismissedMoment && notification.isDismissedMoment());
          if (unavailable && pendingSessionRestoreEmail) {
            pendingSessionRestoreEmail = "";
            isSilentSessionRestore = false;
          }
        });
      }

      async function handleCredentialResponse(response) {
        const payload = parseJwt(response.credential);
        if (!payload || !payload.email) {
          showLoginError("Could not read Google account data");
          return;
        }
        const expectedEmail = pendingSessionRestoreEmail;
        const restoringSavedAccount = isSilentSessionRestore && Boolean(currentUser);
        pendingSessionRestoreEmail = "";
        isSilentSessionRestore = false;
        if (expectedEmail && payload.email.toLowerCase().trim() !== expectedEmail) {
          if (!currentUser) showView("loginView", false);
          return;
        }

        googleIdToken = response.credential;
        if (!restoringSavedAccount) showLoader("Verifying your Google account...");
        try {
          const authRes = await apiCall("check_auth", { email: payload.email });
          if (!restoringSavedAccount) hideLoader();
          if (
            authRes &&
            authRes.authorized &&
            String(authRes.email || "").toLowerCase().trim() === payload.email.toLowerCase().trim()
          ) {
            currentUser = {
              email: payload.email.toLowerCase().trim(),
              name: authRes.adminName || payload.name || payload.email,
              picture:
                payload.picture ||
                "https://lh3.googleusercontent.com/a/default-user",
              isOwner: authRes.isOwner === true,
            };
            sessionStorage.setItem("google_id_token", googleIdToken);
            localStorage.setItem("google_id_token", googleIdToken);
            localStorage.setItem("app_user", JSON.stringify(currentUser));
            localStorage.setItem(OFFLINE_SESSION_KEY, currentUser.email);
            setupUserProfileUI();
            checkDirectUrlScan();
            refreshRosterCache();
            refreshAttendanceContext();
          } else if (authRes && authRes.code === "AUTH_INVALID") {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            if (restoringSavedAccount) {
              showToast("Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.", "error");
            } else {
              showLoginError("Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.");
            }
          } else if (authRes && authRes.code === "AUTH_REQUIRED") {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            if (!restoringSavedAccount) showLoginError("Please sign in again.");
          } else if (authRes && authRes.authorized) {
            logoutUser("Please sign in again.");
          } else if (authRes && authRes.success === false) {
            if (restoringSavedAccount) {
              showToast("Sign-in check failed on the server. Verify the latest Apps Script deployment.", "error");
            } else {
              showLoginError("Sign-in check failed on the server. Verify the latest Apps Script deployment.");
            }
          } else {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            const checkedEmail = authRes && authRes.email ? authRes.email : payload.email;
            showLoginError("❌ Sorry, email is not authorized.\n" + translateText("Email not listed in Admins: ") + checkedEmail);
          }
        } catch (e) {
          googleIdToken = "";
          localStorage.removeItem("google_id_token");
          sessionStorage.removeItem("google_id_token");
          if (!restoringSavedAccount) {
            hideLoader();
            currentUser = null;
            showLoginError("Connection error.");
          } else {
            console.warn("Could not refresh the saved account session.", e);
          }
        }
      }

      function setupUserProfileUI() {
        if (!currentUser) return;
        document.getElementById("uName").innerText = currentUser.name;
        document.getElementById("uEmail").innerText = currentUser.email;
        const avatar = document.getElementById("uAvatar");
        const fallback = document.getElementById("uAvatarFallback");
        const showAvatarFallback = () => {
          avatar.hidden = true;
          fallback.hidden = false;
        };
        avatar.hidden = false;
        fallback.hidden = true;
        avatar.onerror = showAvatarFallback;
        avatar.src = currentUser.picture || "";
        if (!currentUser.picture) showAvatarFallback();
        startFirstRunTutorial();
        showView("dashboardView");
        dismissStartupScreen();
      }

      const firstRunTutorialSteps = [
        { title: "tutorialScanTitle", description: "tutorialScanDescription", demo: "scan" },
        { title: "tutorialNameTitle", description: "tutorialNameDescription", demo: "name" },
        { title: "tutorialAddTitle", description: "tutorialAddDescription", demo: "add" },
        { title: "tutorialOfflineTitle", description: "tutorialOfflineDescription", demo: "offline" },
        { title: "tutorialDoneTitle", description: "tutorialDoneDescription", demo: "done" },
      ];
      var firstRunTutorialStep = 0;
      var firstRunTutorialRoster = [];

      function tutorialStorageKey() {
        return `app_tutorial_completed_${String(currentUser?.email || "").toLowerCase().trim()}`;
      }

      function startFirstRunTutorial() {
        if (!currentUser || localStorage.getItem(tutorialStorageKey()) === "true") return;
        const dialog = document.getElementById("firstRunTutorial");
        if (!dialog || dialog.open) return;
        if (!dialog.dataset.closeHandlerBound) {
          dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            finishFirstRunTutorial();
          });
          dialog.dataset.closeHandlerBound = "true";
        }
        firstRunTutorialStep = 0;
        renderFirstRunTutorialStep();
        window.setTimeout(() => {
          if (currentUser && localStorage.getItem(tutorialStorageKey()) !== "true" && !dialog.open) {
            dialog.showModal();
          }
        }, 350);
      }

      function replayFirstRunTutorial() {
        if (!currentUser) return;
        firstRunTutorialStep = 0;
        renderFirstRunTutorialStep();
        const dialog = document.getElementById("firstRunTutorial");
        if (!dialog.open) dialog.showModal();
      }

      function createTutorialElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
      }

      function tutorialDemoCard() {
        const card = createTutorialElement("div", "tutorial-demo-card");
        return card;
      }

      function renderFirstRunTutorialStep() {
        const step = firstRunTutorialSteps[firstRunTutorialStep];
        if (!step) return;
        const translationsForLanguage = translations[currentLang];
        document.getElementById("tutorialTitle").textContent = translationsForLanguage[step.title];
        document.getElementById("tutorialDescription").textContent =
          translationsForLanguage[step.description];
        document.getElementById("tutorialStepCount").textContent =
          translationsForLanguage.tutorialStepCount
            .replace("{step}", String(firstRunTutorialStep + 1))
            .replace("{total}", String(firstRunTutorialSteps.length));
        document.getElementById("tutorialProgressBar").style.width =
          `${((firstRunTutorialStep + 1) / firstRunTutorialSteps.length) * 100}%`;
        const back = document.getElementById("tutorialBackButton");
        const next = document.getElementById("tutorialNextButton");
        back.hidden = firstRunTutorialStep === 0;
        next.textContent = translationsForLanguage[
          firstRunTutorialStep === firstRunTutorialSteps.length - 1
            ? "tutorialFinish"
            : "tutorialNext"
        ];
        const demo = document.getElementById("tutorialDemo");
        demo.replaceChildren();
        if (step.demo === "scan") renderTutorialAttendanceDemo(demo, "tutorialScanDemoButton");
        else if (step.demo === "name") renderTutorialNameDemo(demo);
        else if (step.demo === "add") renderTutorialAddDemo(demo);
        else if (step.demo === "offline") {
          const card = tutorialDemoCard();
          card.appendChild(createTutorialElement("strong", "", translationsForLanguage.tutorialOfflineCardTitle));
          card.appendChild(createTutorialElement("p", "tutorial-demo-note", translationsForLanguage.tutorialOfflineCardDescription));
          demo.appendChild(card);
        } else {
          const card = tutorialDemoCard();
          card.appendChild(createTutorialElement("strong", "", translationsForLanguage.tutorialSafeDemo));
          card.appendChild(createTutorialElement("p", "tutorial-demo-note", translationsForLanguage.tutorialDoneCardDescription));
          demo.appendChild(card);
        }
      }

      async function loadTutorialRoster() {
        try {
          firstRunTutorialRoster = await getCachedRoster();
          if (!firstRunTutorialRoster.length && navigator.onLine && googleIdToken) {
            await refreshRosterCache();
            firstRunTutorialRoster = await getCachedRoster();
          }
          return firstRunTutorialRoster;
        } catch (error) {
          console.error("Could not load real attendee names for the tutorial demo.", error);
          return [];
        }
      }

      function addTutorialAttendeeSelector(card) {
        const select = createTutorialElement("select", "tutorial-attendee-select");
        select.setAttribute("aria-label", translations[currentLang].tutorialChooseAttendee);
        const placeholder = createTutorialElement("option", "", translations[currentLang].tutorialChooseAttendee);
        placeholder.value = "";
        select.appendChild(placeholder);
        card.appendChild(select);
        loadTutorialRoster().then((roster) => {
          if (!select.isConnected) return;
          roster.forEach((person) => {
            const option = createTutorialElement("option", "", person.name);
            option.value = String(person.id);
            select.appendChild(option);
          });
          if (!roster.length) {
            const unavailable = createTutorialElement(
              "option",
              "",
              translations[currentLang].tutorialNoRoster,
            );
            unavailable.disabled = true;
            select.appendChild(unavailable);
          }
        });
        return select;
      }

      function renderTutorialAttendanceDemo(container, buttonKey) {
        const card = tutorialDemoCard();
        const select = addTutorialAttendeeSelector(card);
        const button = createTutorialElement("button", "btn secondary", translations[currentLang][buttonKey]);
        button.type = "button";
        button.addEventListener("click", () => runTutorialAttendanceDemo(select, card));
        card.appendChild(button);
        container.appendChild(card);
      }

      function renderTutorialNameDemo(container) {
        const card = tutorialDemoCard();
        const input = createTutorialElement("input");
        input.type = "search";
        input.placeholder = translations[currentLang].tutorialNamePlaceholder;
        input.setAttribute("aria-label", translations[currentLang].tutorialNamePlaceholder);
        const select = addTutorialAttendeeSelector(card);
        const button = createTutorialElement("button", "btn secondary", translations[currentLang].tutorialTryNameButton);
        button.type = "button";
        button.addEventListener("click", async () => {
          const roster = await loadTutorialRoster();
          const query = input.value.trim().toLocaleLowerCase();
          const match = query
            ? roster.find((person) => person.name.toLocaleLowerCase().includes(query))
            : roster.find((person) => String(person.id) === select.value);
          if (!match) {
            showTutorialDemoResult(card, translations[currentLang].tutorialNameNoMatch);
            return;
          }
          select.value = String(match.id);
          await runTutorialAttendanceDemo(select, card, match);
        });
        card.insertBefore(input, select);
        card.appendChild(button);
        container.appendChild(card);
      }

      async function runTutorialAttendanceDemo(select, card, selectedPerson = null) {
        const person = selectedPerson ||
          firstRunTutorialRoster.find((entry) => String(entry.id) === select.value);
        if (!person) {
          showTutorialDemoResult(card, translations[currentLang].tutorialChooseAttendee);
          return;
        }
        const context = await refreshAttendanceContext();
        if (!context) {
          showTutorialDemoResult(card, translations[currentLang].tutorialContextUnavailable);
          return;
        }
        const simulationContext = JSON.parse(JSON.stringify(context));
        const result = predictAttendanceResult(
          person.id,
          { timestamp: new Date().toISOString(), personName: person.name },
          person,
          simulationContext,
        );
        showTutorialDemoResult(
          card,
          result
            ? `${person.name} · ${translateText(result.title)}${result.message ? ` · ${translateText(result.message)}` : ""}`
            : translations[currentLang].tutorialContextUnavailable,
        );
      }

      function renderTutorialAddDemo(container) {
        const card = tutorialDemoCard();
        const input = createTutorialElement("input");
        input.type = "text";
        input.maxLength = 120;
        input.placeholder = translations[currentLang].tutorialFakeNamePlaceholder;
        input.setAttribute("aria-label", translations[currentLang].tutorialFakeNamePlaceholder);
        const button = createTutorialElement("button", "btn secondary", translations[currentLang].tutorialTryAddButton);
        button.type = "button";
        button.addEventListener("click", () => {
          const name = input.value.trim() || translations[currentLang].tutorialSampleName;
          showTutorialDemoResult(
            card,
            `${name} · ${translateText("Servant created successfully!")} · ${translations[currentLang].tutorialNotSaved}`,
          );
        });
        card.append(input, button);
        container.appendChild(card);
      }

      function showTutorialDemoResult(card, message) {
        const previous = card.querySelector(".tutorial-demo-result");
        if (previous) previous.remove();
        const result = createTutorialElement("p", "tutorial-demo-result", message);
        result.setAttribute("role", "status");
        card.appendChild(result);
      }

      function nextTutorialStep() {
        if (firstRunTutorialStep >= firstRunTutorialSteps.length - 1) {
          finishFirstRunTutorial();
          return;
        }
        firstRunTutorialStep++;
        renderFirstRunTutorialStep();
      }

      function previousTutorialStep() {
        if (firstRunTutorialStep <= 0) return;
        firstRunTutorialStep--;
        renderFirstRunTutorialStep();
      }

      function skipFirstRunTutorial() {
        finishFirstRunTutorial();
      }

      function finishFirstRunTutorial() {
        if (currentUser) localStorage.setItem(tutorialStorageKey(), "true");
        const dialog = document.getElementById("firstRunTutorial");
        if (dialog.open) dialog.close();
      }

      function logoutUser(msg) {
        localStorage.removeItem("app_user");
        localStorage.removeItem(OFFLINE_SESSION_KEY);
        localStorage.removeItem("google_id_token");
        sessionStorage.removeItem("google_id_token");
        pendingSessionRestoreEmail = "";
        googleIdToken = "";
        currentUser = null;
        currentAttendanceContext = null;
        verifiedPassword = "";
        stopLiveScanner();
        if (msg) showLoginError(msg);
        showView("loginView", false);
        dismissStartupScreen();
      }

      function showLoginError(msg) {
        var errDiv = document.getElementById("loginError");
        errDiv.dataset.message = msg;
        errDiv.innerText = translateText(msg);
        errDiv.style.display = "block";
        showView("loginView", false);
        dismissStartupScreen();
      }

      function checkDirectUrlScan() {
        var urlParams = new URLSearchParams(window.location.search);
        var scannedId = urlParams.get("id");
        if (scannedId) processScannedText(scannedId);
      }

      function openSheet() {
        window.open(GOOGLE_SHEET_URL, "_blank");
      }
      function showLoader(text) {
        currentLoaderText = text || translations[currentLang].loadingData;
        document.getElementById("loaderText").innerText = translateText(
          currentLoaderText,
        );
        document.getElementById("mainContainer").classList.add("is-loading");
        document.getElementById("loader").style.display = "flex";
      }
      function hideLoader() {
        document.getElementById("loader").style.display = "none";
        document.getElementById("mainContainer").classList.remove("is-loading");
        currentLoaderText = "";
      }

      function parseJwt(token) {
        try {
          var base64Url = token.split(".")[1];
          var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
          var jsonPayload = decodeURIComponent(
            atob(base64)
              .split("")
              .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
              .join(""),
          );
          return JSON.parse(jsonPayload);
        } catch (e) {
          return null;
        }
      }

      function renderResult(r, fromNameSearch = false) {
        r = r || {};
        const searchAgainButton = document.getElementById("searchAnotherFromResult");
        if (searchAgainButton) searchAgainButton.hidden = !fromNameSearch;
        var COLORS = {
          success: "#16a34a",
          late: "#d97706",
          out: "#2563eb",
          warn: "#d97706",
          error: "#ef4444",
          closed: "#d97706",
          queued: "#0284c7",
        };
        var color = COLORS[r.kind] || "#d97706";
        const iconClass = r.kind === "success"
          ? "fa-check"
          : r.kind === "late" || r.kind === "closed"
            ? "fa-clock"
            : r.kind === "out"
              ? "fa-right-from-bracket"
              : r.kind === "warn"
                ? "fa-triangle-exclamation"
          : r.kind === "queued"
            ? "fa-triangle-exclamation"
            : "fa-circle-info";
        document.getElementById("rIcon").innerHTML =
          `<i class="fa-solid ${iconClass}"></i>`;
        document.getElementById("rIcon").style.color = color;
        const titleText = r.title || (r.code ? "Request failed" : "");
        const titleEl = document.getElementById("rTitle");
        titleEl.dataset.message = titleText;
        titleEl.innerText = translateText(titleText);
        var nameEl = document.getElementById("rName");
        nameEl.innerText = r.name || "";
        nameEl.style.display = r.name ? "block" : "none";
        var msgEl = document.getElementById("rMsg");
        msgEl.dataset.message = r.message || "";
        msgEl.innerText = translateText(r.message || "");
        msgEl.style.display = r.message ? "block" : "none";
        showView("resultView");
      }
