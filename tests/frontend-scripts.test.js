const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.join(__dirname, "..", "Frontend");
const scriptOrder = [
  "app-state.js",
  "app-i18n.js",
  "app-core.js",
  "app-offline.js",
  "app-views.js",
  "app-auth.js",
  "app-scanner-search.js",
  "app-cards-admin.js",
];

test("loads frontend scripts in dependency order as classic scripts and precaches each file", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(frontendRoot, "sw.js"), "utf8");
  const loadedScripts = Array.from(
    html.matchAll(/<script\b([^>]*?)src="\.\/js\/(app-[^"]+\.js)(?:\?[^"]*)?"([^>]*)><\/script>/g),
  );

  assert.deepEqual(
    loadedScripts.map((match) => match[2]),
    scriptOrder,
    "script order must preserve shared globals and deferred initialization",
  );
  for (const [, before, script, after] of loadedScripts) {
    assert.doesNotMatch(`${before} ${after}`, /\b(?:async|defer|type\s*=\s*["']module)/i);
    assert.equal(fs.existsSync(path.join(frontendRoot, "js", script)), true);
    assert.equal(serviceWorker.includes(`"./js/${script}?v=`), true);
  }
  assert.equal(fs.existsSync(path.join(frontendRoot, "js", "app.js")), false);
});

test("splash and toolbar use the requested loading and inner-icon treatments", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const splash = html.match(/<section id="startupScreen"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(splash, /<h1>Lambas Bible<\/h1>/);
  assert.match(splash, /Made by Church Code Hub/);
  assert.match(splash, /class="loader-bars startup-loader-bars"/);
  assert.equal((splash.match(/<p\b/g) || []).length, 1);
  assert.doesNotMatch(splash, /Loading|جارٍ|startupStatus/);
  assert.match(styles, /\.icon-btn > i\s*\{[^}]*border:\s*1px solid/);
  assert.match(styles, /\.icon-btn\s*\{[^}]*border:\s*0/);
  assert.match(styles, /\.startup-screen\s*\{[\s\S]*?radial-gradient/);
  assert.match(styles, /\.loader-overlay::before/);
});

test("login landing is described and centered with home navigation in the toolbar", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const translations = fs.readFileSync(path.join(frontendRoot, "js", "app-i18n.js"), "utf8");
  const toolbar = html.match(/<header class="top-app-bar">[\s\S]*?<\/header>/)?.[0] || "";

  assert.match(html, /id="loginView" class="login-view"[\s\S]*?class="login-title">Lambas Bible<\/h1>[\s\S]*?data-i18n="loginSub"/);
  assert.match(translations, /loginSub: "يلزم تسجيل الدخول للمتابعة"/);
  assert.match(toolbar, /id="homeBtn"/);
  assert.ok(toolbar.indexOf('id="homeBtn"') < toolbar.indexOf('class="toolbar-menu-wrap"'));
  assert.doesNotMatch(toolbar, /<nav id="toolbarMenu"[\s\S]*?id="homeBtn"/);
  assert.equal((html.match(/id="homeBtn"/g) || []).length, 1);
  assert.match(styles, /\.container:not\(\.is-dashboard-view\)\s*\{[^}]*justify-content:\s*center/);
  assert.match(styles, /\.container:not\(\.is-dashboard-view\)\s*>\s*\[id\$="View"\]\s*\{[^}]*margin-block:\s*auto/);
  assert.match(styles, /\.home-btn\s*\{[^}]*position:\s*static/);
  assert.match(styles, /\.container\s*\{[^}]*position:\s*fixed[^}]*inset-block:\s*var\(--app-bar-height\) 0/);
  assert.match(styles, /\.container\s*\{[^}]*scroll-padding-block:\s*24px/);
  assert.match(styles, /--app-bar-bg:\s*linear-gradient/);
});

test("dashboard layout choices are ordered and aligned with the language direction", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const dashboard = html.match(/<div id="dashboardView"[\s\S]*?<div id="appSettingsView"/)?.[0] || "";
  const choices = Array.from(dashboard.matchAll(/data-dashboard-layout="(one|two|three)"/g), (match) => match[1]);

  assert.deepEqual(choices, ["one", "two", "three"]);
  assert.match(dashboard, /data-dashboard-layout="two"[^>]*aria-pressed="true"/);
  assert.match(styles, /\.dashboard-heading-actions\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(styles, /\.dashboard-layout-switcher\s*\{[^}]*direction:\s*ltr/);
});

test("dashboard view does not use horizontal view-entry animation", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  assert.match(
    styles,
    /#dashboardView\.view-enter-forward,\s*#dashboardView\.view-enter-back\s*\{\s*animation:\s*none;/,
  );
});

test("subviews use a centered responsive column with viewport-aware spacing", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");

  assert.match(views, /id === "loginView" \? "block" : "flex"/);
  assert.match(styles, /#mainContainer > \[id\$="View"\]:not\(#dashboardView\):not\(#loginView\)\s*\{[^}]*width:\s*min\(920px,\s*100%\)[^}]*min-height:\s*calc\(100dvh - 136px\)[^}]*justify-content:\s*center[^}]*margin-inline:\s*auto/);
  assert.match(styles, /#mainContainer > \[id\$="View"\]:not\(#dashboardView\):not\(#loginView\) > h2\s*\{[^}]*font-size:\s*clamp\(22px,\s*3vw,\s*29px\)/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?#mainContainer > \[id\$="View"\]:not\(#dashboardView\):not\(#loginView\)\s*\{[^}]*min-height:\s*calc\(100dvh - 96px\)/);
});

test("dashboard shows all actions in one selectable, full-page grid", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const translations = fs.readFileSync(path.join(frontendRoot, "js", "app-i18n.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(frontendRoot, "sw.js"), "utf8");
  const dashboardStart = html.indexOf('<div id="dashboardView"');
  const dashboardEnd = html.indexOf('<div id="appSettingsView"', dashboardStart);
  const dashboard = html.slice(dashboardStart, dashboardEnd);

  assert.match(dashboard, /class="grid dashboard-actions-grid"[\s\S]*?data-i18n="scanQr"/);
  assert.match(dashboard, /class="grid dashboard-actions-grid"[\s\S]*?data-i18n="searchName"/);
  assert.match(dashboard, /class="grid dashboard-actions-grid"[\s\S]*?showView\('addView'\)/);
  assert.equal((dashboard.match(/class="tile(?: primary)?"/g) || []).length, 10);
  assert.doesNotMatch(dashboard, /<details|<summary/);
  for (const action of [
    "showView('addView')",
    "showView('cardShareView')",
    "openRosterManagement()",
    "openAttendanceReport()",
    "openSheet()",
    "openCurrentAttendeesView()",
    "openScheduleSettings()",
  ]) {
    assert.ok(dashboard.includes(action), `dashboard should retain ${action}`);
  }
  assert.match(html, /id="attendanceSheetType"[\s\S]*?value="both"[\s\S]*?value="attendees"[\s\S]*?value="absents"/);
  assert.match(html, /css\/styles\.css\?v=73/);
  assert.match(serviceWorker, /lambas-bible-shell-v73/);
  assert.match(serviceWorker, /css\/styles\.css\?v=73/);
  assert.equal((dashboard.match(/data-dashboard-layout=/g) || []).length, 3);
  assert.match(dashboard, /onclick="setDashboardLayout\('one'\)"/);
  assert.match(dashboard, /onclick="setDashboardLayout\('two'\)"/);
  assert.match(dashboard, /onclick="setDashboardLayout\('three'\)"/);
  assert.match(dashboard, /id="dashboardWelcomeName"/);
  assert.match(html, /class="toolbar-menu-toggle"[\s\S]*?id="toolbarMenu"[\s\S]*?id="syncNowToolbarButton"[\s\S]*?id="appSettingsToolbarButton"/);
  assert.match(html, /class="toolbar-menu-icon-wrap"[\s\S]*?id="syncNowCount"/);
  assert.match(html, /id="syncMenuBadge"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(styles, /#dashboardView\[data-layout="one"\] \.dashboard-actions-grid/);
  assert.match(styles, /#dashboardView\[data-layout="two"\] \.dashboard-actions-grid|--dashboard-columns:\s*2/);
  assert.match(styles, /#dashboardView\[data-layout="three"\] \.dashboard-actions-grid/);
  assert.match(styles, /\.container\s*\{[^}]*width:\s*100%[^}]*background:\s*transparent/);
  assert.match(styles, /\.container\.is-dashboard-view\s*\{[^}]*max-width:\s*none/);
});

test("people management styles search and uses edit plus confirmed archival actions", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const translations = fs.readFileSync(path.join(frontendRoot, "js", "app-i18n.js"), "utf8");

  assert.match(html, /id="rosterSearchInput"[^>]*class="roster-search"/);
  assert.match(styles, /\.roster-search-wrap\s*\{[\s\S]*?backdrop-filter:/);
  assert.match(views, /function beginRosterPersonEdit\(/);
  assert.match(views, /function deactivateRosterPerson\(person\)/);
  assert.match(views, /window\.confirm\(confirmation\)/);
  assert.match(views, /active:\s*false/);
  assert.doesNotMatch(views, /rosterActiveLabel/);
  assert.match(views, /editRosterPerson/);
  assert.match(translations, /confirmDeleteRosterPerson:/);
  assert.match(translations, /attend(?:ance)? history|سجل الحضور/);
});

test("roster management, attendance trends, and follow-up have dedicated views", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const translations = fs.readFileSync(path.join(frontendRoot, "js", "app-i18n.js"), "utf8");

  assert.match(html, /id="rosterView"[\s\S]*?id="rosterManagementResults"/);
  assert.match(views, /async function loadRosterManagement\(\)/);
  assert.match(views, /apiCall\("update_roster_person"/);
  assert.match(html, /id="trendsTabButton"[\s\S]*?data-i18n="attendanceTrendsTitle"/);
  assert.match(html, /id="trendsTabPanel"[\s\S]*?id="attendanceTrendsResults"/);
  assert.match(views, /apiCall\("get_attendance_trends"/);
  assert.match(html, /onclick="openFollowupView\(\)"/);
  assert.match(html, /id="followupView"[\s\S]*?id="followupResults"/);
  assert.match(views, /function openFollowupView\(\)/);
  assert.doesNotMatch(html + views, /attendanceCorrection|correct_attendance/);
  for (const key of ["manageRoster", "attendanceTrendsTitle"]) {
    assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2);
  }
});

test("request loaders cover the view and allow home navigation while requests settle", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const core = fs.readFileSync(path.join(frontendRoot, "js", "app-core.js"), "utf8");
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");

  assert.match(styles, /\.loader-overlay\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.loader-overlay\s*\{[^}]*inset:\s*0/);
  assert.match(styles, /\.loader-overlay\s*\{[^}]*background-color:\s*var\(--loader-backdrop\)/);
  assert.match(styles, /--loader-backdrop:\s*rgba\(16,\s*25,\s*38,\s*0\.46\)/);
  assert.match(styles, /\.container\s*\{[^}]*scroll-behavior:\s*smooth[^}]*-webkit-overflow-scrolling:\s*touch/);
  assert.doesNotMatch(styles, /\.container\.is-loading\s*>\s*:not\(#loader\)\s*\{[^}]*visibility:\s*hidden/);
  assert.match(styles, /\.container\.is-loading\s*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(views, /function handleHomeNavigation\(\)\s*\{[^}]*userActionRequestCount > 0 \|\| isSyncingOfflineQueue/);
  assert.doesNotMatch(views, /window\.addEventListener\("popstate"[\s\S]*?userActionRequestCount > 0 \|\| isSyncingOfflineQueue/);
  assert.doesNotMatch(views, /function showView\([^)]*\)\s*\{\s*if\s*\(/);
  assert.match(core, /activeApiRequestCount\+\+/);
  assert.match(core, /activeApiRequestCount = Math\.max\(0, activeApiRequestCount - 1\)/);
  assert.match(html, /onclick="updateCurrentAttendees\(\)"/);
  assert.match(html, /id="offlineSyncProgressLane"/);
  assert.match(views, /showCurrentAttendeesSkeleton\(\)/);
  assert.match(views, /if \(currentAttendeesRequestInFlight\) \{[\s\S]*?currentAttendeesRefreshPending = true;[\s\S]*?\}\s*currentAttendeesRequestInFlight = true;/);
  assert.match(views, /currentAttendeesRequestInFlight\) \{[\s\S]*?currentAttendeesRefreshPending = true;/);
  assert.match(views, /finally \{[\s\S]*?currentAttendeesRequestInFlight = false;/);
  assert.match(styles, /\.current-attendees-search\s*\{[^}]*background:/);
});

test("only user-started attendance actions block navigation", async () => {
  const pendingResponses = [];
  const browserContext = vm.createContext({
    window: { LAMBAS_CONFIG: { apiUrl: "https://example.test/api" } },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null, removeItem() {} },
    AbortController,
    setTimeout,
    clearTimeout,
    Blob,
    fetch: () => new Promise((resolve) => pendingResponses.push(resolve)),
  });
  for (const script of ["app-state.js", "app-core.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }

  const scanRequest = browserContext.apiCall("scan");
  const backgroundRequest = browserContext.apiCall("get_attendance_window");
  assert.equal(browserContext.userActionRequestCount, 1);

  pendingResponses[1]({ ok: true, json: async () => ({ success: true }) });
  await backgroundRequest;
  assert.equal(browserContext.userActionRequestCount, 1);

  pendingResponses[0]({ ok: true, json: async () => ({ kind: "success" }) });
  await scanRequest;
  assert.equal(browserContext.userActionRequestCount, 0);
});

test("small API requests use keepalive while oversized payloads do not", async () => {
  const requestOptions = [];
  const browserContext = vm.createContext({
    window: { LAMBAS_CONFIG: { apiUrl: "https://example.test/api" } },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null, removeItem() {} },
    AbortController,
    Blob,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
      requestOptions.push(options);
      return { ok: true, json: async () => ({ success: true }) };
    },
  });
  for (const script of ["app-state.js", "app-core.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }

  await browserContext.apiCall("check_auth", { note: "small request" });
  await browserContext.apiCall("check_auth", { note: "x".repeat(61 * 1024) });
  assert.equal(requestOptions[0].keepalive, true);
  assert.equal(requestOptions[1].keepalive, false);
});

test("read API calls return cached data before revalidating and notify the view", async () => {
  const cached = { success: true, roster: [{ id: "old" }] };
  const fresh = { success: true, roster: [{ id: "new" }] };
  let savedResponse = null;
  let revalidatedResponse = null;
  let requestStarted = false;
  const browserContext = vm.createContext({
    window: { LAMBAS_CONFIG: { apiUrl: "https://example.test/api" } },
    navigator: {},
    sessionStorage: { getItem: () => "", removeItem() {} },
    localStorage: { getItem: () => null, removeItem() {} },
    AbortController,
    Blob,
    setTimeout,
    clearTimeout,
    getCachedApiResponse: async () => cached,
    saveCachedApiResponse: async (_key, response) => { savedResponse = response; },
    fetch: async () => {
      requestStarted = true;
      return { ok: true, json: async () => fresh };
    },
  });
  for (const script of ["app-state.js", "app-core.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.currentUser = { email: "admin@example.com" };

  const result = await browserContext.apiCall("get_roster", {}, (response) => {
    revalidatedResponse = response;
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), cached);
  assert.equal(requestStarted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(savedResponse)), fresh);
  assert.deepEqual(JSON.parse(JSON.stringify(revalidatedResponse)), fresh);
});

test("online attendance uses the scan endpoint and preserves queued action sync", () => {
  const offline = fs.readFileSync(path.join(frontendRoot, "js", "app-offline.js"), "utf8");
  const scanner = fs.readFileSync(path.join(frontendRoot, "js", "app-scanner-search.js"), "utf8");
  const cards = fs.readFileSync(path.join(frontendRoot, "js", "app-cards-admin.js"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(frontendRoot, "sw.js"), "utf8");

  assert.match(offline, /status:\s*"pending"/);
  assert.match(offline, /window\.triggerManualSync\s*=\s*triggerManualSync/);
  assert.match(offline, /registration\.sync\.register\("sync-pending-events"\)/);
  assert.match(offline, /var immediateEventSyncChain = Promise\.resolve\(\)/);
  assert.match(offline, /syncTask = immediateEventSyncChain\.then/);
  assert.match(offline, /syncMode: event\.syncMode \|\| \(navigator\.onLine \? "online" : "offline"\)/);
  assert.match(offline, /event\.syncMode !== "online"/);
  assert.match(scanner, /apiCall\("scan", \{ id \}\)/);
  assert.doesNotMatch(scanner, /enqueueOnlineEventForSync\(\{/);
  assert.match(scanner, /queueOfflineEvent\(\{[\s\S]*?type: "scan"/);
  assert.doesNotMatch(scanner, /beginDelayedAttendanceFeedback|Math\.random\(\)\s*\*\s*1001/);
  assert.match(cards, /showAddedResult\(\);\s*showToast\([\s\S]*?enqueueOnlineEventForSync\(event\)/);
  assert.match(offline, /function getOfflineSyncBatch\([\s\S]*?event\.syncMode !== "online"/);
  assert.match(offline, /events\.filter\(\(event\) => event\.syncMode !== "online"\)/);
  assert.doesNotMatch(cards, /showLoader\("Registering & generating card/);
  assert.match(serviceWorker, /self\.addEventListener\("sync"/);
  assert.match(serviceWorker, /event\.tag === "sync-pending-events"/);
  assert.match(serviceWorker, /action:\s*"sync_offline_events"/);
});

test("toast animation duration follows its configured visible duration", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");

  assert.match(views, /duration = 5000/);
  assert.match(views, /--toast-out-delay/);
  assert.match(styles, /toastOut 0\.25s ease-in var\(--toast-out-delay/);
});

test("home navigation confirms unsaved settings and supports continue or discard", () => {
  const nodes = new Map();
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  nodes.set("settingsExitDialog", dialog);
  const browserContext = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: (id) => nodes.get(id) || null },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    updateOfflineStatus() {},
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-views.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  const navigation = [];
  browserContext.currentActiveViewId = "scheduleSettingsView";
  browserContext.hasUnsavedSettingsChanges = () => true;
  browserContext.discardSettingsChanges = (viewId) => navigation.push(`discard:${viewId}`);
  browserContext.showView = (viewId) => navigation.push(viewId);

  browserContext.handleHomeNavigation();
  assert.equal(dialog.open, true);
  assert.deepEqual(navigation, []);

  browserContext.continueSettingsEditing();
  assert.equal(dialog.open, false);
  assert.deepEqual(navigation, []);

  browserContext.handleHomeNavigation();
  browserContext.discardSettingsAndGoHome();
  assert.equal(dialog.open, false);
  assert.deepEqual(navigation, ["discard:scheduleSettingsView", "dashboardView"]);

  browserContext.currentActiveViewId = "scanView";
  browserContext.hasUnsavedSettingsChanges = () => false;
  browserContext.activeApiRequestCount = 1;
  browserContext.userActionRequestCount = 0;
  browserContext.handleHomeNavigation();
  assert.deepEqual(navigation, ["discard:scheduleSettingsView", "dashboardView", "dashboardView"]);

  browserContext.currentActiveViewId = "addView";
  browserContext.activeApiRequestCount = 0;
  browserContext.userActionRequestCount = 1;
  browserContext.handleHomeNavigation();
  assert.deepEqual(navigation, [
    "discard:scheduleSettingsView",
    "dashboardView",
    "dashboardView",
    "dashboardView",
  ]);
});

test("current attendees provide a compact table, search, and emergency actions", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");

  assert.match(html, /id="currentAttendeesSearch"[^>]*oninput="filterCurrentAttendees\(\)"/);
  assert.match(html, /id="emergencyCheckoutDialog"[^>]*class="attendance-action-dialog"/);
  assert.match(views, /function filterCurrentAttendees\(\)/);
  assert.match(views, /function showEmergencyCheckoutDialog\(person\)/);
  assert.match(views, /async function submitEmergencyCheckout\(event\)/);
  assert.match(views, /current-attendees-action-label/);
  assert.match(styles, /\.current-attendees-row\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(views, /currentAttendeesAdminTime[\s\S]*?currentAttendeesActions/);
  assert.match(styles, /\.current-attendees-row\s*\{[\s\S]*?grid-template-columns:[^;]*3/);
  const responsiveStyles = styles.slice(styles.lastIndexOf("@media (max-width: 480px) {"));
  assert.match(responsiveStyles, /\.current-attendees-header\s*\{[^}]*grid-template-columns:[^;]*1\.2fr/);
  assert.doesNotMatch(styles, /\.current-attendees-header\s*\{\s*display:\s*none/);
  assert.match(styles, /\.current-attendees-table\s*\{[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.attendance-action-dialog::backdrop/);
});

test("attendance window errors preserve the last known open state and retry promptly", async () => {
  let retryDelay = 0;
  const tile = {
    disabled: true,
    classList: { toggle() {} },
    setAttribute() {},
    removeAttribute() {},
  };
  const browserContext = vm.createContext({
    window: {
      addEventListener() {},
      clearTimeout() {},
      setTimeout(_callback, delay) {
        retryDelay = delay;
        return 1;
      },
    },
    document: { getElementById: () => tile },
    navigator: { onLine: true },
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    console: { error() {} },
    updateOfflineStatus() {},
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-views.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.currentUser = { email: "admin@example.com" };
  browserContext.currentActiveViewId = "dashboardView";
  browserContext.currentAttendeesWindowOpen = true;
  browserContext.apiCall = async () => { throw new Error("temporary network failure"); };

  await browserContext.refreshCurrentAttendeesWindow();

  assert.equal(browserContext.currentAttendeesWindowOpen, true);
  assert.equal(tile.disabled, false);
  assert.ok(retryDelay <= 10000);
});

test("current attendees stay closed and show a toast when clicked outside the attendance window", async () => {
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const offline = fs.readFileSync(path.join(frontendRoot, "js", "app-offline.js"), "utf8");
  const i18n = fs.readFileSync(path.join(frontendRoot, "js", "app-i18n.js"), "utf8");
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");

  assert.match(html, /id="currentAttendeesTile"[^>]*onclick="openCurrentAttendeesView\(\)"/);
  assert.match(html, /id="currentAttendeesClosedBadge"[^>]*data-i18n="attendanceWindowClosedBadge"/);
  assert.match(views, /async function openCurrentAttendeesView\(\)/);
  assert.match(views, /if \(!result\.windowOpen\) \{[\s\S]*?showToast\([\s\S]*?return;/);
  assert.match(views, /attendanceWindowCloseMessage\(result\.closeReason\)/);
  assert.match(views, /tile\.classList\.toggle\("is-window-closed", isClosed\)/);
  assert.match(views, /tile\.setAttribute\("aria-disabled", String\(!navigator\.onLine\)\)/);
  assert.match(offline, /currentAttendeesTile\.disabled = !navigator\.onLine/);
  assert.doesNotMatch(offline, /currentAttendeesTile\.disabled =\s*!navigator\.onLine \|\| !currentAttendeesWindowOpen/);
  assert.match(fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8"), /\.tile\.is-window-closed\s*\{[^}]*filter:\s*grayscale/);
  for (const key of ["attendanceWindowBeforeMeeting", "attendanceWindowAfterMeeting", "attendanceWindowNoMeetingToday"]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) || []).length, 2);
  }

  const tile = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {},
    removeAttribute() {},
  };
  const messages = [];
  const openedViews = [];
  const browserContext = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: (id) => id === "currentAttendeesTile" ? tile : null },
    navigator: { onLine: true },
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    showView: (id) => openedViews.push(id),
    showToast: (message) => messages.push(message),
    updateOfflineStatus() {},
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-views.js"]) {
    vm.runInContext(fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"), browserContext);
  }
  browserContext.showToast = (message) => messages.push(message);
  browserContext.showView = (id) => openedViews.push(id);
  browserContext.currentActiveViewId = "dashboardView";
  browserContext.apiCall = async () => ({
    success: true,
    windowOpen: false,
    closeReason: "after_meeting",
  });
  await browserContext.openCurrentAttendeesView();
  assert.deepEqual(openedViews, []);
  assert.match(messages[0], /لا يمكن فتح الحضور الحالي/);
  assert.match(messages[0], /انتهى وقت إدارة الحضور/);

  browserContext.apiCall = async () => ({ success: true, windowOpen: true });
  await browserContext.openCurrentAttendeesView();
  assert.deepEqual(openedViews, ["currentAttendeesView"]);
});

test("saving schedule settings returns to the dashboard", async () => {
  const fields = new Map();
  for (const [id, value] of [
    ["cfgStartTime", "10:00"],
    ["cfgEndTime", "12:00"],
    ["cfgAcceptedDelay", "15"],
  ]) {
    fields.set(id, { value });
  }
  for (let day = 0; day <= 6; day++) {
    fields.set(`day${day}`, { checked: day === 0 });
  }
  const browserContext = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: (id) => fields.get(id) || null },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    updateOfflineStatus() {},
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-views.js", "app-cards-admin.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  const navigation = [];
  browserContext.apiCall = async () => ({ success: true, message: "Saved" });
  browserContext.showLoader = () => {};
  browserContext.hideLoader = () => {};
  browserContext.showToast = () => {};
  browserContext.showView = (viewId) => navigation.push(viewId);

  await browserContext.saveScheduleSettings();

  assert.deepEqual(navigation, ["dashboardView"]);
});

test("attendance sheet action remains separate from display filters and sync queue opens without syncing", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const offline = fs.readFileSync(path.join(frontendRoot, "js", "app-offline.js"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "..", "Backend", "Code.js"), "utf8");

  assert.match(html, /id="attendanceStatusFilter"/);
  assert.match(html, /id="attendanceSearchAgainButton"/);
  assert.match(html, /attendancePersonQuery[\s\S]*?event\.key === 'Enter'/);
  assert.match(html, /id="attendanceSheetResultDialog"/);
  assert.match(views, /function filterAttendanceReport\(\)/);
  assert.match(views, /list\.hidden = Boolean\(query\);[\s\S]*?searchResult\.hidden = !query;/);
  assert.match(views, /if \(!query\) \{[\s\S]*?list\.appendChild\(panel\);[\s\S]*?\n        \}/);
  assert.match(views, /function startAttendanceSearchAgain\(\)/);
  assert.match(views, /attendanceSummaryAttended\.replace\("\{count\}", report\.count\)/);
  assert.match(views, /attendanceSummaryAbsent\.replace\("\{count\}", absentCount\)/);
  assert.match(views, /attendanceSummaryAll[\s\S]*?\.replace\("\{attended\}", report\.count\)[\s\S]*?\.replace\("\{absent\}", absentCount\)/);
  assert.match(views, /function showAttendanceSheetResult\(report\)/);
  assert.match(offline, /async function syncFromToolbar\(\)[\s\S]*?await openOfflineQueueView\(\);[\s\S]*?\n      }/);
  assert.doesNotMatch(
    offline.match(/async function syncFromToolbar\(\)[\s\S]*?\n      }/)[0],
    /syncOfflineQueue/,
  );
  assert.match(offline, /toolbarButton\.disabled = isSyncingOfflineQueue;/);
  assert.match(backend, /exportedPeople\.forEach\(\(person\) => reportRows\.push\(\[/);
  assert.doesNotMatch(backend, /attendees\.forEach\(\(person\) => reportRows\.push\(\[/);
});

test("split classic scripts retain shared state and inline-handler functions", () => {
  const browserContext = vm.createContext({
    window: { LAMBAS_CONFIG: {}, addEventListener() {} },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
  });

  for (const script of scriptOrder) {
    const source = fs.readFileSync(path.join(frontendRoot, "js", script), "utf8");
    vm.runInContext(source, browserContext, { filename: script });
  }

  assert.equal(vm.runInContext("typeof translations", browserContext), "object");
  assert.equal(vm.runInContext("typeof currentUser", browserContext), "object");
  assert.equal(vm.runInContext("typeof executeSearch", browserContext), "function");
  assert.equal(vm.runInContext("typeof openAppSettings", browserContext), "function");
  assert.equal(vm.runInContext("typeof saveScheduleSettings", browserContext), "function");
});

test("attendance report dates exclude future values and identify today", () => {
  const browserContext = vm.createContext({
    window: { addEventListener() {} },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    updateOfflineStatus() {},
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-views.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }

  const result = vm.runInContext(`(() => {
    currentLang = "en";
    const today = "2026-10-20";
    return {
      dates: getPastAttendanceDates(
        ["2026-10-22", "2026-10-19", "2026-10-20", "2026-02-30"],
        today,
      ),
      todayLabel: formatAttendanceDateOption(today, today),
    };
  })()`, browserContext);

  assert.deepEqual(Array.from(result.dates), ["2026-10-19", "2026-10-20"]);
  assert.match(result.todayLabel, /^Today · /);
});

test("restores the Google sign-in token from local storage", () => {
  const storedValues = new Map([["google_id_token", "saved-token"]]);
  const browserContext = vm.createContext({
    window: {
      LAMBAS_CONFIG: {},
      matchMedia: () => ({ matches: true }),
    },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: {
      getItem: (key) => storedValues.get(key) || null,
      setItem: (key, value) => storedValues.set(key, value),
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(frontendRoot, "js", "app-state.js"), "utf8"),
    browserContext,
    { filename: "app-state.js" },
  );

  assert.equal(vm.runInContext("googleIdToken", browserContext), "saved-token");
  assert.equal(vm.runInContext("currentThemeMode", browserContext), "light");
});

test("silent Google restore keeps the saved profile visible when account selection is unavailable", () => {
  let promptCallback = null;
  const savedUser = { email: "admin@example.com", name: "Admin" };
  const browserContext = vm.createContext({
    window: {
      addEventListener() {},
      LAMBAS_CONFIG: {},
      google: {
        accounts: {
          id: {
            prompt(callback) { promptCallback = callback; },
          },
        },
      },
    },
    google: {
      accounts: {
        id: {
          prompt(callback) { promptCallback = callback; },
        },
      },
    },
    navigator: { onLine: true },
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  for (const script of ["app-state.js", "app-auth.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.currentUser = savedUser;
  let loaderShown = false;
  let loginViewShown = false;
  browserContext.showLoader = () => { loaderShown = true; };
  browserContext.showView = (view) => { loginViewShown = view === "loginView"; };

  browserContext.beginSessionRestore(savedUser.email);
  promptCallback({ isNotDisplayed: () => true });

  assert.equal(browserContext.currentUser, savedUser);
  assert.equal(loaderShown, false);
  assert.equal(loginViewShown, false);
  assert.equal(browserContext.isSilentSessionRestore, false);
});

test("first-run tutorial pins its guide, locks unrelated actions, and advances explicitly", () => {
  const auth = fs.readFileSync(path.join(frontendRoot, "js", "app-auth.js"), "utf8");
  const tutorial = auth.match(/const firstRunTutorialSteps =[\s\S]*?\n      function logoutUser/)?.[0] || "";
  const interactions = auth.match(/function showFirstRunTutorial\(\)[\s\S]*?\n      function finishFirstRunTutorial/)?.[0] || "";
  const clickHandler = auth.match(/function handleFirstRunTutorialClick\([\s\S]*?\n      function handleFirstRunTutorialKeydown/)?.[0] || "";
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const scanner = fs.readFileSync(path.join(frontendRoot, "js", "app-scanner-search.js"), "utf8");
  const core = fs.readFileSync(path.join(frontendRoot, "js", "app-core.js"), "utf8");

  assert.match(tutorial, /target: "tutorialScanAction"/);
  assert.match(tutorial, /target: "tutorialSearchAction"/);
  assert.match(tutorial, /target: "tutorialAddAction"/);
  assert.match(tutorial, /target: "appSettingsToolbarButton"/);
  assert.match(tutorial, /var tutorialDemoActions = new Set\(\)/);
  assert.match(tutorial, /function replayFirstRunTutorial\(\)[\s\S]*?firstRunTutorialStep = 0;[\s\S]*?tutorialDemoActions = new Set\(\);[\s\S]*?showFirstRunTutorial\(\)/);
  assert.match(tutorial, /FIRST_RUN_TUTORIAL_KEY/);
  assert.match(tutorial, /localStorage\.getItem\(FIRST_RUN_TUTORIAL_KEY\) === "true"/);
  assert.match(tutorial, /localStorage\.setItem\(FIRST_RUN_TUTORIAL_KEY, "true"\)/);
  assert.match(tutorial, /handleFirstRunTutorialClick/);
  assert.match(tutorial, /function replayFirstRunTutorial\(\)/);
  assert.match(html, /id="tutorialReplayButton"[^>]*onclick="replayFirstRunTutorial\(\)"/);
  assert.match(html, /data-i18n="tutorialReplay"/);
  assert.doesNotMatch(interactions, /apiCall|enqueueOnlineEventForSync|queueOfflineEvent|getCachedRoster|refreshAttendanceContext|refreshRosterCache/);
  assert.match(clickHandler, /event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\)/);
  assert.match(clickHandler, /event\.target\.closest\?\.\("#tutorialNextButton"\)/);
  assert.match(clickHandler, /target\.contains\(event\.target\)/);
  assert.match(tutorial, /function nextFirstRunTutorialStep\(\)/);
  assert.match(tutorial, /firstRunTutorialStep\+\+;\s*renderFirstRunTutorialStep\(\)/);
  assert.doesNotMatch(tutorial, /positionFirstRunTutorial/);
  assert.match(tutorial, /if \(isFirstRunTutorialActive\(\)\) \{\s*tutorialDeferredLoginRefreshEmail[\s\S]*?return;/);
  assert.match(tutorial, /refreshRosterCache\(\);\s*refreshAttendanceContext\(\);/);
  assert.match(views, /if \(typeof isFirstRunTutorialActive !== "function" \|\| !isFirstRunTutorialActive\(\)\) \{[\s\S]*?refreshCurrentAttendeesWindow\(\)/);
  assert.doesNotMatch(views, /tutorialCameraPaused/);
  assert.doesNotMatch(scanner, /function onScanSuccess\(text\) \{\s*if \(typeof isFirstRunTutorialActive/);
  assert.match(scanner, /const simulatedContext = currentAttendanceContext/);
  assert.match(scanner, /translateText\("tutorialNotSaved"\)/);
  assert.match(scanner, /function showAttendanceResult\(result, fromNameSearch\)[\s\S]*?if \(fromNameSearch\) \{\s*renderResult\(result, true\)/);
  assert.match(scanner, /async function processScannedText[\s\S]*?showToast\([\s\S]*?"error"\)/);
  const addStudent = fs.readFileSync(path.join(frontendRoot, "js", "app-cards-admin.js"), "utf8");
  assert.match(addStudent, /isFirstRunTutorialActive\(\)[\s\S]*?tutorialNotSaved/);
  assert.match(core, /tutorialDialog\?\.classList\.contains\("is-active"\)/);
  assert.match(html, /id="firstRunTutorial"/);
  assert.doesNotMatch(html, /tutorialScrim|tutorialSpotlight/);
  assert.match(html, /id="tutorialFocusWash"[^>]*class="tutorial-focus-wash"/);
  assert.match(html, /id="tutorialScanAction"/);
  assert.match(html, /id="tutorialSearchAction"/);
  assert.match(html, /id="tutorialAddAction"/);
  assert.match(html, /id="tutorialNextButton"[^>]*onclick="nextFirstRunTutorialStep\(\)"/);
  assert.match(html, /id="tutorialNextLabel"[^>]*data-i18n="tutorialNext"/);
  assert.doesNotMatch(html, /tutorial-skip|onclick="skipFirstRunTutorial/);
  assert.match(html, /id="firstRunTutorial"[^>]*aria-modal="true"/);
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  assert.match(styles, /body\.tutorial-active :is\(button, input, select, textarea, a, \[tabindex\]\):not\(\.tutorial-target-highlight\):not\(#tutorialNextButton\)/);
  assert.match(html, /tutorial-focus-shade-top[\s\S]*?tutorial-focus-shade-left[\s\S]*?tutorial-focus-shade-right[\s\S]*?tutorial-focus-shade-bottom/);
  assert.match(styles, /\.tutorial-focus-wash[\s\S]*?inset:\s*0[\s\S]*?pointer-events:\s*none/);
  assert.match(styles, /\.tutorial-focus-shade\s*\{[^}]*background:\s*rgba\(5,\s*10,\s*20,\s*0\.52\)/);
  assert.match(auth, /function updateFirstRunTutorialFocus\(\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?--tutorial-cutout-top/);
  assert.match(auth, /window\.addEventListener\("scroll", updateFirstRunTutorialFocus, true\)/);
  assert.match(styles, /\.tutorial-target-highlight\s*\{[^}]*outline:\s*2px solid/);
  assert.doesNotMatch(styles.match(/\.tutorial-target-highlight\s*\{[^}]*\}/)?.[0] || "", /background:\s*color-mix/);
  assert.match(styles, /\.tutorial-dialog\s*\{[^}]*position:\s*fixed[^}]*top:\s*max/);
  assert.doesNotMatch(styles.match(/\.tutorial-dialog\s*\{[^}]*\}/)?.[0] || "", /bottom:\s*[^;]*target/);
  assert.match(styles, /@media \(max-width: 480px\) \{[\s\S]*?\.tutorial-dialog/);
  assert.match(auth, /loader\.parentElement !== document\.body\) document\.body\.appendChild\(loader\)/);
});

test("offline fuzzy name search mirrors backend matching and events can sync in any order", () => {
  const browserContext = vm.createContext({
    window: {},
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  vm.runInContext("currentLang = 'en'", browserContext);

  const result = vm.runInContext(`(() => {
    const account = "admin@example.com";
    const queue = [
      { eventId: "scan-1", type: "scan", queuedBy: account },
      { eventId: "scan-2", type: "scan", queuedBy: account, timestamp: "2026-10-21T10:00:00.000Z" },
      { eventId: "add-1", type: "add_student", queuedBy: account },
      { eventId: "scan-3", type: "scan", queuedBy: account },
      { eventId: "online-action", type: "scan", queuedBy: account, syncMode: "online" },
      { eventId: "other-account", type: "scan", queuedBy: "other@example.com" },
    ];
    const roster = [
      { id: "001", name: "Attendee One", qrId: "encrypted-001" },
      { id: "002", name: "Attendee Two" },
    ];
    return {
      foundName: findCachedPersonName([{ id: "001", name: "Attendee One" }], "001"),
      foundQrName: findCachedPersonName(roster, "encrypted-001"),
      missingName: findCachedPersonName([{ id: "1", name: "Attendee One" }], "unknown"),
      exactCachedSearch: searchCachedRoster(roster, "Attendee One"),
      fuzzyCachedSearch: searchCachedRoster(roster, "Attendee Onew"),
      individualLater: getOfflineSyncBatch(queue, "scan-2", "", account),
      individualFirst: getOfflineSyncBatch(queue, "scan-1", "", account),
      scanGroup: getOfflineSyncBatch(queue, "", "scan", account),
      addGroup: getOfflineSyncBatch(queue, "", "add_student", account),
      timestamp: getOfflineSyncBatch(queue, "scan-2", "", account)[0].timestamp,
      addDescription: offlineEventDescription({
        type: "add_student", name: "New Attendee", attendIfOpen: false,
      }),
    };
  })()`, browserContext);

  assert.equal(result.foundName, "Attendee One");
  assert.equal(result.foundQrName, "Attendee One");
  assert.equal(result.missingName, "");
  assert.equal(result.exactCachedSearch.status, "exact_match");
  assert.equal(result.exactCachedSearch.id, "001");
  assert.equal(result.fuzzyCachedSearch.status, "suggestions");
  assert.deepEqual(Array.from(result.fuzzyCachedSearch.matches, (person) => person.id), ["001"]);
  assert.deepEqual(Array.from(result.individualLater, (event) => event.eventId), ["scan-2"]);
  assert.deepEqual(Array.from(result.individualFirst, (event) => event.eventId), ["scan-1"]);
  assert.deepEqual(Array.from(result.scanGroup, (event) => event.eventId), ["scan-1", "scan-2", "scan-3"]);
  assert.deepEqual(Array.from(result.addGroup, (event) => event.eventId), ["add-1"]);
  assert.equal(result.timestamp, "2026-10-21T10:00:00.000Z");
  assert.match(result.addDescription, /New Attendee/);
  assert.match(result.addDescription, /Do not mark attendance/);
});

test("online attendance displays the direct backend response in a toast", async () => {
  const feedback = [];
  const calls = [];
  const backendResponse = {
    kind: "late",
    title: "تم الحضور - متأخر",
    name: "Attendee Name",
    message: "مقدار التأخير: 5 دقيقة",
  };
  const browserContext = vm.createContext({
    window: {},
    navigator: { onLine: true },
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null, setItem() {} },
    crypto: require("node:crypto").webcrypto,
    Intl,
    Date,
    Promise,
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js", "app-scanner-search.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.currentLang = "en";
  browserContext.currentUser = { email: "admin@example.com" };
  browserContext.googleIdToken = "signed-in";
  browserContext.renderResult = (result) => feedback.push(result);
  browserContext.translateText = (message) => ({
    "تم الحضور - متأخر": "Late arrival",
    "مقدار التأخير: 5 دقيقة": "Delay: 5 minutes",
  }[message] || message);
  browserContext.getCachedRoster = async () => [];
  browserContext.refreshAttendanceContext = async () => null;
  const toast = {
    isConnected: true,
    dataset: {},
    classList: { remove() {}, add(type) { toast.type = type; } },
  };
  browserContext.showToast = (message, type) => {
    toast.dataset.message = message;
    toast.textContent = message;
    toast.type = type;
    return toast;
  };
  browserContext.apiCall = async (action, payload) => {
    calls.push({ action, payload });
    return backendResponse;
  };

  await browserContext.processAttendanceId(
    "qr-token",
    true,
    "Attendee Name",
    { eventId: "attendance-event-0001", timestamp: "2026-10-21T10:00:00.000Z" },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { action: "scan", payload: { id: "qr-token" } },
  ]);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].kind, "late");
  assert.equal(feedback[0].name, "Attendee Name");
  assert.equal(toast.dataset.message, "Attendee Name · Late arrival · Delay: 5 minutes");
  assert.equal(toast.textContent, toast.dataset.message);
  assert.equal(toast.type, "success");
});

test("attendance toast is updated with the backend result and severity", () => {
  const browserContext = vm.createContext({
    window: {},
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js", "app-scanner-search.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.translateText = (message) => message;
  const removedClasses = [];
  const addedClasses = [];
  const toast = {
    isConnected: true,
    dataset: {},
    classList: {
      remove: (...classes) => removedClasses.push(...classes),
      add: (className) => addedClasses.push(className),
    },
  };

  browserContext.updateAttendanceToast(
    toast,
    {
      kind: "late",
      name: "Attendee Name",
      title: "تم الحضور - متأخر",
      message: "مقدار التأخير: 5 دقيقة",
    },
    { personName: "" },
    "fallback",
    "success",
  );

  assert.equal(toast.dataset.message, "Attendee Name · تم الحضور - متأخر · مقدار التأخير: 5 دقيقة");
  assert.equal(toast.textContent, toast.dataset.message);
  assert.deepEqual(removedClasses, ["success", "info", "error"]);
  assert.deepEqual(addedClasses, ["success"]);
});

test("attendance result is predicted locally from the saved schedule and check-in state", () => {
  const browserContext = vm.createContext({
    window: {},
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null, setItem() {} },
    Intl,
    Date,
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js", "app-scanner-search.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  browserContext.currentUser = { email: "admin@example.com" };
  browserContext.currentAttendanceContext = {
    success: true,
    sessionDate: "2026-10-19",
    spreadsheetTimeZone: "UTC",
    scriptTimeZone: "UTC",
    settings: {
      startTime: "10:00",
      endTime: "12:00",
      acceptedDelay: 15,
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
    },
    attendance: [
      {
        id: "2",
        name: "Bob",
        checkinTime: Date.parse("2026-10-19T10:00:00.000Z"),
        checkedOut: false,
      },
      {
        id: "3",
        name: "Chris",
        checkinTime: Date.parse("2026-10-19T10:00:00.000Z"),
        checkedOut: true,
      },
    ],
  };

  const result = vm.runInContext(`(() => {
    const first = predictAttendanceResult("1", {
      timestamp: "2026-10-19T10:20:00.000Z",
      personName: "Alice",
    });
    const checkout = predictAttendanceResult("2", {
      timestamp: "2026-10-19T11:35:00.000Z",
      personName: "Bob",
    });
    const checkedOut = predictAttendanceResult("3", {
      timestamp: "2026-10-19T11:35:00.000Z",
      personName: "Chris",
    });
    return { first, checkout, checkedOut };
  })()`, browserContext);

  assert.equal(result.first.kind, "late");
  assert.equal(result.first.title, "تم الحضور - متأخر");
  assert.equal(result.first.message, "مقدار التأخير: 5 دقيقة");
  assert.equal(result.checkout.kind, "out");
  assert.equal(result.checkout.title, "تم تسجيل الانصراف!");
  assert.match(result.checkout.message, /^وقت الانصراف:/);
  assert.equal(result.checkedOut.kind, "warn");
  assert.equal(result.checkedOut.title, "مسجّل حضور وانصراف!");
});

test("online background events remain serialized in action order", async () => {
  const browserContext = vm.createContext({
    window: {},
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
    setTimeout,
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  const order = await vm.runInContext(`(() => {
    const steps = [];
    queueOfflineEvent = async (event) => {
      steps.push("saved:" + event.eventId);
      return event;
    };
    syncQueuedEventImmediately = async (event) => {
      steps.push("sync-start:" + event.eventId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      steps.push("sync-end:" + event.eventId);
      return event;
    };
    return Promise.all([
      enqueueOnlineEventForSync({ eventId: "first" }),
      enqueueOnlineEventForSync({ eventId: "second" }),
    ]).then(() => steps);
  })()`, browserContext);

  assert.deepEqual(
    Array.from(order).filter((step) => step.startsWith("sync-")),
    ["sync-start:first", "sync-end:first", "sync-start:second", "sync-end:second"],
  );
  assert.deepEqual(
    Array.from(order).filter((step) => step.startsWith("saved:")),
    ["saved:first", "saved:second"],
  );
  assert.ok(
    Array.from(order).indexOf("saved:second") < Array.from(order).indexOf("sync-end:first"),
    "later events should be persisted while the earlier request is syncing",
  );
});

test("saved offline queue actions remain deletable when offline", () => {
  const offline = fs.readFileSync(path.join(frontendRoot, "js", "app-offline.js"), "utf8");
  const deletion = offline.match(/async function deleteQueuedOfflineEvent\(eventId\)[\s\S]*?\n      \}/)?.[0] || "";
  const rendering = offline.match(/async function renderOfflineQueue\(\)[\s\S]*?\n      \}/)?.[0] || "";

  assert.match(rendering, /deleteQueuedOfflineEvent\(event\.eventId\)/);
  assert.match(deletion, /removeOfflineEvent\(eventId\)/);
  assert.doesNotMatch(deletion, /navigator\.onLine/);
});
