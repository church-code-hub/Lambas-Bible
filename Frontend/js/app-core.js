      function runAppearanceTransition(update) {
        if (
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          update();
          return;
        }
        window.clearTimeout(appearanceTransitionTimeout);
        document.body.classList.remove("appearance-transitioning");
        document.body.offsetWidth;
        document.body.classList.add("appearance-transitioning");
        document.body.offsetWidth;
        update();
        appearanceTransitionTimeout = window.setTimeout(() => {
          document.body.classList.remove("appearance-transitioning");
        }, 420);
      }

      function setLanguage(lang) {
        lang = translations[lang] ? lang : "ar";
        const changeLanguage = () => {
          currentLang = lang;
          localStorage.setItem("app_lang", lang);
          const root = document.getElementById("htmlRoot");
          root.setAttribute("lang", lang);
          root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
          document.getElementById("languageArabicOption")?.setAttribute("aria-pressed", String(lang === "ar"));
          document.getElementById("languageEnglishOption")?.setAttribute("aria-pressed", String(lang === "en"));
          updateOfflineStatus();

          document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            if (
              translations[lang][key] &&
              !el.classList.contains("password-visibility-btn")
            ) el.innerText = translations[lang][key];
          });
          document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
            const key = el.getAttribute("data-i18n-placeholder");
            if (translations[lang][key])
              el.setAttribute("placeholder", translations[lang][key]);
          });
          document.querySelectorAll("[data-i18n-title]").forEach((el) => {
            const key = el.getAttribute("data-i18n-title");
            if (translations[lang][key]) el.setAttribute("title", translations[lang][key]);
          });
          document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
            const key = el.getAttribute("data-i18n-aria-label");
            if (translations[lang][key]) el.setAttribute("aria-label", translations[lang][key]);
          });
          document.querySelectorAll(".password-visibility-btn[data-i18n]").forEach((el) => {
            el.setAttribute("aria-label", translations[lang][el.dataset.i18n]);
            el.setAttribute("title", translations[lang][el.dataset.i18n]);
          });
          document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
            const key = el.getAttribute("data-i18n-alt");
            if (translations[lang][key]) el.setAttribute("alt", translations[lang][key]);
          });
          document.querySelectorAll(".toast[data-message]").forEach((el) => {
            el.textContent = translateText(el.dataset.message);
          });
          const resultTitle = document.getElementById("rTitle");
          const resultMessage = document.getElementById("rMsg");
          if (resultTitle.dataset.message) resultTitle.textContent = translateText(resultTitle.dataset.message);
          if (resultMessage.dataset.message) resultMessage.textContent = translateText(resultMessage.dataset.message);
          document.querySelectorAll(".search-suggestions-heading[data-translation-key]").forEach((el) => {
            const prefix = el.dataset.translationKey === "searchSuggestions" ? "💡 " : "";
            el.textContent = prefix + translateText(el.dataset.translationKey);
          });
          document.querySelectorAll(".card-result-status[data-i18n-key]").forEach((el) => {
            el.textContent = translations[lang][el.dataset.i18nKey];
          });
          document.querySelectorAll(".admin-del-btn[data-i18n-key]").forEach((el) => {
            el.textContent = translateText("Delete");
          });
          document.querySelectorAll(".admin-owner-tag[data-i18n-key]").forEach((el) => {
            el.textContent = translateText("Owner");
          });
          document.querySelectorAll(".search-empty[data-i18n-key]").forEach((el) => {
            el.textContent = "❌ " + translations[lang][el.dataset.i18nKey];
          });
          const addStatus = document.querySelector("#addResult [data-message]");
          if (addStatus) addStatus.textContent = translateText(addStatus.dataset.message);
          const queuedAddStatus = document.querySelector("#addResult .offline-add-queued-result");
          if (queuedAddStatus) {
            queuedAddStatus.textContent = [
              queuedAddStatus.dataset.personName,
              translations[lang].offlineAddQueued,
              queuedAddStatus.dataset.attendIfOpen === "true"
                ? translations[lang].offlineAttendYes
                : translations[lang].offlineAttendNo,
            ].join(" · ");
          }
          const addLink = document.querySelector("#addResult a[data-message]");
          if (addLink) addLink.lastChild.textContent = translateText(addLink.dataset.message);
          if (currentLoaderText && document.getElementById("loader").style.display === "flex") {
            document.getElementById("loaderText").innerText = translateText(currentLoaderText);
          }
          const loginError = document.getElementById("loginError");
          if (loginError.dataset.message) loginError.innerText = translateText(loginError.dataset.message);
          if (currentActiveViewId === "offlineQueueView") renderOfflineQueue();
          if (currentActiveViewId === "attendanceReportView") {
            if (attendanceReportTab === "followups") loadFollowups();
            else loadAttendanceReportDates();
          }
          if (currentActiveViewId === "currentAttendeesView") loadCurrentAttendees();
        };
        if (currentLang === lang) changeLanguage();
        else runAppearanceTransition(changeLanguage);
      }

      function toggleLanguage() {
        setLanguage(currentLang === "ar" ? "en" : "ar");
      }

      function applyTheme(mode) {
        mode = mode === "light" ? "light" : "dark";
        const themeChanged = currentThemeMode !== mode;
        const changeTheme = () => {
          currentThemeMode = mode;
          localStorage.setItem("app_theme", mode);
          const body = document.body;
          body.setAttribute("data-theme", mode);
          body.classList.toggle("theme-light", mode === "light");
          body.classList.toggle("theme-dark", mode === "dark");
          document.documentElement.classList.toggle("theme-light", mode === "light");
          document.documentElement.classList.toggle("theme-dark", mode === "dark");
          document.getElementById("themeLightOption")?.setAttribute("aria-pressed", String(mode === "light"));
          document.getElementById("themeDarkOption")?.setAttribute("aria-pressed", String(mode === "dark"));
        };
        if (!themeChanged) changeTheme();
        else runAppearanceTransition(changeTheme);
      }

      function toggleTheme() {
        if (currentThemeMode === "dark") applyTheme("light");
        else applyTheme("dark");
      }

      async function apiCall(action, payload = {}) {
        if (!API_URL) throw new Error("Application is not configured.");
        const requestBody = {
          ...payload,
          action: action,
          idToken: googleIdToken,
          requestId: "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        };
        const controller = new AbortController();
        const timeoutMs = ["add_student", "sync_offline_events"].includes(action) ? 180000 : 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(API_URL, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const result = await response.json();
          if (result.code === "AUTH_INVALID" && action !== "check_auth") {
            googleIdToken = "";
            sessionStorage.removeItem("google_id_token");
            if (currentUser) beginSessionRestore(currentUser.email);
            else logoutUser(result.message || "❌ Unauthorized account.");
          } else if (result.code === "AUTH_DENIED") {
            logoutUser(result.message || "❌ Unauthorized account.");
          }
          return result;
        } finally {
          clearTimeout(timeoutId);
        }
      }
