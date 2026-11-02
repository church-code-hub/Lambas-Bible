function showToast(message, type = "error", duration = 5000) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.dataset.message = message;
  toast.innerText = translateText(message);
  toast.style.setProperty(
    "--toast-out-delay",
    `${Math.max(0, duration - 250)}ms`,
  );
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, duration);
  return toast;
}

async function runButtonAction(button, action) {
  if (!button || button.disabled) return;
  const label = button.querySelector(".current-attendees-action-label") ||
    button.querySelector("span") || button;
  const originalText = label.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  label.textContent = translations[currentLang].loadingAction;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    label.textContent = originalText;
  }
}

function toggleToolbarMenu() {
  const toggle = document.getElementById("toolbarMenuButton");
  const menu = document.getElementById("toolbarMenu");
  if (!toggle || !menu) return;
  const isExpanded = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!isExpanded));
  menu.hidden = isExpanded;
}

function closeToolbarMenu(returnFocus = false) {
  const toggle = document.getElementById("toolbarMenuButton");
  const menu = document.getElementById("toolbarMenu");
  if (!toggle || !menu || menu.hidden) return;
  toggle.setAttribute("aria-expanded", "false");
  menu.hidden = true;
  if (returnFocus) toggle.focus();
}

if (
  typeof document !== "undefined" &&
  typeof document.addEventListener === "function"
) {
  document.addEventListener("click", (event) => {
    const menuWrap = document.querySelector(".toolbar-menu-wrap");
    if (menuWrap && !menuWrap.contains(event.target)) closeToolbarMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeToolbarMenu(true);
  });
}

function handleHomeNavigation() {
  const viewId = currentActiveViewId;
  if (
    (viewId === "adminSettingsView" || viewId === "scheduleSettingsView") &&
    hasUnsavedSettingsChanges(viewId)
  ) {
    const dialog = document.getElementById("settingsExitDialog");
    if (!dialog.open) dialog.showModal();
    return;
  }
  showView("dashboardView");
}

function discardSettingsAndGoHome() {
  const dialog = document.getElementById("settingsExitDialog");
  if (dialog.open) dialog.close();
  discardSettingsChanges(currentActiveViewId);
  showView("dashboardView");
}

function continueSettingsEditing() {
  const dialog = document.getElementById("settingsExitDialog");
  if (dialog.open) dialog.close();
}

function showSearchLoader(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "search-loading";
  wrapper.setAttribute("role", "status");
  wrapper.setAttribute("aria-live", "polite");
  const bars = document.createElement("div");
  bars.className = "loader-bars";
  bars.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 5; index++) {
    bars.appendChild(document.createElement("span"));
  }
  const label = document.createElement("div");
  label.className = "search-loading-label";
  label.setAttribute("data-i18n", "searching");
  label.textContent = translations[currentLang].searching;
  wrapper.append(bars, label);
  container.replaceChildren(wrapper);
}

function showReportSkeleton(
  container,
  rows = 3,
  label = translations[currentLang].loadingReport,
) {
  const skeleton = document.createElement("div");
  skeleton.className = "report-loading";
  skeleton.setAttribute("role", "status");
  skeleton.setAttribute("aria-label", label);
  for (let index = 0; index < rows; index++) {
    const row = document.createElement("div");
    row.className = "report-skeleton-row";
    row.innerHTML = "<span></span><span></span>";
    skeleton.appendChild(row);
  }
  container.replaceChildren(skeleton);
}

function showView(viewId, pushHistory = true) {
  hideLoader();
  const viewChanged = currentActiveViewId !== viewId;
  closeToolbarMenu();
  document
    .getElementById("mainContainer")
    .classList.toggle("is-dashboard-view", viewId === "dashboardView");
  if (currentActiveViewId && currentActiveViewId !== viewId)
    resetView(currentActiveViewId);
  if (viewId !== "currentAttendeesView" && currentAttendeesRefreshTimer) {
    window.clearInterval(currentAttendeesRefreshTimer);
    currentAttendeesRefreshTimer = 0;
  }
  if (viewId !== "dashboardView" && currentAttendeesWindowTimer) {
    window.clearTimeout(currentAttendeesWindowTimer);
    currentAttendeesWindowTimer = 0;
  }

  if (viewId !== "adminSettingsView") {
    const lockEl = document.getElementById("adminSettingsLock");
    const formEl = document.getElementById("adminSettingsForm");
    if (lockEl) lockEl.style.display = "block";
    if (formEl) formEl.style.display = "none";
    const pw = document.getElementById("adminGatePassword");
    if (pw) pw.value = "";
    resetPasswordVisibility("adminGatePassword");
    resetPasswordVisibility("cfgNewPassword");
  }
  if (viewId !== "scheduleSettingsView") {
    const lockEl = document.getElementById("scheduleSettingsLock");
    const formEl = document.getElementById("scheduleSettingsForm");
    if (lockEl) lockEl.style.display = "block";
    if (formEl) formEl.style.display = "none";
    const pw = document.getElementById("scheduleGatePassword");
    if (pw) pw.value = "";
    resetPasswordVisibility("scheduleGatePassword");
  }

  [
    "loginView",
    "dashboardView",
    "scanView",
    "searchView",
    "cardShareView",
    "cardPreviewView",
    "addView",
    "adminSettingsView",
    "appSettingsView",
    "rosterView",
    "attendeeProfileView",
    "birthdaysView",
    "notificationsView",
    "scheduleSettingsView",
    "resultView",
    "attendanceReportView",
    "followupView",
    "currentAttendeesView",
    "offlineQueueView",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display =
        id === viewId ? (id === "loginView" ? "block" : "flex") : "none";
    }
  });
  const activeView = document.getElementById(viewId);
  if (activeView && currentActiveViewId !== viewId) {
    activeView.classList.remove("view-enter-forward", "view-enter-back");
    const enterClass = pushHistory ? "view-enter-forward" : "view-enter-back";
    window.requestAnimationFrame(() => {
      if (currentActiveViewId !== viewId || activeView.style.display === "none")
        return;
      activeView.classList.add(enterClass);
      window.setTimeout(() => {
        activeView.classList.remove("view-enter-forward", "view-enter-back");
      }, 200);
    });
  }

  const homeBtn = document.getElementById("homeBtn");
  const toolbarMenuButton = document.getElementById("toolbarMenuButton");
  const toolbarMenu = document.getElementById("toolbarMenu");
  const adminToolbarButton = document.getElementById("adminToolbarButton");
  const syncToolbarButton = document.getElementById("syncNowToolbarButton");
  const appSettingsToolbarButton = document.getElementById(
    "appSettingsToolbarButton",
  );
  if (toolbarMenuButton) {
    toolbarMenuButton.hidden = !currentUser || viewId === "loginView";
  }
  if (toolbarMenu && (!currentUser || viewId === "loginView")) {
    toolbarMenu.hidden = true;
    toolbarMenuButton?.setAttribute("aria-expanded", "false");
  }
  if (adminToolbarButton) {
    adminToolbarButton.hidden = !currentUser || viewId === "loginView";
  }
  if (syncToolbarButton) {
    syncToolbarButton.hidden = !currentUser || viewId === "loginView";
  }
  if (appSettingsToolbarButton) {
    appSettingsToolbarButton.hidden = !currentUser || viewId === "loginView";
  }
  if (viewId === "dashboardView" || viewId === "loginView") {
    homeBtn.style.display = "none";
    document.getElementById("mainContainer").classList.remove("has-home-navigation");
  } else {
    homeBtn.style.display = "flex";
    document.getElementById("mainContainer").classList.add("has-home-navigation");
  }

  if (pushHistory && currentActiveViewId !== viewId && viewId !== "loginView") {
    history.pushState({ view: viewId }, "", "");
  }

  currentActiveViewId = viewId;
  updateAppNotificationBadge();
  const mainContainer = document.getElementById("mainContainer");
  mainContainer.scrollTo({ top: 0, behavior: "instant" });
  window.requestAnimationFrame(() => {
    if (currentActiveViewId === viewId) {
      mainContainer.scrollTo({ top: 0, behavior: "instant" });
    }
  });

  if (
    viewId === "attendanceReportView" &&
    viewChanged &&
    (typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive())
  ) {
    selectAttendanceReportTab(attendanceReportTab, true);
  }
  if (
    viewId === "followupView" &&
    viewChanged &&
    (typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive())
  ) {
    loadFollowups();
  }
  if (
    viewId === "birthdaysView" &&
    viewChanged &&
    (typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive())
  ) {
    loadBirthdays();
  }
  if (viewId === "notificationsView" && viewChanged) renderAppNotifications();
  if (
    viewId === "currentAttendeesView" &&
    viewChanged &&
    (typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive())
  ) {
    showCurrentAttendeesSkeleton();
    loadCurrentAttendees(false);
    currentAttendeesRefreshTimer = window.setInterval(
      () => loadCurrentAttendees(false),
      30000,
    );
  }
  if (viewId === "dashboardView") {
    if (
      typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive()
    ) {
        scheduleRosterRefresh();
      refreshCurrentAttendeesWindow();
      if (typeof refreshAttendanceContext === "function") {
        refreshAttendanceContext();
      }
      recordAppOpeningNotification();
      checkCachedBirthdayNotifications();
    }
  }
  if (viewId === "scanView") {
    if (
      typeof isFirstRunTutorialActive !== "function" ||
      !isFirstRunTutorialActive()
    )
      setTimeout(startLiveScanner, 150);
  }
}

function localDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getPastAttendanceDates(
  dates,
  today = localDateInputValue(new Date()),
) {
  return dates
    .filter((date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return false;
      const [year, month, day] = date.split("-").map(Number);
      const parsed = new Date(year, month - 1, day);
      return (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month - 1 &&
        parsed.getDate() === day
      );
    })
    .sort();
}

function formatAttendanceDateOption(date, today) {
  const [year, month, day] = date.split("-").map(Number);
  const formattedDate = new Date(year, month - 1, day, 12).toLocaleDateString(
    currentLang === "ar" ? "ar" : "en",
    { year: "numeric", month: "short", day: "numeric" },
  );
  return date === today
    ? `${translations[currentLang].today} · ${formattedDate}`
    : formattedDate;
}

function openAttendanceReport(tab = "attendance") {
  const alreadyOpen = currentActiveViewId === "attendanceReportView";
  attendanceReportTab = tab === "trends" ? "trends" : "attendance";
  showView("attendanceReportView");
  if (alreadyOpen) selectAttendanceReportTab(tab);
}

function openFollowupView() {
  const alreadyOpen = currentActiveViewId === "followupView";
  showView("followupView");
  if (alreadyOpen) loadFollowups();
}

function openAppSettings() {
  if (!currentUser) return;
  showView("appSettingsView");
}

function openRosterManagement() {
  showView("rosterView");
  loadRosterManagement();
}

function scheduleRosterRefresh() {
  if (rosterRefreshTimer) window.clearTimeout(rosterRefreshTimer);
  if (!currentUser) return;
  rosterRefreshTimer = window.setTimeout(async () => {
    rosterRefreshTimer = 0;
    if (
      navigator.onLine &&
      document.visibilityState !== "hidden" &&
      currentActiveViewId !== "scanView"
    ) await refreshRosterCache();
    scheduleRosterRefresh();
  }, 300000);
}

function openBirthdaysView() {
  showView("birthdaysView");
}

function openNotificationsView() {
  showView("notificationsView");
  renderAppNotifications();
  markAppNotificationsRead();
}

function getAppNotifications() {
  try {
    const saved = JSON.parse(localStorage.getItem("app_notifications_v1") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    return [];
  }
}

function updateAppNotificationBadge() {
  const badge = document.getElementById("notificationsMenuBadge");
  if (!badge) return;
  const count = getAppNotifications().filter((item) => !item.read).length;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
}

function sendSystemNotification(title, body, tag, viewId = "") {
  if (typeof Notification === "undefined" || Notification.permission !== "granted")
    return;
  const options = {
    body,
    tag,
    icon: "./Assets/icons/icon-192.png",
    data: { viewId },
  };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then((registration) => {
        if (registration.showNotification)
          return registration.showNotification(title, options);
        const notification = new Notification(title, options);
        notification.onclick = () => {
          window.focus();
          if (viewId) showView(viewId);
        };
        return notification;
      })
      .catch((error) =>
        console.warn("Could not display the device notification.", error),
      );
  } else {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      if (viewId) showView(viewId);
    };
  }
}

function recordAppNotification(key, title, body, viewId = "") {
  const notifications = getAppNotifications();
  if (notifications.some((item) => item.key === key)) return;
  notifications.unshift({
    key,
    title,
    body,
    viewId,
    createdAt: new Date().toISOString(),
    read: false,
  });
  try {
    localStorage.setItem("app_notifications_v1", JSON.stringify(notifications.slice(0, 60)));
  } catch (error) {}
  updateAppNotificationBadge();
  showToast(`${translateText(title)} · ${translateText(body)}`, "info", 8000);
  sendSystemNotification(translateText(title), translateText(body), key, viewId);
  if (currentActiveViewId === "notificationsView") renderAppNotifications();
}

function renderAppNotifications() {
  const container = document.getElementById("notificationResults");
  if (!container) return;
  const composer = document.getElementById("globalNotificationComposer");
  if (composer) composer.hidden = currentUser?.isOwner !== true;
  const notifications = getAppNotifications();
  if (!notifications.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = translations[currentLang].noNotifications;
    container.replaceChildren(empty);
    return;
  }
  const panel = document.createElement("section");
  panel.className = "report-panel notification-list";
  notifications.forEach((item) => {
    const row = document.createElement("article");
    row.className = `notification-item${item.read ? " is-read" : ""}`;
    if (item.viewId) {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const openTarget = () => {
        item.read = true;
        try {
          localStorage.setItem("app_notifications_v1", JSON.stringify(notifications));
        } catch (error) {
          console.warn("Could not update the notification read state.", error);
        }
        updateAppNotificationBadge();
        showView(item.viewId);
      };
      row.addEventListener("click", openTarget);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTarget();
        }
      });
    }
    const heading = document.createElement("strong");
    heading.textContent = translateText(item.title);
    const message = document.createElement("p");
    message.textContent = translateText(item.body);
    const date = document.createElement("small");
    date.textContent = new Date(item.createdAt).toLocaleString(
      currentLang === "ar" ? "ar" : "en",
    );
    row.append(heading, message, date);
    panel.appendChild(row);
  });
  container.replaceChildren(panel);
}

function markAppNotificationsRead() {
  const notifications = getAppNotifications().map((item) => ({ ...item, read: true }));
  try {
    localStorage.setItem("app_notifications_v1", JSON.stringify(notifications));
  } catch (error) {}
  updateAppNotificationBadge();
  renderAppNotifications();
}

function loadFirebaseMessagingSdk() {
  if (window.firebase?.messaging) return Promise.resolve();
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error("Firebase messaging could not be loaded."));
      document.head.appendChild(script);
    });
  return loadScript(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  ).then(() =>
    loadScript(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
    ),
  );
}

async function enablePushNotifications() {
  const config = APP_CONFIG.firebaseConfig;
  if (!config || !APP_CONFIG.firebaseVapidKey) {
    showToast(translations[currentLang].pushSetupRequired, "error");
    return;
  }
  if (typeof Notification === "undefined" || !navigator.serviceWorker) {
    showToast(
      translations[currentLang].browserNotificationsUnsupported,
      "error",
    );
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast(translations[currentLang].browserNotificationsDenied, "info");
      return;
    }
    await loadFirebaseMessagingSdk();
    if (!firebase.apps.length) firebase.initializeApp(config);
    const registration = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    if (!pushMessageHandlerRegistered && typeof messaging.onMessage === "function") {
      messaging.onMessage((payload) => {
        const data = payload.data || {};
        recordAppNotification(
          `push:${data.notificationId || Date.now()}`,
          data.title || "Lambas Bible",
          data.body || "",
          data.viewId || "notificationsView",
        );
      });
      pushMessageHandlerRegistered = true;
    }
    const token = await messaging.getToken({
      vapidKey: APP_CONFIG.firebaseVapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error(translations[currentLang].pushTokenUnavailable);
    const result = await apiCall("register_push_token", { token });
    if (!result || !result.success)
      throw new Error(
        result?.message || translations[currentLang].pushRegistrationFailed,
      );
    showToast(translations[currentLang].browserNotificationsEnabled, "success");
  } catch (error) {
    console.error("Could not enable push notifications.", error);
    showToast(
      error.message || translations[currentLang].pushRegistrationFailed,
      "error",
    );
  }
}

async function sendGlobalNotification() {
  if (currentUser?.isOwner !== true) {
    showToast(translations[currentLang].globalNotificationOwnerOnly, "error");
    return;
  }
  const input = document.getElementById("globalNotificationMessage");
  const message = input.value.trim();
  if (!message) {
    showToast(translations[currentLang].globalNotificationRequired, "error");
    return;
  }
  const button = document.querySelector(
    "#globalNotificationComposer .btn",
  );
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const result = await apiCall("send_global_notification", { message });
    if (!result || !result.success)
      throw new Error(
        result?.message || translations[currentLang].globalNotificationFailed,
      );
    input.value = "";
    showToast(
      translations[currentLang].globalNotificationSent.replace(
        "{count}",
        String(result.sentCount),
      ),
      "success",
    );
  } catch (error) {
    showToast(
      error.message || translations[currentLang].globalNotificationFailed,
      "error",
    );
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function requestBrowserNotifications() {
  return enablePushNotifications();
}

function notifyBirthdayRoster(roster) {
  if (!Array.isArray(roster)) return;
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay(),
  );
  const birthdayKeys = new Set(
    roster.map((person) => String(person.birthdate || "")),
  );
  const hasBirthdayThisWeek = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    );
    return birthdayKeys.has(
      `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    );
  }).some(Boolean);
  if (!hasBirthdayThisWeek) return;
  recordAppNotification(
    `birthdays-week:${localDateInputValue(start)}`,
    "birthdayNotificationTitle",
    "birthdayNotificationBody",
    "birthdaysView",
  );
}

function checkCachedBirthdayNotifications() {
  if (typeof getCachedRoster !== "function" || !currentUser) return;
  getCachedRoster().then(notifyBirthdayRoster).catch(() => {});
}

function recordAppOpeningNotification() {
  const today = localDateInputValue(new Date());
  recordAppNotification(
    `app-open:${today}`,
    "appOpenedNotificationTitle",
    "appOpenedNotificationBody",
  );
}

function updateAttendanceWindowNotification(windowOpen) {
  const wasOpen = currentAttendeesWindowOpen;
  currentAttendeesWindowOpen = windowOpen;
  if (!windowOpen || wasOpen) return;
  const today = localDateInputValue(new Date());
  recordAppNotification(
    `meeting-open:${today}`,
    "meetingOpenedNotificationTitle",
    "meetingOpenedNotificationBody",
  );
}

function setDashboardLayout(layout) {
  const availableLayouts = ["one", "two", "three"];
  const selectedLayout = availableLayouts.includes(layout) ? layout : "two";
  const dashboard = document.getElementById("dashboardView");
  if (!dashboard) return;
  dashboard.dataset.layout = selectedLayout;
  dashboard.querySelectorAll("[data-dashboard-layout]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.dashboardLayout === selectedLayout),
    );
  });
  localStorage.setItem("app_dashboard_layout", selectedLayout);
}

async function loadRosterManagement() {
  const container = document.getElementById("rosterManagementResults");
  showReportSkeleton(container);
  try {
    const applyResult = (result) => {
      if (currentActiveViewId !== "rosterView") return;
      if (!result || !result.success || !Array.isArray(result.people)) {
        throw new Error(
          result && result.message
            ? result.message
            : translations[currentLang].offlineSyncFailed,
        );
      }
      rosterManagementPeople = result.people.filter(
        (person) => person.active !== false,
      );
      renderRosterManagement();
    };
    const result = await apiCall("get_roster_management", {}, applyResult);
    applyResult(result);
  } catch (error) {
    if (currentActiveViewId !== "rosterView") return;
    container.replaceChildren();
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  }
}

function filterRosterManagement() {
  renderRosterManagement();
}

function renderRosterManagement() {
  const container = document.getElementById("rosterManagementResults");
  const query = normalizeSearchName(
    document.getElementById("rosterSearchInput").value,
  );
  const people = rosterManagementPeople.filter(
    (person) => !query || normalizeSearchName(person.name).includes(query),
  );
  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = translations[currentLang].rosterNoMatches;
    container.replaceChildren(empty);
    return;
  }
  const panel = document.createElement("section");
  panel.className = "report-panel roster-people-list";
  people.forEach((person) => {
    const row = document.createElement("article");
    row.className = "roster-person-row";
    const details = document.createElement("div");
    details.className = "roster-person-details";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "roster-person-open";
    title.textContent = person.name;
    title.addEventListener("click", () => beginRosterPersonEdit(row, person));
    const id = document.createElement("small");
    id.textContent = `#${person.id}`;
    details.append(title, id);
    row.append(details);
    panel.appendChild(row);
  });
  container.replaceChildren(panel);
  updateOnlineOnlyControls();
}

function beginRosterPersonEdit(row, person) {
  openAttendeeProfile(person.id);
}

function openAttendeeProfile(id) {
  const person = rosterManagementPeople.find(
    (entry) => String(entry.id) === String(id),
  );
  if (!person) return;
  currentProfilePersonId = String(person.id);
  document.getElementById("attendeeProfileName").value = person.name || "";
  document.getElementById("attendeeProfilePhone").value = person.phone || "";
  const [month = "", day = ""] = String(person.birthdate || "").split("-");
  document.getElementById("attendeeProfileBirthMonth").value = month;
  document.getElementById("attendeeProfileBirthDay").value = day;
  showView("attendeeProfileView");
}

async function copyAttendeePhone() {
  const phone = document.getElementById("attendeeProfilePhone").value.trim();
  if (!phone) {
    showToast(translations[currentLang].phoneNumberMissing, "info");
    return;
  }
  try {
    await navigator.clipboard.writeText(phone);
    showToast(translations[currentLang].phoneCopied, "success");
  } catch (error) {
    showToast(translations[currentLang].phoneCopyFailed, "error");
  }
}

async function saveAttendeeProfile(event) {
  event.preventDefault();
  const person = rosterManagementPeople.find(
    (entry) => String(entry.id) === currentProfilePersonId,
  );
  if (!person) return;
  const name = document.getElementById("attendeeProfileName").value.trim();
  const phone = document.getElementById("attendeeProfilePhone").value.trim();
  const month = document.getElementById("attendeeProfileBirthMonth").value;
  const day = document.getElementById("attendeeProfileBirthDay").value;
  if (Boolean(month) !== Boolean(day)) {
    showToast(translations[currentLang].birthdayDateInvalid, "error");
    return;
  }
  if (phone && !/^[+0-9().\-\s]+$/.test(phone)) {
    showToast(translations[currentLang].phoneNumberInvalid, "error");
    return;
  }
  let birthdate = "";
  if (month && day) {
    const parsedDate = new Date(Date.UTC(2000, Number(month) - 1, Number(day)));
    if (
      parsedDate.getUTCMonth() !== Number(month) - 1 ||
      parsedDate.getUTCDate() !== Number(day)
    ) {
      showToast(translations[currentLang].birthdayDateInvalid, "error");
      return;
    }
    birthdate = `${month}-${day}`;
  }
  const submitButton = document.getElementById("saveAttendeeProfileButton");
  if (submitButton.disabled) return;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  showLoader(translations[currentLang].loadingAction);
  try {
    const result = await apiCall("update_roster_person", {
      id: person.id,
      name,
      active: true,
      birthdate,
      phone,
    });
    if (!result || !result.success)
      throw new Error(
        result && result.message
          ? result.message
          : translations[currentLang].offlineSyncFailed,
      );
    Object.assign(person, result.person || {}, { birthdate, phone });
    showToast(
      result.person?.oldCardCleanupFailed
        ? translations[currentLang].oldCardCleanupFailed
        : translations[currentLang].rosterSaved,
      result.person?.oldCardCleanupFailed ? "info" : "success",
    );
    await refreshRosterCache();
  } catch (error) {
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    hideLoader();
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
}

function deactivateProfilePerson() {
  const person = rosterManagementPeople.find(
    (entry) => String(entry.id) === currentProfilePersonId,
  );
  if (person) return deactivateRosterPerson(person);
}

async function loadBirthdays() {
  const requestId = ++birthdayRequestId;
  const container = document.getElementById("birthdayResults");
  showReportSkeleton(container, 4);
  const applyResult = (result) => {
    if (
      requestId !== birthdayRequestId ||
      currentActiveViewId !== "birthdaysView" ||
      !result ||
      result.success !== true ||
      !Array.isArray(result.roster)
    ) return;
    birthdayPeople = result.roster;
    renderBirthdays();
  };
  try {
    const result = await apiCall("get_roster", {}, applyResult);
    if (!result || result.success !== true) {
      throw new Error(result?.message || translations[currentLang].offlineSyncFailed);
    }
    applyResult(result);
  } catch (error) {
    if (requestId !== birthdayRequestId) return;
    container.replaceChildren();
    const note = document.createElement("p");
    note.className = "report-note";
    note.textContent = error.message || translations[currentLang].offlineSyncFailed;
    container.appendChild(note);
  }
}

function renderBirthdays(now = new Date()) {
  const container = document.getElementById("birthdayResults");
  const fromValue = document.getElementById("birthdayDateFrom").value;
  const toValue = document.getElementById("birthdayDateTo").value;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay(),
  );
  const start = fromValue
    ? new Date(`${fromValue}T00:00:00`)
    : weekStart;
  const end = toValue
    ? new Date(`${toValue}T00:00:00`)
    : new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const upcoming = [];
  birthdayPeople.forEach((person) => {
    const match = String(person.birthdate || "").match(/^(\d{2})-(\d{2})$/);
    if (!match) return;
    const month = Number(match[1]) - 1;
    const day = Number(match[2]);
    for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
      const occurrence = new Date(year, month, day);
      if (
        occurrence.getMonth() !== month ||
        occurrence.getDate() !== day ||
        occurrence < start ||
        occurrence > end
      ) continue;
      upcoming.push({
        ...person,
        occurrence,
        daysUntil: Math.round((occurrence - today) / 86400000),
      });
    }
  });
  upcoming.sort(
    (left, right) =>
      left.occurrence - right.occurrence ||
      left.name.localeCompare(right.name),
  );
  if (!upcoming.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = birthdayPeople.length
      ? translations[currentLang].noBirthdaysInRange
      : translations[currentLang].noBirthdays;
    container.replaceChildren(empty);
    return;
  }
  const panel = document.createElement("section");
  panel.className = "report-panel birthdays-list";
  upcoming.forEach((person) => {
    const row = document.createElement("article");
    row.className = "birthday-person-row";
    const name = document.createElement("strong");
    name.textContent = person.name;
    const date = document.createElement("span");
    date.textContent = person.occurrence.toLocaleDateString(
      currentLang === "ar" ? "ar" : "en",
      { year: "numeric", month: "long", day: "numeric" },
    );
    const timing = document.createElement("small");
    if (!fromValue && !toValue) {
      timing.textContent = person.daysUntil === 0
        ? translations[currentLang].birthdayToday
        : translations[currentLang].birthdayInDays.replace(
            "{days}",
            String(person.daysUntil),
          );
      row.append(name, date, timing);
    } else {
      row.append(name, date);
    }
    panel.appendChild(row);
  });
  container.replaceChildren(panel);
}

function applyBirthdayDateFilter() {
  const fromValue = document.getElementById("birthdayDateFrom").value;
  const toValue = document.getElementById("birthdayDateTo").value;
  if (!fromValue || !toValue || fromValue > toValue) {
    showToast(translations[currentLang].birthdayRangeInvalid, "error");
    return;
  }
  renderBirthdays();
}

function resetBirthdayDateFilter() {
  document.getElementById("birthdayDateFrom").value = "";
  document.getElementById("birthdayDateTo").value = "";
  renderBirthdays();
}

async function deactivateRosterPerson(person) {
  const confirmation = translations[
    currentLang
  ].confirmDeleteRosterPerson.replace("{name}", person.name);
  if (!window.confirm(confirmation)) return;
  showLoader(translations[currentLang].loadingAction);
  try {
    const result = await apiCall("update_roster_person", {
      id: person.id,
      name: person.name,
      active: false,
    });
    if (!result || !result.success) {
      throw new Error(
        result && result.message
          ? result.message
          : translations[currentLang].offlineSyncFailed,
      );
    }
    rosterManagementPeople = rosterManagementPeople.filter(
      (entry) => String(entry.id) !== String(person.id),
    );
    renderRosterManagement();
    if (currentActiveViewId === "attendeeProfileView")
      showView("rosterView");
    showToast(translations[currentLang].rosterPersonDeleted, "success");
    await refreshRosterCache();
  } catch (error) {
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    hideLoader();
  }
}

async function openCurrentAttendeesView() {
  if (currentAttendeesOpenRequestInFlight || !navigator.onLine) return;
  const sourceViewId = currentActiveViewId;
  const tile = document.getElementById("currentAttendeesTile");
  currentAttendeesOpenRequestInFlight = true;
  if (tile) {
    tile.disabled = true;
    tile.setAttribute("aria-busy", "true");
  }
  try {
    let revalidatedWindowResult = null;
    const result = await apiCall("get_attendance_window", {}, (freshResult) => {
      if (
        !freshResult ||
        !freshResult.success ||
        typeof freshResult.windowOpen !== "boolean"
      )
        return;
      revalidatedWindowResult = freshResult;
      updateAttendanceWindowNotification(freshResult.windowOpen);
      currentAttendeesWindowCloseReason = freshResult.closeReason || "";
      updateCurrentAttendeesTileState();
      if (freshResult.windowOpen && currentActiveViewId === sourceViewId) {
        showView("currentAttendeesView");
      } else if (
        !freshResult.windowOpen &&
        currentActiveViewId === "currentAttendeesView"
      ) {
        showView(sourceViewId);
        showToast(
          translations[currentLang].currentAttendeesCannotOpen.replace(
            "{reason}",
            attendanceWindowCloseMessage(freshResult.closeReason),
          ),
          "info",
        );
      }
    });
    const effectiveResult = revalidatedWindowResult || result;
    if (currentActiveViewId !== sourceViewId) return;
    if (
      !effectiveResult ||
      !effectiveResult.success ||
      typeof effectiveResult.windowOpen !== "boolean"
    ) {
      throw new Error(
        effectiveResult && effectiveResult.message
          ? effectiveResult.message
          : translations[currentLang].attendanceWindowCheckFailed,
      );
    }
    updateAttendanceWindowNotification(effectiveResult.windowOpen);
    currentAttendeesWindowCloseReason = effectiveResult.closeReason || "";
    updateCurrentAttendeesTileState();
    if (!effectiveResult.windowOpen) {
      showToast(
        translations[currentLang].currentAttendeesCannotOpen.replace(
          "{reason}",
          attendanceWindowCloseMessage(effectiveResult.closeReason),
        ),
        "info",
      );
      return;
    }
    const alreadyOpen = currentActiveViewId === "currentAttendeesView";
    showView("currentAttendeesView");
    if (alreadyOpen) loadCurrentAttendees();
  } catch (error) {
    if (currentActiveViewId === sourceViewId) {
      showToast(
        error.message || translations[currentLang].attendanceWindowCheckFailed,
        "error",
      );
    }
  } finally {
    currentAttendeesOpenRequestInFlight = false;
    if (tile) {
      tile.disabled = !navigator.onLine;
      tile.removeAttribute("aria-busy");
    }
  }
}

function showCurrentAttendeesSkeleton() {
  const container = document.getElementById("currentAttendeesResults");
  if (!container) return;
  const skeleton = document.createElement("div");
  skeleton.className = "report-loading current-attendees-loading";
  skeleton.setAttribute("role", "status");
  skeleton.setAttribute("aria-label", translations[currentLang].loadingReport);
  for (let index = 0; index < 3; index++) {
    const row = document.createElement("div");
    row.className = "report-skeleton-row";
    row.innerHTML = "<span></span><span></span><span></span>";
    skeleton.appendChild(row);
  }
  container.replaceChildren(skeleton);
}

function updateCurrentAttendees() {
  return loadCurrentAttendees(
    true,
    translations[currentLang].updatingAttendance,
  );
}

async function refreshCurrentAttendeesWindow() {
  if (currentAttendeesWindowTimer) {
    window.clearTimeout(currentAttendeesWindowTimer);
    currentAttendeesWindowTimer = 0;
  }
  if (
    typeof isFirstRunTutorialActive === "function" &&
    isFirstRunTutorialActive()
  )
    return;
  const requestId = ++currentAttendeesWindowRequestId;
  const requestStartedAt = Date.now();
  let nextWindowCheckMs = 30000;
  const tile = document.getElementById("currentAttendeesTile");
  if (!tile) return;
  tile.disabled = true;
  tile.setAttribute("aria-busy", "true");
  if (
    !currentUser ||
    !navigator.onLine ||
    currentActiveViewId !== "dashboardView"
  ) {
    tile.removeAttribute("aria-busy");
    return;
  }
  try {
    const result = await apiCall("get_attendance_window", {}, (freshResult) => {
      if (requestId !== currentAttendeesWindowRequestId) return;
      if (
        !freshResult ||
        !freshResult.success ||
        typeof freshResult.windowOpen !== "boolean"
      )
        return;
      updateAttendanceWindowNotification(freshResult.windowOpen);
      currentAttendeesWindowCloseReason = freshResult.closeReason || "";
      if (Number.isFinite(Number(freshResult.nextCheckMs))) {
        nextWindowCheckMs = Number(freshResult.nextCheckMs);
      }
      updateCurrentAttendeesTileState();
    });
    if (requestId !== currentAttendeesWindowRequestId) return;
    if (!result || !result.success || typeof result.windowOpen !== "boolean") {
      throw new Error(
        result && result.message
          ? result.message
          : "Invalid attendance window response",
      );
    }
    updateAttendanceWindowNotification(result.windowOpen);
    currentAttendeesWindowCloseReason = result.closeReason || "";
    if (Number.isFinite(Number(result?.nextCheckMs))) {
      nextWindowCheckMs = Number(result.nextCheckMs);
    }
  } catch (error) {
    console.error("Could not check the current-attendance window.", error);
    nextWindowCheckMs = 10000;
  } finally {
    if (requestId === currentAttendeesWindowRequestId) {
      tile.disabled = !navigator.onLine;
      updateCurrentAttendeesTileState();
      tile.removeAttribute("aria-busy");
      if (
        navigator.onLine &&
        currentUser &&
        currentActiveViewId === "dashboardView" &&
        (typeof isFirstRunTutorialActive !== "function" ||
          !isFirstRunTutorialActive())
      ) {
        const delay = Math.max(
          1000,
          nextWindowCheckMs - (Date.now() - requestStartedAt),
        );
        currentAttendeesWindowTimer = window.setTimeout(
          refreshCurrentAttendeesWindow,
          Math.min(delay, 2147483647),
        );
      }
    }
  }
}

function updateCurrentAttendeesTileState() {
  const tile = document.getElementById("currentAttendeesTile");
  if (!tile) return;
  const isClosed = !currentAttendeesWindowOpen;
  tile.classList.toggle("is-window-closed", isClosed);
  tile.setAttribute("aria-disabled", String(!navigator.onLine));
  const badge = document.getElementById("currentAttendeesClosedBadge");
  if (badge) badge.hidden = !isClosed;
}

async function loadCurrentAttendees(
  showLoading = true,
  loaderText = "Loading current attendance...",
) {
  const availability = document.getElementById("currentAttendeesAvailability");
  const container = document.getElementById("currentAttendeesResults");
  if (currentActiveViewId !== "currentAttendeesView") return;
  if (
    !showLoading &&
    (document.hidden || document.getElementById("emergencyCheckoutDialog").open)
  )
    return;
  if (currentAttendeesRequestInFlight) {
    currentAttendeesRefreshPending = true;
    return;
  }
  currentAttendeesRequestInFlight = true;
  const requestId = ++currentAttendeesRequestId;
  const mainContainer = document.getElementById("mainContainer");
  const scrollPosition = mainContainer.scrollTop;
  if (showLoading) showLoader(loaderText);
  try {
    const applyResult = (result) => {
      if (
        requestId !== currentAttendeesRequestId ||
        currentActiveViewId !== "currentAttendeesView"
      )
        return;
      if (!result || !result.success || !Array.isArray(result.attendees)) {
        throw new Error(
          result && result.message
            ? result.message
            : translations[currentLang].offlineSyncFailed,
        );
      }
      const snapshot = JSON.stringify(result);
      availability.textContent = result.windowOpen
        ? translations[currentLang].attendanceWindowOpen
        : attendanceWindowCloseMessage(result.closeReason);
      availability.classList.toggle("is-open", result.windowOpen);
      availability.classList.toggle("is-closed", !result.windowOpen);
      const refreshButton = document.getElementById(
        "refreshCurrentAttendeesButton",
      );
      if (refreshButton)
        refreshButton.disabled = !navigator.onLine || !result.windowOpen;
      if (!result.windowOpen) {
        currentAttendeesWindowOpen = false;
        currentAttendeesWindowCloseReason = result.closeReason || "";
        currentAttendeesCheckoutOpen = false;
        currentAttendeesData = [];
        const closed = document.createElement("p");
        closed.className = "report-note";
        closed.textContent = attendanceWindowCloseMessage(result.closeReason);
        container.replaceChildren(closed);
        currentAttendeesSnapshot = snapshot;
        return;
      }
      if (!showLoading && snapshot === currentAttendeesSnapshot) return;
      currentAttendeesSnapshot = snapshot;
      currentAttendeesData = result.attendees;
      currentAttendeesCheckoutOpen = result.checkoutOpen;
      renderCurrentAttendees(result.checkoutOpen);
      mainContainer.scrollTop = scrollPosition;
    };
    const result = await apiCall("get_current_attendees", {}, applyResult);
    applyResult(result);
  } catch (error) {
    if (requestId !== currentAttendeesRequestId) return;
    availability.textContent =
      error.message || translations[currentLang].offlineSyncFailed;
    availability.classList.add("is-closed");
    if (showLoading)
      showToast(
        error.message || translations[currentLang].offlineSyncFailed,
        "error",
      );
  } finally {
    currentAttendeesRequestInFlight = false;
    if (currentAttendeesRefreshPending) {
      currentAttendeesRefreshPending = false;
      if (currentActiveViewId === "currentAttendeesView") {
        window.setTimeout(() => loadCurrentAttendees(false), 0);
      }
    }
    if (showLoading) hideLoader();
  }
}

function attendanceWindowCloseMessage(reason) {
  const messageKey = {
    before_meeting: "attendanceWindowBeforeMeeting",
    after_meeting: "attendanceWindowAfterMeeting",
    no_meeting_today: "attendanceWindowNoMeetingToday",
  }[reason];
  return (
    translations[currentLang][messageKey] ||
    translations[currentLang].attendanceWindowClosed
  );
}

function renderCurrentAttendees(checkoutOpen) {
  const container = document.getElementById("currentAttendeesResults");
  const query = document
    .getElementById("currentAttendeesSearch")
    .value.trim()
    .toLocaleLowerCase();
  const attendees = currentAttendeesData.filter((person) =>
    `${person.name || ""} ${person.checkedInBy || ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  if (!attendees.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = currentAttendeesData.length
      ? translations[currentLang].currentAttendeesNoMatches
      : translations[currentLang].noCurrentAttendees;
    container.replaceChildren(empty);
    return;
  }
  const panel = document.createElement("section");
  panel.className = "report-panel";
  const heading = document.createElement("div");
  heading.className = "report-panel-heading";
  const title = document.createElement("strong");
  title.textContent = `${translations[currentLang].currentAttendeesTitle} · ${attendees.length}`;
  heading.appendChild(title);
  panel.appendChild(heading);
  const table = document.createElement("div");
  table.className = "current-attendees-table";
  table.setAttribute("role", "table");
  const header = document.createElement("div");
  header.className = "current-attendees-row current-attendees-header";
  header.setAttribute("role", "row");
  [
    translations[currentLang].studentNameLabel,
    translations[currentLang].currentAttendeesAdminTime,
    translations[currentLang].currentAttendeesActions,
  ].forEach((label) => {
    const cell = document.createElement("strong");
    cell.setAttribute("role", "columnheader");
    cell.textContent = label;
    header.appendChild(cell);
  });
  table.appendChild(header);
  attendees.forEach((person) => {
    const row = document.createElement("div");
    row.className = "current-attendees-row";
    row.setAttribute("role", "row");
    const nameCell = document.createElement("strong");
    nameCell.setAttribute("role", "cell");
    nameCell.dataset.label = translations[currentLang].studentNameLabel;
    nameCell.textContent = person.name;
    const metaCell = document.createElement("div");
    metaCell.className = "current-attendees-meta";
    metaCell.setAttribute("role", "cell");
    metaCell.dataset.label = translations[currentLang].currentAttendeesAdminTime;
    const admin = document.createElement("span");
    admin.textContent = person.checkedInBy || "—";
    const time = document.createElement("time");
    time.dateTime = person.checkinTime
      ? new Date(person.checkinTime).toISOString()
      : "";
    time.textContent = person.checkinTime
      ? new Date(person.checkinTime).toLocaleTimeString(
          currentLang === "ar" ? "ar" : "en",
          { hour: "2-digit", minute: "2-digit" },
        )
      : "";
    metaCell.append(admin, time);
    const actions = document.createElement("div");
    actions.className = "current-attendees-actions";
    actions.setAttribute("role", "cell");
    actions.dataset.label = translations[currentLang].currentAttendeesActions;
    const actionMenu = document.createElement("details");
    actionMenu.className = "row-action-menu";
    const actionTrigger = document.createElement("summary");
    actionTrigger.title = translations[currentLang].moreActions;
    actionTrigger.setAttribute("aria-label", translations[currentLang].moreActions);
    actionTrigger.innerHTML = '<i class="fa-solid fa-ellipsis" aria-hidden="true"></i>';
    const actionItems = document.createElement("div");
    actionItems.className = "row-action-menu-items";
    actionMenu.append(actionTrigger, actionItems);
    actions.appendChild(actionMenu);
    const addActionButton = (className, iconName, label, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn secondary ${className}`;
      button.dataset.onlineOnly = "";
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = document.createElement("i");
      icon.className = `fa-solid ${iconName}`;
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "current-attendees-action-label";
      text.textContent = label;
      button.append(icon, text);
      button.addEventListener("click", () => {
        actionMenu.open = false;
        runButtonAction(button, onClick);
      });
      actionItems.appendChild(button);
    };
    addActionButton(
      checkoutOpen ? "current-attendees-checkout" : "emergency-checkout-button",
      checkoutOpen ? "fa-right-from-bracket" : "fa-triangle-exclamation",
      checkoutOpen
        ? translations[currentLang].attendanceCheckout
        : translations[currentLang].emergencyCheckout,
      checkoutOpen
        ? () => checkoutAttendance(person.id)
        : () => showEmergencyCheckoutDialog(person),
    );
    addActionButton(
      "attendance-cancel-button",
      "fa-xmark",
      translations[currentLang].attendanceCancelCheckin,
      () => cancelAttendanceCheckin(person.id),
    );
    row.append(nameCell, metaCell, actions);
    table.appendChild(row);
  });
  panel.appendChild(table);
  container.replaceChildren(panel);
  updateOnlineOnlyControls();
}

function filterCurrentAttendees() {
  renderCurrentAttendees(currentAttendeesCheckoutOpen);
}

function showEmergencyCheckoutDialog(person) {
  currentEmergencyCheckoutId = person.id;
  document.getElementById("emergencyCheckoutAttendee").textContent =
    person.name;
  const reason = document.getElementById("emergencyCheckoutReason");
  reason.value = "";
  const dialog = document.getElementById("emergencyCheckoutDialog");
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => reason.focus(), 0);
}

function closeEmergencyCheckoutDialog() {
  const dialog = document.getElementById("emergencyCheckoutDialog");
  if (dialog.open) dialog.close();
  currentEmergencyCheckoutId = "";
}

async function submitEmergencyCheckout(event) {
  event.preventDefault();
  const id = currentEmergencyCheckoutId;
  const actionKey = `emergency:${id}`;
  if (!id || currentAttendeeActionsInFlight.has(actionKey)) return;
  const reasonInput = document.getElementById("emergencyCheckoutReason");
  const cleanReason = reasonInput.value.replace(/\s+/g, " ").trim();
  if (cleanReason.length < 5 || cleanReason.length > 500) {
    reasonInput.setCustomValidity(
      translations[currentLang].emergencyCheckoutReason,
    );
    reasonInput.reportValidity();
    return;
  }
  reasonInput.setCustomValidity("");
  currentAttendeeActionsInFlight.add(actionKey);
  const submit = document.getElementById("emergencyCheckoutSubmit");
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  const submitLabel = submit.textContent;
  submit.textContent = translations[currentLang].loadingAction;
  try {
    const result = await apiCall("emergency_checkout_attendance", {
      id: id,
      reason: cleanReason,
    });
    if (!result || result.kind !== "out") {
      throw new Error(
        result && result.message
          ? result.message
          : translations[currentLang].offlineSyncFailed,
      );
    }
    if (typeof refreshAttendanceContext === "function")
      refreshAttendanceContext();
    closeEmergencyCheckoutDialog();
    showToast(translations[currentLang].emergencyCheckoutCompleted, "success");
    await loadCurrentAttendees();
  } catch (error) {
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    currentAttendeeActionsInFlight.delete(actionKey);
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
    submit.textContent = submitLabel;
  }
}

function selectAttendanceReportTab(tab, forceReload = false) {
  attendanceReportTab = tab === "trends" ? "trends" : "attendance";
  const attendancePanel = document.getElementById("attendanceTabPanel");
  const trendsPanel = document.getElementById("trendsTabPanel");
  const attendanceButton = document.getElementById("attendanceTabButton");
  const trendsButton = document.getElementById("trendsTabButton");
  const tabs = document.querySelector(".report-tabs");
  const isTrends = attendanceReportTab === "trends";
  tabs.dataset.activeTab = attendanceReportTab;
  attendancePanel.hidden = isTrends;
  trendsPanel.hidden = !isTrends;
  const activePanel = isTrends ? trendsPanel : attendancePanel;
  activePanel.classList.remove("report-panel-enter");
  window.requestAnimationFrame(() =>
    activePanel.classList.add("report-panel-enter"),
  );
  attendanceButton.classList.toggle("is-active", !isTrends);
  trendsButton.classList.toggle("is-active", isTrends);
  attendanceButton.setAttribute("aria-selected", String(!isTrends));
  trendsButton.setAttribute("aria-selected", String(isTrends));
  if (
    typeof isFirstRunTutorialActive === "function" &&
    isFirstRunTutorialActive()
  ) {
    const result = document.getElementById(
      isTrends ? "attendanceTrendsResults" : "attendanceReportResults",
    );
    if (result) {
      const preview = document.createElement("p");
      preview.className = "tutorial-preview report-note";
      preview.textContent = translations[currentLang].tutorialPreview;
      result.replaceChildren(preview);
    }
    return;
  }
  if (isTrends) loadAttendanceTrends();
  else if (
    forceReload ||
    document.getElementById("attendanceReportDate").options.length <= 1
  ) {
    loadAttendanceReportDates();
  }
}

async function loadAttendanceReportDates() {
  const requestId = ++attendanceReportRequestId;
  const select = document.getElementById("attendanceReportDate");
  if (!select) return;
  select.disabled = true;
  select.dataset.busy = "true";
  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = translations[currentLang].attendanceDatesLoading;
  select.replaceChildren(loadingOption);
  document.getElementById("attendanceReportResults").hidden = false;
  document.getElementById("attendanceSearchResult").hidden = true;
  document.getElementById("attendanceSearchAgainButton").hidden = true;
  showReportSkeleton(document.getElementById("attendanceReportResults"));
  document.getElementById("attendanceSearchResult").replaceChildren();
  try {
    const applyResult = async (result) => {
      if (
        requestId !== attendanceReportRequestId ||
        currentActiveViewId !== "attendanceReportView" ||
        attendanceReportTab !== "attendance"
      )
        return;
      if (!result || !result.success || !Array.isArray(result.dates)) {
        throw new Error(
          result && result.message
            ? result.message
            : translations[currentLang].attendanceDatesFailed,
        );
      }
      select.replaceChildren();
      const today = localDateInputValue(new Date());
      const dates = getPastAttendanceDates(result.dates, today);
      if (!dates.length) {
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent =
          translations[currentLang].attendanceDatesEmpty;
        select.appendChild(emptyOption);
        document.getElementById("attendanceReportResults").replaceChildren();
        return;
      }
      dates.forEach((date) => {
        const option = document.createElement("option");
        option.value = date;
        option.textContent = formatAttendanceDateOption(date, today);
        select.appendChild(option);
      });
      select.value = dates[dates.length - 1];
      delete select.dataset.busy;
      select.disabled = false;
      await loadAttendanceReport();
    };
    const result = await apiCall("get_attendance_dates", {}, applyResult);
    await applyResult(result);
  } catch (error) {
    if (requestId !== attendanceReportRequestId) return;
    select.replaceChildren();
    const errorOption = document.createElement("option");
    errorOption.value = "";
    errorOption.textContent = translations[currentLang].attendanceDatesFailed;
    select.appendChild(errorOption);
    showToast(
      error.message || translations[currentLang].attendanceDatesFailed,
      "error",
    );
  } finally {
    if (requestId === attendanceReportRequestId) {
      delete select.dataset.busy;
      select.disabled = !navigator.onLine;
    }
  }
}

async function loadFollowups() {
  const requestId = ++attendanceReportRequestId;
  const container = document.getElementById("followupResults");
  showReportSkeleton(container);
  try {
    const applyResult = (result) => {
      if (
        requestId !== attendanceReportRequestId ||
        currentActiveViewId !== "followupView"
      )
        return;
      if (!result || !result.success) throw new Error(result && result.message);
      followupReportPeople = Array.isArray(result.followups)
        ? result.followups.slice().sort((left, right) =>
            Number(right.missedMeetings) - Number(left.missedMeetings) ||
            String(left.lastAttended || "").localeCompare(
              String(right.lastAttended || ""),
            ),
          )
        : [];
      renderFollowupResults();
      updateOnlineOnlyControls();
    };
    const result = await apiCall("get_followups", {}, applyResult);
    applyResult(result);
  } catch (error) {
    if (requestId !== attendanceReportRequestId) return;
    container.replaceChildren();
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  }
}

function filterFollowups() {
  renderFollowupResults();
}

function renderFollowupResults() {
  const container = document.getElementById("followupResults");
  const query = document
    .getElementById("followupPersonQuery")
    .value.trim()
    .toLocaleLowerCase();
  const people = followupReportPeople.filter((person) =>
    String(person.name || "")
      .toLocaleLowerCase()
      .includes(query),
  );
  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    if (query && followupReportPeople.length) {
      empty.textContent = translations[currentLang].followupNoMatches;
    } else if (!query) {
      empty.textContent = translations[currentLang].noFollowups;
    } else {
      return;
    }
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "report-panel";
  const heading = document.createElement("div");
  heading.className = "report-panel-heading";
  heading.textContent = translations[currentLang].followupsTitle;
  panel.appendChild(heading);
  people.forEach((person) => {
    const item = document.createElement("article");
    item.className = "attendance-person-card followup-person-card";
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = person.name;
    const note = document.createElement("small");
    note.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
    note.textContent = [
      translations[currentLang].followupMissedMeetings.replace(
        "{count}",
        String(person.missedMeetings),
      ),
      `${translations[currentLang].followupLastAttended}: ${formatAttendanceDateOption(
        person.lastAttended,
        localDateInputValue(new Date()),
      )}`,
    ].join(" · ");
    details.append(name, note);
    const completeButton = document.createElement("button");
    completeButton.type = "button";
    completeButton.className = "btn secondary";
    completeButton.dataset.onlineOnly = "";
    completeButton.style.cssText = "width:auto;margin:0;padding:8px 10px;";
    completeButton.textContent = translations[currentLang].markFollowupComplete;
    completeButton.addEventListener("click", () =>
      completeAttendanceFollowup(person.id),
    );
    item.append(details, completeButton);
    panel.appendChild(item);
  });
  container.appendChild(panel);
  updateOnlineOnlyControls();
}

async function completeAttendanceFollowup(id) {
  try {
    const result = await apiCall("complete_followup", { id: id });
    if (!result || !result.success) throw new Error(result && result.message);
    showToast(translations[currentLang].followupCompleted, "success");
    await loadFollowups();
  } catch (error) {
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  }
}

function renderAttendanceReport(report, query, created) {
  const list = document.getElementById("attendanceReportResults");
  const searchResult = document.getElementById("attendanceSearchResult");
  const searchAgainButton = document.getElementById(
    "attendanceSearchAgainButton",
  );
  attendanceReportData = report;
  list.replaceChildren();
  searchResult.replaceChildren();
  list.hidden = Boolean(query);
  searchResult.hidden = !query;
  searchAgainButton.hidden = !query;
  const attendanceFilter = document.getElementById(
    "attendanceStatusFilter",
  ).value;
  const visiblePeople = report.people.filter(
    (person) =>
      attendanceFilter === "all" ||
      (attendanceFilter === "attended" && person.attended) ||
      (attendanceFilter === "absent" && !person.attended),
  );
  const resultPanel = query ? document.createElement("section") : null;
  if (resultPanel) {
    resultPanel.className = "report-panel";
    const heading = document.createElement("div");
    heading.className = "report-panel-heading";
    heading.textContent = translations[currentLang].attendanceSearchResults;
    resultPanel.appendChild(heading);
  }

  if (!query) {
    const summary = document.createElement("p");
    summary.className = "report-panel-heading";
    const absentCount = report.people.length - report.count;
    const attendanceSummary =
      attendanceFilter === "attended"
        ? translations[currentLang].attendanceSummaryAttended.replace(
            "{count}",
            report.count,
          )
        : attendanceFilter === "absent"
          ? translations[currentLang].attendanceSummaryAbsent.replace(
              "{count}",
              absentCount,
            )
          : translations[currentLang].attendanceSummaryAll
              .replace("{attended}", report.count)
              .replace("{absent}", absentCount);
    summary.textContent = `${report.date} · ${attendanceSummary}`;
    const panel = document.createElement("section");
    panel.className = "report-panel";
    panel.appendChild(summary);
    const table = document.createElement("div");
    table.className = "attendance-report-table";
    table.setAttribute("role", "table");
    const header = document.createElement("div");
    header.className = "attendance-report-row attendance-report-header";
    header.setAttribute("role", "row");
    const nameHeader = document.createElement("strong");
    nameHeader.setAttribute("role", "columnheader");
    nameHeader.textContent = translations[currentLang].studentNameLabel;
    const stateHeader = document.createElement("strong");
    stateHeader.setAttribute("role", "columnheader");
    stateHeader.textContent = translations[currentLang].attendanceStateLabel;
    header.append(nameHeader, stateHeader);
    table.appendChild(header);
    if (!visiblePeople.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = translations[currentLang].attendanceFilterNoResults;
      table.appendChild(empty);
    }
    visiblePeople.forEach((person) => {
      const item = document.createElement("div");
      item.className = "attendance-report-row";
      item.setAttribute("role", "row");
      const name = document.createElement("strong");
      name.setAttribute("role", "cell");
      name.textContent = person.name;
      const state = document.createElement("span");
      state.setAttribute("role", "cell");
      state.className = `attendance-state attendance-state-${person.state || (person.attended ? "on_time" : "absent")}`;
      state.textContent =
        person.state === "delayed"
          ? person.delay
            ? translations[currentLang].attendanceWithDelay.replace(
                "{delay}",
                person.delay,
              )
            : translations[currentLang].attendanceDelayed
          : person.attended
            ? translations[currentLang].attendanceOnTime
            : translations[currentLang].absent;
      item.append(name, state);
      table.appendChild(item);
    });
    panel.appendChild(table);
    list.appendChild(panel);
  }

  if (query) {
    if (!report.matches.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = translations[currentLang].attendanceNoMatches;
      resultPanel.appendChild(empty);
    }
    report.matches.forEach((person) => {
      const item = document.createElement("div");
      item.className = "attendance-report-match";
      const name = document.createElement("strong");
      name.textContent = person.name;
      const state = document.createElement("span");
      state.className = `attendance-state attendance-state-${person.state || (person.attended ? "on_time" : "absent")}`;
      state.textContent =
        person.state === "delayed"
          ? person.delay
            ? translations[currentLang].attendanceWithDelay.replace(
                "{delay}",
                person.delay,
              )
            : translations[currentLang].attendanceDelayed
          : person.attended
            ? translations[currentLang].attendanceOnTime
            : translations[currentLang].absent;
      item.append(name, state);
      resultPanel.appendChild(item);
    });
  }
  if (resultPanel) searchResult.appendChild(resultPanel);
  if (created && report.report) showAttendanceSheetResult(report);
}

async function loadAttendanceTrends() {
  const container = document.getElementById("attendanceTrendsResults");
  const requestId = ++attendanceTrendsRequestId;
  showReportSkeleton(container, 3);
  try {
    const payload = {
      meetings: Number(
        document.getElementById("attendanceTrendMeetings").value,
      ),
    };
    const applyResult = (result) => {
      if (
        requestId !== attendanceTrendsRequestId ||
        currentActiveViewId !== "attendanceReportView" ||
        attendanceReportTab !== "trends"
      )
        return;
      if (!result || !result.success || !Array.isArray(result.trends)) {
        throw new Error(
          result && result.message
            ? result.message
            : translations[currentLang].attendanceTrendNoData,
        );
      }
      renderAttendanceTrends(result.trends);
    };
    const result = await apiCall("get_attendance_trends", payload, applyResult);
    applyResult(result);
  } catch (error) {
    if (requestId !== attendanceTrendsRequestId) return;
    container.replaceChildren();
    showToast(
      error.message || translations[currentLang].attendanceTrendNoData,
      "error",
    );
  }
}

function renderAttendanceTrends(trends) {
  const container = document.getElementById("attendanceTrendsResults");
  if (!trends.length) {
    const empty = document.createElement("p");
    empty.className = "report-note";
    empty.textContent = translations[currentLang].attendanceTrendNoData;
    container.replaceChildren(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "attendance-trend-list";
  trends.forEach((trend) => {
    const item = document.createElement("article");
    item.className = "attendance-trend-item";
    const date = document.createElement("strong");
    date.textContent = formatAttendanceDateOption(
      trend.date,
      localDateInputValue(new Date()),
    );
    const stats = document.createElement("span");
    stats.textContent = [
      `${translations[currentLang].attendanceTrendAttendedLabel}: ${trend.attended}/${trend.total}`,
      `${translations[currentLang].attendanceTrendAbsentLabel}: ${trend.absent}`,
      `${translations[currentLang].attendanceTrendDelayedLabel}: ${trend.delayed}`,
    ].join(" · ");
    const rate = document.createElement("strong");
    rate.className = "attendance-trend-rate";
    rate.textContent = `${trend.attendanceRate}%`;
    rate.setAttribute(
      "aria-label",
      `${translations[currentLang].attendanceTrendRateLabel}: ${trend.attendanceRate}%`,
    );
    item.append(date, stats, rate);
    list.appendChild(item);
  });
  container.replaceChildren(list);
}

function startAttendanceSearchAgain() {
  const input = document.getElementById("attendancePersonQuery");
  input.value = "";
  if (attendanceReportData) {
    renderAttendanceReport(attendanceReportData, "", false);
  }
  input.focus();
}

function filterAttendanceReport() {
  if (attendanceReportData) {
    renderAttendanceReport(
      attendanceReportData,
      document.getElementById("attendancePersonQuery").value.trim(),
      false,
    );
  }
}

function showAttendanceSheetResult(report) {
  const dialog = document.getElementById("attendanceSheetResultDialog");
  const date = formatAttendanceDateOption(
    report.date,
    localDateInputValue(new Date()),
  );
  const selectedCount = Number(report.exportedCount) || 0;
  const sheetType = report.report.type || "both";
  const selectionLabel =
    translations[currentLang][
      sheetType === "attendees"
        ? "attendanceSheetAttendees"
        : sheetType === "absents"
          ? "attendanceSheetAbsents"
          : "attendanceSheetBoth"
    ];
  const sheetMessage = report.report.alreadyExists
    ? translations[currentLang].attendanceSheetAlreadyExistsMessage
    : translations[currentLang].attendanceSheetCreatedMessage
        .replace("{total}", String(selectedCount))
        .replace("{attended}", String(report.count));
  document.getElementById("attendanceSheetResultMessage").textContent =
    `${sheetMessage} · ${selectionLabel} · ${date}`;
  document.getElementById("attendanceSheetOpenLink").href =
    `${GOOGLE_SHEET_URL}#gid=${report.report.sheetId}`;
  currentAttendanceReportExport = {
    date: report.date,
    type: report.report.type || "both",
  };
  if (!dialog.open) dialog.showModal();
}

async function downloadAttendanceExport(format) {
  if (
    attendanceExportInFlight ||
    !currentAttendanceReportExport ||
    !["pdf", "xlsx"].includes(format)
  ) return;
  const resultDialog = document.getElementById("attendanceSheetResultDialog");
  const optionsDialog = document.getElementById("attendanceExportDialog");
  const button = optionsDialog.open
    ? document.getElementById("attendanceExportSubmit")
    : resultDialog.open
    ? document.getElementById(
        format === "pdf" ? "attendanceSheetPdfLink" : "attendanceSheetExcelLink",
      )
    : document.getElementById("attendanceExportButton");
  const label = button.querySelector("span") || button;
  const previousLabel = label.textContent;
  attendanceExportInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  label.textContent = translations[currentLang].downloadingAttendanceFile;
  try {
    const result = await apiCall("export_daily_attendance_report", {
      ...currentAttendanceReportExport,
      format,
    });
    if (!result || !result.success || !result.base64) {
      throw new Error(result?.message || translations[currentLang].attendanceExportFailed);
    }
    const bytes = Uint8Array.from(atob(result.base64), (character) =>
      character.charCodeAt(0),
    );
    const blob = new Blob([bytes], { type: result.contentType });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = result.filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast(translations[currentLang].attendanceExportReady, "success");
    if (optionsDialog.open) optionsDialog.close();
  } catch (error) {
    showToast(error.message || translations[currentLang].attendanceExportFailed, "error");
  } finally {
    attendanceExportInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    label.textContent = previousLabel;
  }
}

function openAttendanceExportDialog() {
  const date = document.getElementById("attendanceReportDate").value;
  if (!date) {
    showToast(translations[currentLang].attendancePersonPlaceholder, "info");
    return;
  }
  document.getElementById("attendanceExportDialog").showModal();
}

async function runAttendanceExport(event) {
  event.preventDefault();
  const date = document.getElementById("attendanceReportDate").value;
  if (!date) {
    showToast(translations[currentLang].attendancePersonPlaceholder, "info");
    return;
  }
  const type = document.getElementById("attendanceExportPeople").value;
  const format = document.getElementById("attendanceExportFormat").value;
  currentAttendanceReportExport = { date, type };
  if (format === "sheets") {
    document.getElementById("attendanceExportDialog").close();
    createAttendanceReportSheet(type);
    return;
  }
  if (format === "png") {
    await downloadAttendancePng(date, type);
    return;
  }
  await downloadAttendanceExport(format);
}

async function downloadAttendancePng(date, type) {
  if (attendanceExportInFlight) return;
  const button = document.getElementById("attendanceExportSubmit");
  attendanceExportInFlight = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const result = await apiCall("get_attendance_day", { date });
    if (!result || !result.success || !Array.isArray(result.people))
      throw new Error(result?.message || translations[currentLang].attendanceExportFailed);
    const people = result.people.filter((person) =>
      type === "attendees"
        ? person.attended
        : type === "absents"
          ? !person.attended
          : true,
    );
    const namesOnly = type === "absents";
    const columns = namesOnly
      ? [translations[currentLang].studentNameLabel]
      : [
          translations[currentLang].studentNameLabel,
          translations[currentLang].attendanceStateLabel,
          translations[currentLang].delayLabel,
        ];
    const canvas = document.createElement("canvas");
    const width = 1400;
    const margin = 52;
    const titleHeight = 100;
    const headerHeight = 76;
    const rowHeight = 66;
    canvas.width = width;
    canvas.height = titleHeight + headerHeight + Math.max(1, people.length) * rowHeight + margin;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(translations[currentLang].attendanceExportFailed);
    context.direction = currentLang === "ar" ? "rtl" : "ltr";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#182333";
    context.font = "700 30px Arial, sans-serif";
    context.fillText(
      `${translations[currentLang].attendanceReports} · ${date}`,
      width / 2,
      titleHeight / 2,
    );
    const widths = namesOnly
      ? [width - margin * 2]
      : [
          (width - margin * 2) * 0.54,
          (width - margin * 2) * 0.24,
          (width - margin * 2) * 0.22,
        ];
    const rows = [columns, ...people.map((person) =>
      namesOnly
        ? [person.name]
        : [
            person.name,
            person.state === "delayed"
              ? translations[currentLang].attendanceDelayed
              : person.attended
                ? translations[currentLang].attendanceOnTime
                : translations[currentLang].absent,
            person.delay || "",
          ],
    )];
    let y = titleHeight;
    rows.forEach((row, rowIndex) => {
      let x = margin;
      row.forEach((value, columnIndex) => {
        const cellWidth = widths[columnIndex];
        context.fillStyle = rowIndex === 0 ? "#f5bd55" : "#ffffff";
        context.fillRect(x, y, cellWidth, rowHeight);
        context.strokeStyle = "#6b7280";
        context.lineWidth = 2;
        context.strokeRect(x, y, cellWidth, rowHeight);
        context.fillStyle = "#182333";
        context.font = rowIndex === 0
          ? "700 25px Arial, sans-serif"
          : "500 23px Arial, sans-serif";
        context.fillText(String(value || ""), x + cellWidth / 2, y + rowHeight / 2, cellWidth - 24);
        x += cellWidth;
      });
      y += rowHeight;
    });
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((image) =>
        image ? resolve(image) : reject(new Error(translations[currentLang].attendanceExportFailed)),
      "image/png"),
    );
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `attendance-${date}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showToast(translations[currentLang].attendanceExportReady, "success");
    document.getElementById("attendanceExportDialog").close();
  } catch (error) {
    showToast(error.message || translations[currentLang].attendanceExportFailed, "error");
  } finally {
    attendanceExportInFlight = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function closeAttendanceSheetResult() {
  const dialog = document.getElementById("attendanceSheetResultDialog");
  if (dialog.open) dialog.close();
}

async function loadAttendanceReport(createSheet = false, sheetType = "both") {
  const requestId = ++attendanceReportRequestId;
  const date = document.getElementById("attendanceReportDate").value;
  const query = document.getElementById("attendancePersonQuery").value.trim();
  if (!date) {
    showToast(translations[currentLang].attendancePersonPlaceholder, "info");
    return;
  }
  const searching = Boolean(query) && !createSheet;
  document.getElementById("attendanceReportResults").hidden = searching;
  document.getElementById("attendanceSearchResult").hidden = !searching;
  document.getElementById("attendanceSearchAgainButton").hidden = !searching;
  document.getElementById("attendanceReportResults").replaceChildren();
  document.getElementById("attendanceSearchResult").replaceChildren();
  showReportSkeleton(
    searching
      ? document.getElementById("attendanceSearchResult")
      : document.getElementById("attendanceReportResults"),
    3,
    createSheet
      ? translations[currentLang].creatingAttendanceSheet
      : translations[currentLang].loadingReport,
  );
  const sheetButton = document.getElementById("attendanceExportSubmit");
  if (createSheet) {
    sheetButton.disabled = true;
    sheetButton.setAttribute("aria-busy", "true");
    showLoader(translations[currentLang].creatingAttendanceSheet);
  }
  try {
    const action = createSheet
      ? "create_daily_attendance_report"
      : "get_attendance_day";
    const payload = {
      date,
      name: query,
      type: createSheet ? sheetType : undefined,
    };
    const applyResult = (result) => {
      if (
        requestId !== attendanceReportRequestId ||
        currentActiveViewId !== "attendanceReportView" ||
        attendanceReportTab !== "attendance"
      )
        return;
      if (!result || !result.success) throw new Error(result && result.message);
      renderAttendanceReport(result, createSheet ? "" : query, createSheet);
    };
    const result = await apiCall(
      action,
      payload,
      createSheet ? null : applyResult,
    );
    applyResult(result);
  } catch (error) {
    if (requestId !== attendanceReportRequestId) return;
    document.getElementById("attendanceReportResults").replaceChildren();
    document.getElementById("attendanceReportResults").hidden = false;
    document.getElementById("attendanceSearchResult").hidden = true;
    document.getElementById("attendanceSearchAgainButton").hidden = true;
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    if (createSheet) {
      hideLoader();
      sheetButton.disabled = !navigator.onLine;
      sheetButton.removeAttribute("aria-busy");
    }
  }
}

function createAttendanceReportSheet(sheetType = "both") {
  loadAttendanceReport(true, sheetType);
}

async function checkoutAttendance(id) {
  const actionKey = `checkout:${id}`;
  if (currentAttendeeActionsInFlight.has(actionKey)) return;
  if (!window.confirm(translations[currentLang].confirmAttendanceCheckout))
    return;
  currentAttendeeActionsInFlight.add(actionKey);
  showLoader("Recording attendance check-out...");
  try {
    const result = await apiCall("checkout_attendance", { id: id });
    hideLoader();
    if (!result || result.kind !== "out") {
      throw new Error(
        result && result.message
          ? result.message
          : translations[currentLang].attendanceCheckout,
      );
    }
    if (typeof refreshAttendanceContext === "function")
      refreshAttendanceContext();
    showToast(translations[currentLang].attendanceCheckoutCompleted, "success");
    if (currentActiveViewId === "currentAttendeesView")
      await loadCurrentAttendees();
    else await loadAttendanceReport();
  } catch (error) {
    hideLoader();
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    currentAttendeeActionsInFlight.delete(actionKey);
  }
}

async function cancelAttendanceCheckin(id) {
  if (!currentUser) return;
  const actionKey = `cancel:${id}`;
  if (currentAttendeeActionsInFlight.has(actionKey)) return;
  if (!window.confirm(translations[currentLang].confirmCancelCheckin)) return;
  currentAttendeeActionsInFlight.add(actionKey);
  showLoader("Cancelling attendance check-in...");
  try {
    const result = await apiCall("cancel_checkin", { id: id });
    hideLoader();
    if (!result || !result.success) {
      if (result && result.code === "CHECKOUT_ALREADY_RECORDED") {
        throw new Error(translations[currentLang].checkoutAlreadyRecorded);
      }
      throw new Error(result && result.message);
    }
    if (typeof refreshAttendanceContext === "function")
      refreshAttendanceContext();
    showToast(translations[currentLang].attendanceCancelSuccess, "success");
    if (currentActiveViewId === "currentAttendeesView")
      await loadCurrentAttendees();
    else await loadAttendanceReport();
  } catch (error) {
    hideLoader();
    showToast(
      error.message || translations[currentLang].offlineSyncFailed,
      "error",
    );
  } finally {
    currentAttendeeActionsInFlight.delete(actionKey);
  }
}

window.addEventListener("popstate", function (e) {
  if (e.state && e.state.view) showView(e.state.view, false);
  else showView(currentUser ? "dashboardView" : "loginView", false);
});

function resetView(viewId) {
  if (viewId === "searchView") {
    document.getElementById("searchNameInput").value = "";
    document.getElementById("searchResults").innerHTML = "";
  } else if (viewId === "scanView") {
    clearScanFeedback();
    stopLiveScanner();
  } else if (viewId === "addView") {
    document.getElementById("newStudentName").value = "";
    document.getElementById("addResult").innerHTML = "";
  } else if (viewId === "cardShareView") {
    document.getElementById("shareNameInput").value = "";
    document.getElementById("shareResults").innerHTML = "";
  } else if (viewId === "attendanceReportView") {
    attendanceReportRequestId++;
    attendanceReportTab = "attendance";
    document.getElementById("attendancePersonQuery").value = "";
    document.getElementById("attendanceStatusFilter").value = "all";
    attendanceReportData = null;
    document.getElementById("attendanceReportResults").replaceChildren();
    document.getElementById("attendanceSearchResult").replaceChildren();
    document.getElementById("attendanceReportResults").hidden = false;
    document.getElementById("attendanceSearchResult").hidden = true;
    document.getElementById("attendanceSearchAgainButton").hidden = true;
    document.getElementById("attendanceTrendsResults").replaceChildren();
    const select = document.getElementById("attendanceReportDate");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = translations[currentLang].attendanceDatesLoading;
    select.replaceChildren(placeholder);
    document.getElementById("attendanceTabPanel").hidden = false;
    document.getElementById("trendsTabPanel").hidden = true;
    document.getElementById("attendanceTabButton").classList.add("is-active");
    document.getElementById("trendsTabButton").classList.remove("is-active");
    document
      .getElementById("attendanceTabButton")
      .setAttribute("aria-selected", "true");
    document
      .getElementById("trendsTabButton")
      .setAttribute("aria-selected", "false");
  } else if (viewId === "followupView") {
    attendanceReportRequestId++;
    document.getElementById("followupPersonQuery").value = "";
    document.getElementById("followupResults").replaceChildren();
  } else if (viewId === "currentAttendeesView") {
    currentAttendeesRequestId++;
    currentAttendeesSnapshot = "";
    document.getElementById("currentAttendeesAvailability").replaceChildren();
    document.getElementById("currentAttendeesResults").replaceChildren();
  }
}

function openAdminSettings() {
  showView("adminSettingsView");
}
function openScheduleSettings() {
  showView("scheduleSettingsView");
}

window.addEventListener("online", async () => {
  await updateOfflineStatus();
  if (typeof refreshAttendanceContext === "function") {
    refreshAttendanceContext();
  }
  initializeGoogleSignIn();
  if (currentUser && !googleIdToken) {
    beginSessionRestore(currentUser.email);
    return;
  }
  await refreshRosterCache();
  if (currentActiveViewId === "dashboardView") refreshCurrentAttendeesWindow();
});
window.addEventListener("offline", updateOfflineStatus);

function initializeNumericPasswords() {
  document.querySelectorAll(".numeric-password").forEach((input) => {
    input.addEventListener("input", () => {
      const digitsOnly = input.value.replace(/\D/g, "");
      if (input.value !== digitsOnly) input.value = digitsOnly;
    });
  });
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const isVisible = input.type === "text";
      input.type = isVisible ? "password" : "text";
      const labelKey = isVisible ? "showPassword" : "hidePassword";
      button.dataset.i18n = labelKey;
      const icon = button.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-eye", !isVisible);
        icon.classList.toggle("fa-eye-slash", isVisible);
      }
      button.setAttribute("aria-label", translations[currentLang][labelKey]);
      button.setAttribute("title", translations[currentLang][labelKey]);
    });
  });
}

function resetPasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const button = document.querySelector(`[data-password-toggle="${inputId}"]`);
  if (!input || !button) return;
  input.type = "password";
  button.dataset.i18n = "showPassword";
  const icon = button.querySelector("i");
  if (icon) {
    icon.classList.add("fa-eye");
    icon.classList.remove("fa-eye-slash");
  }
  button.setAttribute("aria-label", translations[currentLang].showPassword);
  button.setAttribute("title", translations[currentLang].showPassword);
}
