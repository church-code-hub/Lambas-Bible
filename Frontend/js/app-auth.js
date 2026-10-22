      window.addEventListener("DOMContentLoaded", async function () {
        setLanguage(currentLang);
        applyTheme(currentThemeMode);
        setDashboardLayout(localStorage.getItem("app_dashboard_layout") || "grouped");
        const hasSavedUser = Boolean(localStorage.getItem("app_user"));
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
        const signInReady = navigator.onLine
          ? initializeGoogleSignIn(!hasSavedUser || !googleIdToken)
          : false;
        await updateOfflineStatus();

        const savedUser = localStorage.getItem("app_user");
        if (savedUser) {
          try {
            currentUser = JSON.parse(savedUser);
            if (!currentUser || !currentUser.email) throw new Error("Saved user is invalid.");
            const rememberedEmail = (localStorage.getItem(OFFLINE_SESSION_KEY) || "").toLowerCase().trim();
            if (!navigator.onLine && rememberedEmail === currentUser.email.toLowerCase().trim()) {
              setupUserProfileUI();
              checkDirectUrlScan();
              await updateOfflineStatus();
              return;
            }
            if (!navigator.onLine) {
              currentUser = null;
              showView("loginView", false);
              dismissStartupScreen();
              await updateOfflineStatus();
              return;
            }
            if (!googleIdToken) {
              if (signInReady) beginSessionRestore(currentUser.email);
              else {
                currentUser = null;
                showView("loginView", false);
                dismissStartupScreen();
              }
              return;
            }
            showLoader("Checking your saved sign-in...");
            const authRes = await apiCall("check_auth", {
              email: currentUser.email,
            });
            hideLoader();
            if (
              authRes &&
              authRes.authorized &&
              String(authRes.email || "").toLowerCase().trim() === currentUser.email.toLowerCase().trim()
            ) {
              if (authRes.adminName) currentUser.name = authRes.adminName;
              currentUser.isOwner = authRes.isOwner === true;
              localStorage.setItem(OFFLINE_SESSION_KEY, currentUser.email.toLowerCase().trim());
              localStorage.setItem("app_user", JSON.stringify(currentUser));
              setupUserProfileUI();
              checkDirectUrlScan();
              await refreshRosterCache();
            } else if (authRes && authRes.code === "AUTH_INVALID" && signInReady) {
              googleIdToken = "";
              localStorage.removeItem("google_id_token");
              sessionStorage.removeItem("google_id_token");
              beginSessionRestore(currentUser.email);
            } else if (authRes && authRes.authorized) {
              logoutUser("Please sign in again.");
            } else if (authRes && authRes.success && !authRes.authorized) {
              logoutUser("❌ Unauthorized account.");
            } else {
              currentUser = null;
              showLoginError("Sign-in check failed on the server. Verify the latest Apps Script deployment.");
              dismissStartupScreen();
            }
          } catch (e) {
            hideLoader();
            currentUser = null;
            showLoginError("Connection error.");
            dismissStartupScreen();
          }
        } else {
          showView("loginView", false);
        }
      });

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
          currentUser = null;
          hideLoader();
          showView("loginView", false);
          dismissStartupScreen();
          return;
        }
        pendingSessionRestoreEmail = String(email || "").toLowerCase().trim();
        showLoader("Restoring your saved sign-in...");
        google.accounts.id.prompt((notification) => {
          const unavailable =
            (notification.isNotDisplayed && notification.isNotDisplayed()) ||
            (notification.isSkippedMoment && notification.isSkippedMoment()) ||
            (notification.isDismissedMoment && notification.isDismissedMoment());
          if (unavailable && pendingSessionRestoreEmail) {
            pendingSessionRestoreEmail = "";
            currentUser = null;
            hideLoader();
            showView("loginView", false);
            dismissStartupScreen();
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
        pendingSessionRestoreEmail = "";
        if (expectedEmail && payload.email.toLowerCase().trim() !== expectedEmail) {
          currentUser = null;
          showView("loginView", false);
          dismissStartupScreen();
          return;
        }

        googleIdToken = response.credential;
        showLoader("Verifying your Google account...");
        try {
          const authRes = await apiCall("check_auth", { email: payload.email });
          hideLoader();
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
            await refreshRosterCache();
          } else if (authRes && authRes.code === "AUTH_INVALID") {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            showLoginError("Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.");
          } else if (authRes && authRes.code === "AUTH_REQUIRED") {
            googleIdToken = "";
            localStorage.removeItem("google_id_token");
            sessionStorage.removeItem("google_id_token");
            showLoginError("Please sign in again.");
          } else if (authRes && authRes.authorized) {
            logoutUser("Please sign in again.");
          } else if (authRes && authRes.success === false) {
            showLoginError("Sign-in check failed on the server. Verify the latest Apps Script deployment.");
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
          hideLoader();
          currentUser = null;
          showLoginError("Connection error.");
        }
      }

      function setupUserProfileUI() {
        if (!currentUser) return;
        document.getElementById("uName").innerText = currentUser.name;
        document.getElementById("uEmail").innerText = currentUser.email;
        document.getElementById("uAvatar").src = currentUser.picture;
        showView("dashboardView");
        dismissStartupScreen();
      }

      function logoutUser(msg) {
        localStorage.removeItem("app_user");
        localStorage.removeItem(OFFLINE_SESSION_KEY);
        localStorage.removeItem("google_id_token");
        sessionStorage.removeItem("google_id_token");
        pendingSessionRestoreEmail = "";
        googleIdToken = "";
        currentUser = null;
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
