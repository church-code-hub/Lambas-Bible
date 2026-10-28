window.addEventListener("DOMContentLoaded", async function () {
  setLanguage(currentLang);
  applyTheme(currentThemeMode);
  setDashboardLayout(localStorage.getItem("app_dashboard_layout") || "two");
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
      String(authRes.email || "")
        .toLowerCase()
        .trim() === expectedEmail
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

function restoreTutorialDisabledTargets() {
  tutorialDisabledTargets.forEach((wasDisabled, target) => {
    target.disabled = wasDisabled;
  });
  tutorialDisabledTargets.clear();
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
  if (
    !navigator.onLine ||
    !window.google ||
    !google.accounts ||
    !google.accounts.id
  ) {
    isSilentSessionRestore = false;
    return;
  }
  pendingSessionRestoreEmail = String(email || "")
    .toLowerCase()
    .trim();
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
      String(authRes.email || "")
        .toLowerCase()
        .trim() === payload.email.toLowerCase().trim()
    ) {
      currentUser = {
        email: payload.email.toLowerCase().trim(),
        name: authRes.adminName || payload.name || payload.email,
        picture:
          payload.picture || "https://lh3.googleusercontent.com/a/default-user",
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
        showToast(
          "Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.",
          "error",
        );
      } else {
        showLoginError(
          "Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.",
        );
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
        showToast(
          "Sign-in check failed on the server. Verify the latest Apps Script deployment.",
          "error",
        );
      } else {
        showLoginError(
          "Sign-in check failed on the server. Verify the latest Apps Script deployment.",
        );
      }
    } else {
      googleIdToken = "";
      localStorage.removeItem("google_id_token");
      sessionStorage.removeItem("google_id_token");
      const checkedEmail =
        authRes && authRes.email ? authRes.email : payload.email;
      showLoginError(
        "❌ Sorry, email is not authorized.\n" +
          translateText("Email not listed in Admins: ") +
          checkedEmail,
      );
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
  const welcomeName = document.getElementById("dashboardWelcomeName");
  if (welcomeName) welcomeName.textContent = currentUser.name;
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
  showView("dashboardView");
  startFirstRunTutorial();
  dismissStartupScreen();
}

const firstRunTutorialSteps = [
  {
    title: "tutorialScanTitle",
    description: "tutorialScanDescription",
    target: "tutorialScanAction",
    view: "dashboardView",
    previewView: "scanView",
    demoTarget: "tutorialScanDemoButton",
  },
  {
    title: "tutorialNameTitle",
    description: "tutorialNameDescription",
    target: "tutorialSearchAction",
    view: "dashboardView",
    previewView: "searchView",
    demoTarget: "tutorialSearchDemoButton",
  },
  {
    title: "tutorialAddTitle",
    description: "tutorialAddDescription",
    target: "tutorialAddAction",
    view: "dashboardView",
    previewView: "addView",
    demoTarget: "tutorialAddDemoButton",
  },
  {
    title: "manageRoster",
    description: "tutorialPreviewDescription",
    target: "tutorialRosterAction",
    view: "dashboardView",
    previewView: "rosterView",
  },
  {
    title: "shareCard",
    description: "tutorialPreviewDescription",
    target: "tutorialShareAction",
    view: "dashboardView",
    previewView: "cardShareView",
  },
  {
    title: "attendanceReports",
    description: "tutorialPreviewDescription",
    target: "tutorialReportsAction",
    view: "dashboardView",
    previewView: "attendanceReportView",
    previewTab: "attendance",
  },
  {
    title: "attendanceTab",
    description: "tutorialPreviewDescription",
    target: "attendanceTabButton",
    view: "attendanceReportView",
    previewTab: "attendance",
  },
  {
    title: "attendanceTrendsTitle",
    description: "tutorialPreviewDescription",
    target: "trendsTabButton",
    view: "attendanceReportView",
    previewTab: "trends",
  },
  {
    title: "followupsTitle",
    description: "tutorialPreviewDescription",
    target: "tutorialFollowupAction",
    view: "dashboardView",
    previewView: "followupView",
  },
  {
    title: "openSheet",
    description: "tutorialPreviewDescription",
    target: "tutorialSheetAction",
    view: "dashboardView",
  },
  {
    title: "currentAttendeesTitle",
    description: "tutorialPreviewDescription",
    target: "currentAttendeesTile",
    view: "dashboardView",
    previewView: "currentAttendeesView",
  },
  {
    title: "meetingSchedule",
    description: "tutorialPreviewDescription",
    target: "tutorialScheduleAction",
    view: "dashboardView",
    previewView: "scheduleSettingsView",
  },
  {
    title: "tutorialSettingsTitle",
    description: "tutorialSettingsDescription",
    target: "appSettingsToolbarButton",
    view: "dashboardView",
    action: "settings",
  },
];
const FIRST_RUN_TUTORIAL_KEY = "lambas_bible_tutorial_completed";
const FIRST_RUN_SETUP_KEY = "lambas_bible_setup_completed";
var firstRunTutorialStep = 0;
var tutorialDeferredLoginRefreshEmail = "";
var tutorialPending = false;
var tutorialClickHandlerBound = false;
var tutorialHighlightedTarget = null;
var tutorialDemoActions = new Set();
var tutorialSavedScrollTop = 0;
var tutorialDisabledTargets = new Map();

function isFirstRunTutorialActive() {
  return (
    tutorialPending ||
    Boolean(
      document
        .getElementById("firstRunTutorial")
        ?.classList.contains("is-active"),
    )
  );
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
  document.addEventListener("wheel", handleFirstRunTutorialScroll, {
    capture: true,
    passive: false,
  });
  document.addEventListener("touchmove", handleFirstRunTutorialScroll, {
    capture: true,
    passive: false,
  });
  window.addEventListener("resize", updateFirstRunTutorialFocus);
  window.addEventListener("scroll", updateFirstRunTutorialFocus, true);
}

function updateFirstRunTutorialFocus() {
  if (!isFirstRunTutorialActive() || !tutorialHighlightedTarget) return;
  const focusWash = document.getElementById("tutorialFocusWash");
  if (!focusWash || focusWash.hidden) return;
  const bounds = tutorialHighlightedTarget.getBoundingClientRect();
  if (
    bounds.bottom <= 0 ||
    bounds.top >= window.innerHeight ||
    bounds.right <= 0 ||
    bounds.left >= window.innerWidth
  ) {
    tutorialHighlightedTarget.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
  }
  const updatedBounds = tutorialHighlightedTarget.getBoundingClientRect();
  const padding = 7;
  const top = Math.max(0, updatedBounds.top - padding);
  const left = Math.max(0, updatedBounds.left - padding);
  const right = Math.min(window.innerWidth, updatedBounds.right + padding);
  const bottom = Math.min(window.innerHeight, updatedBounds.bottom + padding);
  focusWash.style.setProperty("--tutorial-cutout-top", `${top}px`);
  focusWash.style.setProperty("--tutorial-cutout-left", `${left}px`);
  focusWash.style.setProperty("--tutorial-cutout-right", `${right}px`);
  focusWash.style.setProperty("--tutorial-cutout-bottom", `${bottom}px`);
  focusWash.style.setProperty(
    "--tutorial-cutout-height",
    `${Math.max(0, bottom - top)}px`,
  );
}

function startFirstRunTutorial() {
  if (
    !currentUser ||
    new URLSearchParams(window.location.search).has("id")
  )
    return;
  if (localStorage.getItem(FIRST_RUN_SETUP_KEY) !== "true") {
    showFirstRunSetup();
    return;
  }
  beginFirstRunTutorial();
}

function showFirstRunSetup() {
  const dialog = document.getElementById("firstRunSetupDialog");
  if (!dialog || dialog.open || !currentUser) return;
  dialog
    .querySelectorAll("[data-setup-language]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.setupLanguage === currentLang),
      ),
    );
  dialog
    .querySelectorAll("[data-setup-theme]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.setupTheme === currentThemeMode),
      ),
    );
  if (!dialog.open) dialog.showModal();
}

function finishFirstRunSetup(continueToTutorial) {
  if (!currentUser) return;
  try {
    localStorage.setItem(FIRST_RUN_SETUP_KEY, "true");
  } catch (error) {
    console.warn("Could not save first-run setup status.", error);
  }
  const dialog = document.getElementById("firstRunSetupDialog");
  if (dialog?.open) dialog.close();
  if (continueToTutorial) {
    beginFirstRunTutorial();
  } else {
    markFirstRunTutorialSeen();
  }
}

function beginFirstRunTutorial() {
  if (hasSeenFirstRunTutorial()) return;
  if (isFirstRunTutorialActive()) return;
  tutorialPending = true;
  pauseDashboardRefreshForTutorial();
  bindFirstRunTutorialHandlers();
  firstRunTutorialStep = 0;
  tutorialDemoActions = new Set();
  window.setTimeout(() => {
    if (currentUser) showFirstRunTutorial();
    else tutorialPending = false;
  }, 350);
}

function replayFirstRunTutorial() {
  if (!currentUser) return;
  bindFirstRunTutorialHandlers();
  pauseDashboardRefreshForTutorial();
  firstRunTutorialStep = 0;
  tutorialDemoActions = new Set();
  tutorialPending = true;
  showView("dashboardView", false);
  showFirstRunTutorial();
}

function pauseDashboardRefreshForTutorial() {
  if (currentAttendeesWindowTimer) {
    window.clearTimeout(currentAttendeesWindowTimer);
    currentAttendeesWindowTimer = 0;
  }
}

function refreshUserDataAfterTutorial() {
  if (isFirstRunTutorialActive()) {
    tutorialDeferredLoginRefreshEmail = String(currentUser?.email || "")
      .toLowerCase()
      .trim();
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
  document.getElementById("tutorialFocusWash").hidden = false;
  panel.classList.add("is-active");
  document.body.classList.add("tutorial-active");
  const mainContainer = document.getElementById("mainContainer");
  tutorialSavedScrollTop = mainContainer.scrollTop;
  mainContainer.scrollTop = 0;
  renderFirstRunTutorialStep();
}

function renderFirstRunTutorialStep() {
  const step = firstRunTutorialSteps[firstRunTutorialStep];
  if (!step) return;
  if (step.view && currentActiveViewId !== step.view) {
    showView(step.view, false);
  }
  [
    "tutorialScanDemoButton",
    "tutorialSearchDemoButton",
    "tutorialAddDemoButton",
  ].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.hidden = true;
  });
  if (step.target === "appSettingsToolbarButton") {
    const menu = document.getElementById("toolbarMenu");
    const toggle = document.getElementById("toolbarMenuButton");
    if (menu && toggle && menu.hidden) toggleToolbarMenu();
  }
  const translationsForLanguage = translations[currentLang];
  document.getElementById("tutorialTitle").textContent =
    translationsForLanguage[step.title];
  document.getElementById("tutorialDescription").textContent =
    translationsForLanguage[step.description];
  document.getElementById("tutorialStepCount").textContent =
    translationsForLanguage.tutorialStepCount
      .replace("{step}", String(firstRunTutorialStep + 1))
      .replace("{total}", String(firstRunTutorialSteps.length));
  document.getElementById("tutorialProgressBar").style.width =
    `${((firstRunTutorialStep + 1) / firstRunTutorialSteps.length) * 100}%`;
  const nextLabel = document.getElementById("tutorialNextLabel");
  if (nextLabel) {
    const labelKey =
      firstRunTutorialStep === firstRunTutorialSteps.length - 1
        ? "tutorialFinish"
        : "tutorialNext";
    nextLabel.dataset.i18n = labelKey;
    nextLabel.textContent = translationsForLanguage[labelKey];
  }
  tutorialHighlightedTarget?.classList.remove("tutorial-target-highlight");
  restoreTutorialDisabledTargets();
  tutorialHighlightedTarget = null;
  setFirstRunTutorialActionTarget(step.target);
  const target = tutorialHighlightedTarget;
  window.setTimeout(() => target?.focus({ preventScroll: true }), 0);
}

function renderFirstRunTutorialPreview(step) {
  const sampleName = translations[currentLang].tutorialSampleName;
  const message = translations[currentLang].tutorialPreview;
  const view = document.getElementById(step.previewView);
  if (!view) {
    showToast(message, "info");
    return;
  }
  if (step.previewTab) selectAttendanceReportTab(step.previewTab);
  const resultId = {
    searchView: "searchResults",
    rosterView: "rosterManagementResults",
    cardShareView: "shareResults",
    attendanceReportView:
      step.previewTab === "trends"
        ? "attendanceTrendsResults"
        : "attendanceReportResults",
    followupView: "followupResults",
    currentAttendeesView: "currentAttendeesResults",
  }[step.previewView];
  if (step.previewView === "searchView") {
    const input = document.getElementById("searchNameInput");
    input.value = sampleName;
  } else if (step.previewView === "rosterView") {
    document.getElementById("rosterSearchInput").value = sampleName;
  } else if (step.previewView === "cardShareView") {
    document.getElementById("shareNameInput").value = sampleName;
  } else if (step.previewView === "followupView") {
    document.getElementById("followupPersonQuery").value = sampleName;
    followupReportPeople = [{
      id: "tutorial-preview",
      name: sampleName,
      missedMeetings: 3,
      lastAttended: "",
    }];
  } else if (step.previewView === "currentAttendeesView") {
    currentAttendeesData = [{
      id: "tutorial-preview",
      name: sampleName,
      checkedInBy: translations[currentLang].tutorialPreviewAdmin,
      checkinTime: new Date().toISOString(),
    }];
  }
  const results = resultId && document.getElementById(resultId);
  if (results) {
    const preview = document.createElement("p");
    preview.className = "tutorial-preview report-note";
    preview.textContent = `${sampleName} · ${message}`;
    results.replaceChildren(preview);
  } else {
    const preview = document.createElement("p");
    preview.className = "tutorial-preview report-note";
    preview.textContent = `${sampleName} · ${message}`;
    view.appendChild(preview);
  }
}

function showTutorialSearchPreview(inputId, resultsId) {
  const sampleName = translations[currentLang].tutorialSampleName;
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (input) input.value = sampleName;
  if (!results) return;
  const preview = document.createElement("p");
  preview.className = "tutorial-preview report-note";
  preview.textContent = `${sampleName} · ${translations[currentLang].tutorialPreview}`;
  results.replaceChildren(preview);
}

function setFirstRunTutorialActionTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target || !isFirstRunTutorialActive()) return;
  tutorialHighlightedTarget?.classList.remove("tutorial-target-highlight");
  tutorialHighlightedTarget = target;
  if ("disabled" in target && target.disabled) {
    if (!tutorialDisabledTargets.has(target)) {
      tutorialDisabledTargets.set(target, true);
    }
    target.disabled = false;
  }
  if ("hidden" in target) target.hidden = false;
  target.classList.add("tutorial-target-highlight");
  updateFirstRunTutorialFocus();
  window.setTimeout(() => target.focus({ preventScroll: true }), 0);
}

function handleFirstRunTutorialClick(event) {
  if (!isFirstRunTutorialActive()) return;
  const panel = document.getElementById("firstRunTutorial");
  if (
    panel.contains(event.target) &&
    event.target.closest?.("#tutorialNextButton, #tutorialSkipButton")
  )
    return;
  const target =
    tutorialHighlightedTarget ||
    document.getElementById(
      firstRunTutorialSteps[firstRunTutorialStep]?.target,
    );
  if (target && (event.target === target || target.contains(event.target))) {
    const step = firstRunTutorialSteps[firstRunTutorialStep];
    if (step && target.id === step.target && step.previewView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showView(step.previewView, false);
      renderFirstRunTutorialPreview(step);
      setFirstRunTutorialActionTarget(
        step.demoTarget || "tutorialNextButton",
      );
      return;
    }
    if (step && target.id === step.target && !step.previewView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showToast(translations[currentLang].tutorialPreview, "info");
      setFirstRunTutorialActionTarget("tutorialNextButton");
      return;
    }
    const nextActionTarget = {
      tutorialScanAction: ["scanView", "tutorialScanDemoButton"],
      tutorialSearchAction: ["searchView", "tutorialSearchDemoButton"],
      tutorialAddAction: ["addView", "tutorialAddDemoButton"],
    }[target.id];
    if (nextActionTarget) {
      window.setTimeout(() => {
        if (currentActiveViewId === nextActionTarget[0]) {
          setFirstRunTutorialActionTarget(nextActionTarget[1]);
        }
      }, 0);
    } else if (target.id === "homeBtn") {
      window.setTimeout(nextFirstRunTutorialStep, 0);
    } else if (target.id === "appSettingsToolbarButton") {
      window.setTimeout(finishFirstRunTutorial, 0);
    }
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleFirstRunTutorialKeydown(event) {
  if (!isFirstRunTutorialActive()) return;
  const panel = document.getElementById("firstRunTutorial");
  const nextButton = document.getElementById("tutorialNextButton");
  const skipButton = document.getElementById("tutorialSkipButton");
  const target =
    tutorialHighlightedTarget ||
    document.getElementById(
      firstRunTutorialSteps[firstRunTutorialStep]?.target,
    );
  if (event.key === "Tab") {
    const focusTargets = [...new Set([target, nextButton, skipButton])].filter(
      (element) =>
        element && !element.hidden && element.getClientRects().length > 0,
    );
    const currentIndex = focusTargets.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusTargets.length - 1
        : currentIndex - 1
      : (currentIndex + 1) % focusTargets.length;
    event.preventDefault();
    focusTargets[nextIndex]?.focus({ preventScroll: true });
    return;
  }
  if (
    ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]
      .includes(event.key) &&
    !panel.contains(event.target) &&
    (!target || (event.target !== target && !target.contains(event.target)))
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (
    event.key === "Escape" ||
    (!panel.contains(event.target) &&
      (!target || (event.target !== target && !target.contains(event.target))))
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function handleFirstRunTutorialScroll(event) {
  if (!isFirstRunTutorialActive()) return;
  const panel = document.getElementById("firstRunTutorial");
  if (!panel?.contains(event.target)) event.preventDefault();
}

function nextFirstRunTutorialStep() {
  if (!isFirstRunTutorialActive()) return;
  if (firstRunTutorialStep >= firstRunTutorialSteps.length - 1) {
    finishFirstRunTutorial();
    return;
  }
  firstRunTutorialStep++;
  renderFirstRunTutorialStep();
}

function skipFirstRunTutorial() {
  if (!isFirstRunTutorialActive()) return;
  finishFirstRunTutorial();
}

function finishFirstRunTutorial() {
  tutorialPending = false;
  markFirstRunTutorialSeen();
  const panel = document.getElementById("firstRunTutorial");
  panel?.classList.remove("is-active");
  document.body.classList.remove("tutorial-active");
  const mainContainer = document.getElementById("mainContainer");
  mainContainer.scrollTop = tutorialSavedScrollTop;
  if (panel) panel.hidden = true;
  const focusWash = document.getElementById("tutorialFocusWash");
  if (focusWash) focusWash.hidden = true;
  focusWash?.style.removeProperty("--tutorial-cutout-top");
  focusWash?.style.removeProperty("--tutorial-cutout-left");
  focusWash?.style.removeProperty("--tutorial-cutout-right");
  focusWash?.style.removeProperty("--tutorial-cutout-bottom");
  focusWash?.style.removeProperty("--tutorial-cutout-height");
  tutorialHighlightedTarget?.classList.remove("tutorial-target-highlight");
  restoreTutorialDisabledTargets();
  tutorialHighlightedTarget = null;
  if (
    currentUser &&
    tutorialDeferredLoginRefreshEmail ===
      String(currentUser.email || "")
        .toLowerCase()
        .trim()
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
  const loader = document.getElementById("loader");
  if (loader.parentElement !== document.body) document.body.appendChild(loader);
  document.getElementById("loaderText").innerText =
    translateText(currentLoaderText);
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
  const iconClass =
    r.kind === "success"
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
