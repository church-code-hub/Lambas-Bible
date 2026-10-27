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
            refreshUserDataAfterTutorial();
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
            refreshUserDataAfterTutorial();
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
        { title: "tutorialScanTitle", description: "tutorialScanDescription", target: "tutorialScanAction" },
        { title: "tutorialHomeTitle", description: "tutorialHomeDescription", target: "homeBtn" },
        { title: "tutorialNameTitle", description: "tutorialNameDescription", target: "tutorialSearchAction" },
        { title: "tutorialHomeTitle", description: "tutorialHomeDescription", target: "homeBtn" },
        { title: "tutorialAddTitle", description: "tutorialAddDescription", target: "tutorialAddAction" },
        { title: "tutorialHomeTitle", description: "tutorialHomeDescription", target: "homeBtn" },
        { title: "tutorialSettingsTitle", description: "tutorialSettingsDescription", target: "appSettingsToolbarButton" },
      ];
      const FIRST_RUN_TUTORIAL_KEY = "lambas_bible_tutorial_completed";
      var firstRunTutorialStep = 0;
      var tutorialDeferredLoginRefreshEmail = "";
      var tutorialPending = false;
      var tutorialClickHandlerBound = false;
      var tutorialAdvanceTimer = 0;
      var tutorialPositionFrame = 0;
      var tutorialHighlightedTarget = null;

      function isFirstRunTutorialActive() {
        return tutorialPending ||
          Boolean(document.getElementById("firstRunTutorial")?.classList.contains("is-active"));
      }

      function hasSeenFirstRunTutorial() {
        try {
          return localStorage.getItem(FIRST_RUN_TUTORIAL_KEY) === "true";
        } catch (error) {
          console.warn("Could not read first-run tutorial status.", error);
          return false;
        }
      }

      function markFirstRunTutorialSeen() {
        try {
          localStorage.setItem(FIRST_RUN_TUTORIAL_KEY, "true");
        } catch (error) {
          console.warn("Could not save first-run tutorial completion.", error);
        }
      }

      function bindFirstRunTutorialHandlers() {
        if (tutorialClickHandlerBound) return;
        tutorialClickHandlerBound = true;
        document.addEventListener("click", handleFirstRunTutorialClick, true);
        document.addEventListener("keydown", handleFirstRunTutorialKeydown, true);
        window.addEventListener("resize", positionFirstRunTutorial);
        window.addEventListener("scroll", positionFirstRunTutorial, true);
      }

      function startFirstRunTutorial() {
        if (
          !currentUser ||
          new URLSearchParams(window.location.search).has("id") ||
          hasSeenFirstRunTutorial()
        ) return;
        if (isFirstRunTutorialActive()) return;
        tutorialPending = true;
        pauseDashboardRefreshForTutorial();
        bindFirstRunTutorialHandlers();
        firstRunTutorialStep = 0;
        window.setTimeout(() => {
          if (currentUser) showFirstRunTutorial();
          else tutorialPending = false;
        }, 350);
      }

      function pauseDashboardRefreshForTutorial() {
        if (currentAttendeesWindowTimer) {
          window.clearTimeout(currentAttendeesWindowTimer);
          currentAttendeesWindowTimer = 0;
        }
      }

      function refreshUserDataAfterTutorial() {
        if (isFirstRunTutorialActive()) {
          tutorialDeferredLoginRefreshEmail = String(currentUser?.email || "").toLowerCase().trim();
          return;
        }
        refreshRosterCache();
        refreshAttendanceContext();
      }

      function showFirstRunTutorial() {
        const panel = document.getElementById("firstRunTutorial");
        if (!panel) {
          tutorialPending = false;
          return;
        }
        tutorialPending = false;
        markFirstRunTutorialSeen();
        panel.hidden = false;
        panel.classList.add("is-active");
        renderFirstRunTutorialStep();
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
        tutorialHighlightedTarget?.classList.remove("tutorial-target-highlight");
        tutorialHighlightedTarget = document.getElementById(step.target);
        tutorialHighlightedTarget?.classList.add("tutorial-target-highlight");
        positionFirstRunTutorial();
        const target = document.getElementById(step.target);
        window.setTimeout(() => target?.focus({ preventScroll: true }), 0);
      }

      function positionFirstRunTutorial() {
        if (!isFirstRunTutorialActive()) return;
        if (tutorialPositionFrame) window.cancelAnimationFrame(tutorialPositionFrame);
        tutorialPositionFrame = window.requestAnimationFrame(() => {
          tutorialPositionFrame = 0;
          const target = document.getElementById(firstRunTutorialSteps[firstRunTutorialStep]?.target);
          const panel = document.getElementById("firstRunTutorial");
          if (!target) return;
          const rect = target.getBoundingClientRect();
          if (panel) {
            const panelHeight = panel.getBoundingClientRect().height;
            const gap = 16;
            const roomBelow = window.innerHeight - rect.bottom;
            const roomAbove = rect.top;
            if (roomBelow >= panelHeight + gap || roomBelow >= roomAbove) {
              panel.style.top = `${Math.min(window.innerHeight - panelHeight - 8, rect.bottom + gap)}px`;
              panel.style.bottom = "auto";
            } else {
              panel.style.top = "auto";
              panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + gap)}px`;
            }
          }
        });
      }

      function handleFirstRunTutorialClick(event) {
        if (!isFirstRunTutorialActive()) return;
        const panel = document.getElementById("firstRunTutorial");
        if (panel.contains(event.target)) return;
        if (tutorialAdvanceTimer) return;
        const step = firstRunTutorialSteps[firstRunTutorialStep];
        const target = document.getElementById(step?.target);
        if (!target || (event.target !== target && !target.contains(event.target))) {
          return;
        }
        tutorialAdvanceTimer = window.setTimeout(() => {
          tutorialAdvanceTimer = 0;
          if (!isFirstRunTutorialActive()) return;
          if (firstRunTutorialStep >= firstRunTutorialSteps.length - 1) {
            finishFirstRunTutorial();
            return;
          }
          firstRunTutorialStep++;
          renderFirstRunTutorialStep();
        }, 250);
      }

      function handleFirstRunTutorialKeydown(event) {
        if (!isFirstRunTutorialActive()) return;
        if (event.key === "Escape") {
          event.preventDefault();
          finishFirstRunTutorial();
        }
      }

      function skipFirstRunTutorial() {
        finishFirstRunTutorial();
      }

      function finishFirstRunTutorial() {
        tutorialPending = false;
        markFirstRunTutorialSeen();
        const panel = document.getElementById("firstRunTutorial");
        panel?.classList.remove("is-active");
        if (panel) panel.hidden = true;
        tutorialHighlightedTarget?.classList.remove("tutorial-target-highlight");
        tutorialHighlightedTarget = null;
        if (tutorialAdvanceTimer) window.clearTimeout(tutorialAdvanceTimer);
        tutorialAdvanceTimer = 0;
        if (
          currentUser &&
          tutorialDeferredLoginRefreshEmail === String(currentUser.email || "").toLowerCase().trim()
        ) {
          tutorialDeferredLoginRefreshEmail = "";
          refreshRosterCache();
          refreshAttendanceContext();
        }
        if (currentActiveViewId === "dashboardView") refreshCurrentAttendeesWindow();
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
