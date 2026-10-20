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

test("dashboard view does not use horizontal view-entry animation", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  assert.match(
    styles,
    /#dashboardView\.view-enter-forward,\s*#dashboardView\.view-enter-back\s*\{\s*animation:\s*none;/,
  );
});

test("request loaders cover the view and prevent navigation until requests settle", () => {
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const core = fs.readFileSync(path.join(frontendRoot, "js", "app-core.js"), "utf8");
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");

  assert.match(styles, /\.loader-overlay\s*\{[^}]*position:\s*absolute/);
  assert.match(styles, /\.loader-overlay\s*\{[^}]*inset:\s*0/);
  assert.match(styles, /\.container\.is-loading\s*\{[^}]*overflow:\s*hidden/);
  assert.match(views, /function handleHomeNavigation\(\)\s*\{[^}]*activeApiRequestCount > 0 \|\| isSyncingOfflineQueue/);
  assert.match(views, /window\.addEventListener\("popstate"[\s\S]*?activeApiRequestCount > 0 \|\| isSyncingOfflineQueue/);
  assert.doesNotMatch(views, /function showView\([^)]*\)\s*\{\s*if\s*\(/);
  assert.match(core, /activeApiRequestCount\+\+/);
  assert.match(core, /activeApiRequestCount = Math\.max\(0, activeApiRequestCount - 1\)/);
  assert.match(html, /onclick="updateCurrentAttendees\(\)"/);
  assert.match(html, /id="offlineSyncProgressLane"/);
  assert.match(views, /showCurrentAttendeesSkeleton\(\)/);
  assert.match(styles, /\.current-attendees-search\s*\{[^}]*background:/);
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
});

test("current attendees provide search, three-column actions, and an emergency dialog", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const views = fs.readFileSync(path.join(frontendRoot, "js", "app-views.js"), "utf8");
  const styles = fs.readFileSync(path.join(frontendRoot, "css", "styles.css"), "utf8");

  assert.match(html, /id="currentAttendeesSearch"[^>]*oninput="filterCurrentAttendees\(\)"/);
  assert.match(html, /id="emergencyCheckoutDialog"[^>]*class="attendance-action-dialog"/);
  assert.match(views, /function filterCurrentAttendees\(\)/);
  assert.match(views, /function showEmergencyCheckoutDialog\(person\)/);
  assert.match(views, /async function submitEmergencyCheckout\(event\)/);
  assert.match(views, /currentAttendeesAdminTime[\s\S]*?currentAttendeesActions/);
  assert.match(styles, /\.current-attendees-row\s*\{[\s\S]*?grid-template-columns:[^;]*3/);
  assert.match(styles, /\.attendance-action-dialog::backdrop/);
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
  assert.match(html, /id="attendanceSheetResultDialog"/);
  assert.match(views, /function filterAttendanceReport\(\)/);
  assert.match(views, /function showAttendanceSheetResult\(report\)/);
  assert.match(offline, /async function syncFromToolbar\(\)[\s\S]*?await openOfflineQueueView\(\);[\s\S]*?\n      }/);
  assert.doesNotMatch(
    offline.match(/async function syncFromToolbar\(\)[\s\S]*?\n      }/)[0],
    /syncOfflineQueue/,
  );
  assert.match(backend, /people\.forEach\(\(person\) => reportRows\.push\(\[/);
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

test("offline name lookup and selected sync batches preserve queue order", () => {
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
      { eventId: "scan-2", type: "scan", queuedBy: account },
      { eventId: "add-1", type: "add_student", queuedBy: account },
      { eventId: "scan-3", type: "scan", queuedBy: account },
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
      fuzzyCachedSearch: searchCachedRoster(roster, "Attendee On"),
      individualLater: getOfflineSyncBatch(queue, "scan-2", "", account),
      individualFirst: getOfflineSyncBatch(queue, "scan-1", "", account),
      scanGroup: getOfflineSyncBatch(queue, "", "scan", account),
      addGroupBlocked: getOfflineSyncBatch(queue, "", "add_student", account),
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
  assert.equal(result.individualLater, null);
  assert.deepEqual(Array.from(result.individualFirst, (event) => event.eventId), ["scan-1"]);
  assert.deepEqual(Array.from(result.scanGroup, (event) => event.eventId), ["scan-1", "scan-2"]);
  assert.equal(result.addGroupBlocked, null);
  assert.match(result.addDescription, /New Attendee/);
  assert.match(result.addDescription, /Do not mark attendance/);
});
