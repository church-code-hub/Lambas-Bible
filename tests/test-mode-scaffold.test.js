const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const testModeRoot = path.join(root, "TestMode");
const backendPath = path.join(testModeRoot, "Backend", "Code.js");
const backendSource = fs.readFileSync(backendPath, "utf8");
const productionEntrySource = fs.readFileSync(
  path.join(root, "Frontend", "js", "test-mode-entry.js"),
  "utf8",
);

function createFrontendTestContext(storageValues = new Map(), overrides = {}) {
  const timers = new Map();
  let nextTimerId = 1;
  const storage = {
    getItem(key) {
      return storageValues.has(key) ? storageValues.get(key) : null;
    },
    setItem(key, value) {
      storageValues.set(key, String(value));
    },
    removeItem(key) {
      storageValues.delete(key);
    },
  };
  const window = {
    LAMBAS_TEST_STORAGE_READY: true,
    LAMBAS_CONFIG: {},
    addEventListener() {},
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    ...overrides.window,
  };
  const context = vm.createContext({
    window,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      ...overrides.document,
    },
    navigator: { onLine: true, ...overrides.navigator },
    localStorage: storage,
    sessionStorage: storage,
    console: { warn() {}, error() {}, log() {} },
    ...overrides.globals,
  });
  return { context, storageValues, timers };
}

function loadFrontendScripts(context, scripts) {
  for (const script of scripts) {
    vm.runInContext(
      fs.readFileSync(path.join(testModeRoot, "Frontend", "js", script), "utf8"),
      context,
      { filename: script },
    );
  }
}

function createBackendContext({
  enabled = "true",
  spreadsheetId = "test-spreadsheet",
  productionSpreadsheetId = "production-spreadsheet",
  marker = "LAMBAS_TEST_ONLY",
  allowlist = ["Tester@Example.com"],
  whatsappConsentRows = [],
  whatsappRosterRows = [],
} = {}) {
  const propertyValues = {
    TEST_MODE_ENABLED: enabled,
    TEST_SPREADSHEET_ID: spreadsheetId,
    PRODUCTION_SPREADSHEET_ID: productionSpreadsheetId,
    TEST_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    TEST_QR_SECRET_KEY: "test-only-secret",
    TEST_MODE_PASSWORD: "test-password-only-for-tests",
    TEST_WHATSAPP_APPROVED_TEMPLATE_NAMES:
      '{"qr_unsent":"qr-template","checkout_all":"checkout-template","birthday":"approved-test-template"}',
  };
  const openedSpreadsheetIds = [];
  const markerSheet = {
    getRange: () => ({ getValue: () => marker }),
  };
  const testSpreadsheet = {
    getSheetByName: (name) => {
      if (name === "_TEST_MODE") return markerSheet;
      if (name === "Roster") {
        return {
          getLastRow: () => whatsappRosterRows.length,
          getLastColumn: () => 6,
          getRange: (row, column, rowCount, columnCount) => ({
            getValues: () =>
              Array.from({ length: rowCount }, (_, rowOffset) =>
                Array.from({ length: columnCount }, (_, columnOffset) =>
                  whatsappRosterRows[row - 1 + rowOffset]?.[
                    column - 1 + columnOffset
                  ] ?? "",
                ),
              ),
          }),
        };
      }
      if (name === "WhatsApp Consent") {
        return {
          getLastRow: () => whatsappConsentRows.length,
          getDataRange: () => ({ getValues: () => whatsappConsentRows }),
        };
      }
      return null;
    },
    getOwner: () => ({ getEmail: () => "owner@example.com" }),
  };
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...propertyValues }),
        getProperty: (key) => propertyValues[key] || null,
        setProperty: (key, value) => {
          propertyValues[key] = value;
        },
        deleteProperty: (key) => {
          delete propertyValues[key];
        },
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        openedSpreadsheetIds.push(id);
        return testSpreadsheet;
      },
      create: () => {
        throw new Error("Only the explicit temporary export may create a sheet.");
      },
      getActiveSpreadsheet: () => {
        throw new Error("Active spreadsheet access is forbidden in Test Mode.");
      },
    },
    DriveApp: {
      getFolderById: () => ({
        getDescription: () => "LAMBAS_TEST_ONLY",
      }),
      getFileById: () => ({ moveTo() {}, setTrashed() {} }),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        setMimeType: () => JSON.parse(content),
      }),
    },
    console: { error() {}, warn() {}, log() {} },
    openedSpreadsheetIds,
  };
  context.scriptProperties = propertyValues;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(testModeRoot, "Backend", "TestModeConfig.gs"),
      "utf8",
    ),
    context,
  );
  vm.runInContext(backendSource, context);
  vm.runInContext(
    `TEST_MODE_ALLOWED_EMAILS.splice(0, TEST_MODE_ALLOWED_EMAILS.length, ...${JSON.stringify(allowlist)});`,
    context,
  );
  const getTestSpreadsheet = context.getTestSpreadsheet_;
  context.testSpreadsheetCalls = 0;
  context.getTestSpreadsheet_ = function () {
    context.testSpreadsheetCalls += 1;
    return getTestSpreadsheet();
  };
  context.verifyGoogleIdToken_ = (token) => {
    if (token === "invalid-token") {
      return {
        success: false,
        code: "AUTH_INVALID",
        message: "Invalid token",
      };
    }
    return {
      success: true,
      email: token === "test-token"
        ? " tESTER@example.com "
        : "outsider@example.com",
    };
  };
  context.isEmailAllowed = () => {
    throw new Error("Non-allowlisted identity reached application authorization.");
  };
  return context;
}

function post(context, action, idToken) {
  return context.doPost({
    postData: { contents: JSON.stringify({ action, idToken }) },
  });
}

test("server-side allowlist trims and ignores case; outsider is denied", () => {
  const context = createBackendContext({
    allowlist: ["  tester@example.com  "],
  });
  const allowed = post(context, "check_test_access", "test-token");

  assert.equal(allowed.success, true);
  assert.equal(allowed.authorized, true);
  assert.equal(allowed.email, " tESTER@example.com ");
  assert.deepEqual(context.openedSpreadsheetIds, ["test-spreadsheet"]);

  const denied = post(context, "check_test_access", "outsider-token");
  assert.equal(denied.code, "TEST_MODE_ACCESS_DENIED");
  assert.equal(denied.authorized, false);
});

test("direct application API calls, including check_auth, enforce the allowlist", () => {
  const context = createBackendContext();
  for (const action of ["scan", "check_auth", "get_roster"]) {
    const denied = post(context, action, "outsider-token");
    assert.equal(denied.code, "TEST_MODE_ACCESS_DENIED", action);
    assert.equal(denied.authorized, false, action);
  }
  const getDenied = context.doGet({
    parameter: { action: "search", idToken: "outsider-token" },
  });
  assert.equal(getDenied.code, "TEST_MODE_ACCESS_DENIED");
});

test("invalid and unauthorized callers are rejected before spreadsheet access", () => {
  const context = createBackendContext();
  const invalidPost = post(context, "scan", "invalid-token");
  assert.equal(invalidPost.code, "AUTH_INVALID");

  const unauthorizedPost = post(context, "scan", "outsider-token");
  assert.equal(unauthorizedPost.code, "TEST_MODE_ACCESS_DENIED");

  const invalidGet = context.doGet({
    parameter: { action: "search", idToken: "invalid-token" },
  });
  assert.equal(invalidGet.code, "AUTH_INVALID");

  const unauthorizedGet = context.doGet({
    parameter: { action: "search", idToken: "outsider-token" },
  });
  assert.equal(unauthorizedGet.code, "TEST_MODE_ACCESS_DENIED");
  assert.equal(context.testSpreadsheetCalls, 0);
  assert.deepEqual(context.openedSpreadsheetIds, []);
});

test("backend fails closed when disabled, unmarked, or missing separate config", () => {
  const disabledContext = createBackendContext({ enabled: "false" });
  const disabled = post(
    disabledContext,
    "check_test_access",
    "test-token",
  );
  assert.equal(disabled.code, "TEST_MODE_NOT_CONFIGURED");
  const disabledGet = disabledContext.doGet({
    parameter: { action: "search", idToken: "test-token" },
  });
  assert.equal(disabledGet.code, "TEST_MODE_NOT_CONFIGURED");

  const unmarkedContext = createBackendContext({ marker: "production" });
  const unmarked = post(
    unmarkedContext,
    "check_test_access",
    "test-token",
  );
  assert.equal(unmarked.code, "TEST_MODE_NOT_CONFIGURED");
  assert.equal(unmarkedContext.testSpreadsheetCalls, 1);
  const unmarkedGet = unmarkedContext.doGet({
    parameter: { action: "search", idToken: "test-token" },
  });
  assert.equal(unmarkedGet.code, "TEST_MODE_NOT_CONFIGURED");

  const missingIds = post(
    createBackendContext({ spreadsheetId: "", productionSpreadsheetId: "" }),
    "check_test_access",
    "test-token",
  );
  assert.equal(missingIds.code, "TEST_MODE_NOT_CONFIGURED");

  const emptyAllowlistContext = createBackendContext({ allowlist: [] });
  const emptyAllowlist = post(
    emptyAllowlistContext,
    "check_test_access",
    "test-token",
  );
  assert.equal(emptyAllowlist.code, "TEST_MODE_NOT_CONFIGURED");
  assert.equal(emptyAllowlistContext.testSpreadsheetCalls, 0);
});

test("same production/test spreadsheet IDs are rejected before opening a sheet", () => {
  const context = createBackendContext({
    spreadsheetId: "same-id",
    productionSpreadsheetId: "same-id",
  });
  const response = post(context, "check_test_access", "test-token");

  assert.equal(response.code, "TEST_MODE_NOT_CONFIGURED");
  assert.deepEqual(context.openedSpreadsheetIds, []);
});

test("Test Mode password is checked only on the server and is not returned", () => {
  const context = createBackendContext();
  const valid = context.doPost({
    postData: {
      contents: JSON.stringify({
        action: "verify_test_mode_password",
        idToken: "test-token",
        password: "test-password-only-for-tests",
      }),
    },
  });
  const invalid = context.doPost({
    postData: {
      contents: JSON.stringify({
        action: "verify_test_mode_password",
        idToken: "test-token",
        password: "wrong",
      }),
    },
  });
  assert.deepEqual(valid, { success: true, valid: true });
  assert.deepEqual(invalid, { success: true, valid: false });
  assert.equal(JSON.stringify(valid).includes("test-password-only-for-tests"), false);
});

test("WhatsApp scaffold is disabled and enforces explicit consent", () => {
  const context = createBackendContext();
  const status = post(
    context,
    "get_whatsapp_automation_status",
    "test-token",
  );
  assert.equal(status.success, true);
  assert.equal(status.configured, false);
  assert.equal(status.sendingEnabled, false);
  assert.equal(status.schedulingEnabled, false);
  assert.equal(status.providerImplemented, false);

  const rejected = context.doPost({
    postData: {
      contents: JSON.stringify({
        action: "validate_whatsapp_automation_intent",
        idToken: "test-token",
        type: "birthday",
        personId: "7",
        templateName: "approved-test-template",
        idempotencyKey: "birthday:7:2026",
        optedIn: false,
      }),
    },
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.code, "WHATSAPP_OPT_IN_REQUIRED");
  const consentedContext = createBackendContext({
    whatsappConsentRows: [
      ["Person ID", "Opted In"],
      ["7", true],
    ],
    whatsappRosterRows: [
      ["ID", "Name", "Birthdate", "Phone", "Drive Link", "Status"],
      ["7", "Test Person", "", "+15555550100", "", "Active"],
    ],
  });
  const notSent = consentedContext.doPost({
    postData: {
      contents: JSON.stringify({
        action: "validate_whatsapp_automation_intent",
        idToken: "test-token",
        type: "birthday",
        personId: "7",
        templateName: "approved-test-template",
        idempotencyKey: "birthday:7:2026",
        optedIn: true,
      }),
    },
  });
  assert.equal(notSent.success, false);
  assert.equal(notSent.code, "WHATSAPP_PROVIDER_NOT_IMPLEMENTED");
  assert.match(backendSource, /WHATSAPP_PROVIDER_NOT_IMPLEMENTED/);
});

test("spreadsheet access is test-only and all sensitive properties require TEST_ names", () => {
  assert.doesNotMatch(backendSource, /SpreadsheetApp\.getActiveSpreadsheet\(\)/);
  assert.match(backendSource, /SpreadsheetApp\.openById\(spreadsheetId\)/);
  assert.match(backendSource, /function getTestSpreadsheet_\(\)/);
  assert.match(backendSource, /getTestSpreadsheet_\(\)\.getSheetByName/);
  assert.match(backendSource, /getTestScriptProperties_\(\)\.getProperty\("FCM_SERVICE_ACCOUNT_JSON"\)/);
  assert.match(backendSource, /TEST_" \+ propertyKey/);
  assert.match(backendSource, /PRODUCTION_SPREADSHEET_ID/);
  assert.match(backendSource, /spreadsheetId === productionSpreadsheetId/);
  assert.match(backendSource, /function getTestExportFolder_\(\)/);
  assert.match(
    backendSource,
    /getFileById\(temporarySpreadsheet\.getId\(\)\)\.moveTo\(exportFolder\)/,
  );

  const context = createBackendContext();
  delete context.scriptProperties.TEST_QR_SECRET_KEY;
  context.scriptProperties.QR_SECRET_KEY = "production-secret-must-not-be-used";
  assert.throws(
    () => context.encryptId("123"),
    /Missing required Script Property: TEST_QR_SECRET_KEY/,
  );
});

test("Pages stages a same-origin clone and keeps test config independent", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github", "workflows", "pages.yml"),
    "utf8",
  );
  assert.match(workflow, /cp -R Frontend\/\. site\//);
  assert.match(workflow, /cp -R TestMode\/Frontend\/\. site\/test-mode\//);
  assert.match(workflow, /LAMBAS_TEST_API_URL/);
  assert.match(workflow, /LAMBAS_TEST_GOOGLE_CLIENT_ID/);
  assert.match(workflow, /LAMBAS_TEST_GOOGLE_SHEET_URL/);
  assert.match(workflow, /LAMBAS_TEST_FIREBASE_/);
  assert.match(workflow, /testSheetId === productionSheetId/);
  assert.match(workflow, /env\.TEST_API_URL === env\.PRODUCTION_API_URL/);
  assert.match(workflow, /env\.TEST_GOOGLE_CLIENT_ID === env\.PRODUCTION_GOOGLE_CLIENT_ID/);
  assert.match(workflow, /LAMBAS_TEST_MODE_AVAILABLE = \$\{provisioned\}/);
  assert.match(workflow, /apiUrl: '',/);
  assert.match(workflow, /path: site/);
  assert.doesNotMatch(workflow, /config\.apiUrl\s*=\s*process\.env\.APP_API_URL/);
});

test("entry confirmation cancel stays put; unavailable config never navigates", () => {
  const confirmation =
    "You're about to enter Test Mode. This version contains new features and experimental updates that are still being tested. The main application remains unchanged. Do you want to continue?";
  const makeEntryContext = (confirmed, available) => {
    const assigned = [];
    const status = { hidden: true, textContent: "" };
    const button = { addEventListener: (name, callback) => {
      assert.equal(name, "click");
      button.click = callback;
    } };
    const window = {
      LAMBAS_TEST_MODE_AVAILABLE: available,
      location: { origin: "https://church-code-hub.github.io" },
      confirm: (message) => {
        assert.equal(message, confirmation);
        return confirmed;
      },
      alert: (message) => {
        status.textContent = message;
        status.hidden = false;
      },
    };
    window.location.assign = (url) => assigned.push(url);
    const context = {
      window,
      document: {
        baseURI: "https://church-code-hub.github.io/Lambas-Bible/",
        getElementById: (id) =>
          id === "testModeEntryButton" ? button : status,
      },
      URL,
    };
    vm.createContext(context);
    vm.runInContext(productionEntrySource, context);
    return { window, assigned, status };
  };

  const cancelled = makeEntryContext(false, true);
  cancelled.window.beginTestModeEntry();
  assert.deepEqual(cancelled.assigned, []);
  assert.equal(cancelled.status.hidden, true);

  const unavailable = makeEntryContext(true, false);
  unavailable.window.beginTestModeEntry();
  assert.deepEqual(unavailable.assigned, []);
  assert.match(unavailable.status.textContent, /unavailable/);
  assert.equal(unavailable.status.hidden, false);

  const available = makeEntryContext(true, true);
  available.window.beginTestModeEntry();
  assert.deepEqual(available.assigned, [
    "https://church-code-hub.github.io/Lambas-Bible/test-mode/",
  ]);
});

test("Test Mode storage shim isolates every local and session storage key", () => {
  const createStorage = (initial = {}) => {
    const values = new Map(Object.entries(initial));
    return {
      get length() { return values.size; },
      key(index) { return Array.from(values.keys())[index] || null; },
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(key); },
      clear() { values.clear(); },
      values,
    };
  };
  const productionLocal = createStorage({ app_user: "production-profile" });
  const productionSession = createStorage({ google_id_token: "production-token" });
  const window = {
    localStorage: productionLocal,
    sessionStorage: productionSession,
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(
    fs.readFileSync(
      path.join(testModeRoot, "Frontend", "js", "storage-namespace.js"),
      "utf8",
    ),
    window,
  );

  window.localStorage.setItem("app_user", "test-profile");
  window.sessionStorage.setItem("google_id_token", "test-token");
  assert.equal(window.LAMBAS_TEST_STORAGE_READY, true);
  assert.equal(window.localStorage.getItem("app_user"), "test-profile");
  assert.equal(window.sessionStorage.getItem("google_id_token"), "test-token");
  assert.equal(productionLocal.getItem("app_user"), "production-profile");
  assert.equal(productionSession.getItem("google_id_token"), "production-token");
  assert.equal(productionLocal.getItem("lambas_test_mode_app_user"), "test-profile");
  assert.equal(productionSession.getItem("lambas_test_mode_google_id_token"), "test-token");
  window.localStorage.clear();
  assert.equal(productionLocal.getItem("app_user"), "production-profile");
});

test("test frontend blocks application API calls before allowlist verification", async () => {
  const appCore = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-core.js"),
    "utf8",
  );
  let fetchCalls = 0;
  const context = {
    testModeServerVerified: false,
    backendReachabilityState: null,
    API_URL: "https://test.example/exec",
    navigator: { onLine: true },
    currentUser: null,
    fetch: async () => {
      fetchCalls += 1;
      return { ok: true, json: async () => ({ success: true }) };
    },
    console,
    Blob,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(appCore, context);

  await assert.rejects(
    context.apiCall("get_roster"),
    /Test Mode backend verification is required/,
  );
  await assert.rejects(
    context.apiCall("check_auth"),
    /Test Mode backend verification is required/,
  );
  assert.equal(fetchCalls, 0);

  context.testModeServerVerified = true;
  context.testModePasswordUnlocked = false;
  context.navigator.onLine = true;
  await assert.rejects(
    context.apiCall("get_roster"),
    /Unlock Test Mode before using its application APIs/,
  );
  await assert.rejects(
    context.apiCall("check_auth"),
    /Unlock Test Mode before using its application APIs/,
  );
  context.navigator.onLine = false;
  await assert.rejects(
    context.apiCall("get_roster"),
    /Test Mode APIs require an online connection/,
  );
  assert.equal(fetchCalls, 0);
});

test("test clone is visibly marked, has same-origin return, and no entry action", () => {
  const html = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "index.html"),
    "utf8",
  );
  const auth = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-auth.js"),
    "utf8",
  );
  const state = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-state.js"),
    "utf8",
  );
  const appOffline = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-offline.js"),
    "utf8",
  );
  const serviceWorker = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "sw.js"),
    "utf8",
  );
  const productionServiceWorker = fs.readFileSync(
    path.join(root, "Frontend", "sw.js"),
    "utf8",
  );

  assert.match(html, /class="test-mode-indicator">TEST MODE<\/span>/);
  assert.match(html, /href="\.\.\/"/);
  assert.doesNotMatch(html, /beginTestModeEntry|class="test-mode-entry"/);
  assert.match(auth, /verifyTestModeBackend\(expectedEmail\)/);
  assert.match(auth, /async function submitTestModePassword/);
  assert.match(auth, /clearTestModeCachedReadData\(\)/);
  assert.match(auth, /const clearStores = \["roster", "apiCache"\]/);
  assert.match(state, /LAMBAS_TEST_STORAGE_READY/);
  assert.match(appOffline, /lambas-test-mode-attendance-offline-v1/);
  assert.match(serviceWorker, /lambas-test-mode-shell-v9/);
  assert.doesNotMatch(serviceWorker, /lambas-attendance-offline/);
  assert.match(serviceWorker, /action: "check_test_access"/);
  assert.match(productionServiceWorker, /requestUrl\.pathname\.startsWith\(testModePath\)/);
});

test("dashboard migrates legacy layout and discards drafts on account changes and logout", () => {
  const storageValues = new Map([["app_dashboard_layout", "three"]]);
  const { context } = createFrontendTestContext(storageValues);
  loadFrontendScripts(context, ["app-state.js", "app-i18n.js", "app-views.js"]);
  context.applyDashboardPreferences = () => {};
  context.currentUser = { email: "First@example.com" };

  context.loadDashboardPreferencesForAccount();
  const firstKey = "app_dashboard_preferences_first%40example.com";
  assert.equal(JSON.parse(storageValues.get(firstKey)).layout, "three");
  assert.equal(storageValues.has("app_dashboard_layout"), false);

  vm.runInContext('dashboardEditDraft = { layout: "one" }', context);
  let cancelledOnAccountSwitch = false;
  let draftWasPresentWhenPreferencesApplied = true;
  context.cancelDashboardEdit = () => {
    cancelledOnAccountSwitch = true;
    vm.runInContext("dashboardEditDraft = null", context);
  };
  context.applyDashboardPreferences = () => {
    draftWasPresentWhenPreferencesApplied = Boolean(
      vm.runInContext("dashboardEditDraft", context),
    );
  };
  context.currentUser = { email: "second@example.com" };
  context.loadDashboardPreferencesForAccount();
  assert.equal(cancelledOnAccountSwitch, true);
  assert.equal(draftWasPresentWhenPreferencesApplied, false);
  assert.equal(vm.runInContext("currentDashboardPreferences.layout", context), "two");

  storageValues.set("app_dashboard_layout", "one");
  context.currentUser = null;
  context.loadDashboardPreferencesForAccount();
  assert.equal(storageValues.has("app_dashboard_preferences_anonymous"), false);
  assert.equal(storageValues.get("app_dashboard_layout"), "one");

  const authSource = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-auth.js"),
    "utf8",
  );
  const logoutFunction = authSource.match(/function logoutUser\(msg\) \{[\s\S]*?\n\}/);
  assert.ok(logoutFunction, "logoutUser should be present");
  let logoutCancelledAs = "";
  context.currentUser = { email: "first@example.com" };
  vm.runInContext('dashboardEditDraft = { layout: "one" }', context);
  context.cancelDashboardEdit = () => {
    logoutCancelledAs = context.currentUser.email;
    vm.runInContext("dashboardEditDraft = null", context);
  };
  context.stopLiveScanner = () => {};
  context.showView = () => {};
  context.dismissStartupScreen = () => {};
  vm.runInContext(logoutFunction[0], context);
  context.logoutUser();
  assert.equal(logoutCancelledAs, "first@example.com");
  assert.equal(context.currentUser, null);
});

test("continuous QR presence stays suppressed until no-detection rearms it", () => {
  let fakeNow = 100000;
  let uuidCount = 0;
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fakeNow]));
    }
    static now() {
      return fakeNow;
    }
  }
  const resultWrapper = { classList: { remove() {} } };
  const resultPanel = {
    hidden: false,
    closest: () => resultWrapper,
  };
  const { context, timers } = createFrontendTestContext(new Map(), {
    document: {
      getElementById: (id) => id === "paymentScanResult" ? resultPanel : null,
    },
    globals: {
      Date: FakeDate,
      crypto: {
        randomUUID() {
          uuidCount += 1;
          return `test-event-${uuidCount}`;
        },
      },
    },
  });
  loadFrontendScripts(context, ["app-state.js", "app-scanner-search.js"]);
  context.currentActiveViewId = "scanView";
  context.isScannerRunning = true;
  context.preparePaymentScanAudio = () => {};
  context.showScanProcessing = () => {};
  context.stopLiveScanner = () => new Promise(() => {});

  context.onScanSuccess("same-card-qr");
  assert.equal(uuidCount, 1);
  context.isProcessingScan = false;
  context.activeScannedQrText = "";
  fakeNow += 2000;
  context.onScanSuccess("same-card-qr");
  assert.equal(uuidCount, 1, "same QR should not create a second request context during cooldown");

  fakeNow += 2000;
  context.onScanSuccess("same-card-qr");
  assert.equal(uuidCount, 1, "repeated detections should extend suppression while the QR stays in view");

  fakeNow += 2000;
  context.onScanSuccess("same-card-qr");
  assert.equal(uuidCount, 1, "continuous presence remains suppressed beyond the original debounce");

  context.onScanError("no decode");
  const transientAbsenceTimer = context.scanQrAbsenceTimer;
  assert.ok(transientAbsenceTimer);
  context.onScanSuccess("same-card-qr");
  assert.equal(context.scanQrAbsenceTimer, 0, "a success cancels a pending absence timer");
  assert.equal(uuidCount, 1, "a success during debounce must not create another request");

  context.onScanError("no decode");
  const leaveFrameTimer = context.scanQrAbsenceTimer;
  assert.equal(timers.get(leaveFrameTimer).delay, 1500);
  const absenceCallback = timers.get(leaveFrameTimer).callback;
  fakeNow += 1500;
  absenceCallback();
  assert.equal(context.scanQrAbsenceTimer, 0);
  assert.equal(context.lastDetectedQrText, "");
  assert.equal(context.scanQrDebounceEntries.has("same-card-qr"), false);

  context.onScanSuccess("same-card-qr");
  assert.equal(uuidCount, 2, "the same QR is accepted after it has left the frame");
});

test("dashboard editor move controls keep vertical semantics at desktop widths", () => {
  const styles = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "css", "09-sync-progress.css"),
    "utf8",
  );
  assert.match(styles, /\.dashboard-editor-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(styles, /\.dashboard-editor-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
});

test("Test Mode Theme Studio offers palettes, styles, system mode and isolated persistence", () => {
  const html = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "index.html"),
    "utf8",
  );
  const core = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "js", "app-core.js"),
    "utf8",
  );
  const foundation = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "css", "01-foundation.css"),
    "utf8",
  );
  const serviceWorker = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "sw.js"),
    "utf8",
  );

  for (const palette of ["classic", "midnight", "emerald", "pearl", "royal"]) {
    assert.match(html, new RegExp(`data-theme-palette="${palette}"`));
  }
  for (const style of ["glass", "solid", "minimal"]) {
    assert.match(html, new RegExp(`data-theme-style="${style}"`));
  }
  assert.match(html, /data-appearance-mode="system"/);
  assert.match(html, /onclick="applyThemeStudio\(\)"/);
  assert.match(html, /onclick="resetThemeStudio\(\)"/);
  assert.match(core, /app_appearance_v1/);
  assert.match(core, /prefers-color-scheme/);
  assert.match(core, /normalizeAppearancePreference/);
  assert.match(core, /applyAppearancePreference/);
  assert.match(core, /addListener/);
  assert.match(foundation, /data-visual-style="solid"/);
  assert.match(foundation, /data-visual-style="minimal"/);
  assert.match(foundation, /data-palette="midnight"\]\[data-theme="light"/);
  assert.match(foundation, /data-palette="emerald"\]\[data-theme="light"/);
  assert.match(foundation, /data-palette="pearl"\]\[data-theme="dark"/);
  assert.match(foundation, /data-palette="royal"\]\[data-theme="light"/);
  assert.match(serviceWorker, /lambas-test-mode-shell-v9/);
});

test("fullscreen scanner uses the existing background gradient token", () => {
  const styles = fs.readFileSync(
    path.join(testModeRoot, "Frontend", "css", "09-sync-progress.css"),
    "utf8",
  );
  assert.match(styles, /#scanView:fullscreen\s*\{[^}]*background:\s*var\(--bg-gradient\)/);
  assert.doesNotMatch(styles, /#scanView:fullscreen\s*\{[^}]*var\(--app-bg\)/);
});
