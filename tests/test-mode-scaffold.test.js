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

function createBackendContext({
  enabled = "true",
  spreadsheetId = "test-spreadsheet",
  productionSpreadsheetId = "production-spreadsheet",
  marker = "LAMBAS_TEST_ONLY",
  allowlist = ["Tester@Example.com"],
} = {}) {
  const propertyValues = {
    TEST_MODE_ENABLED: enabled,
    TEST_SPREADSHEET_ID: spreadsheetId,
    PRODUCTION_SPREADSHEET_ID: productionSpreadsheetId,
    TEST_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    TEST_QR_SECRET_KEY: "test-only-secret",
  };
  const openedSpreadsheetIds = [];
  const markerSheet = {
    getRange: () => ({ getValue: () => marker }),
  };
  const testSpreadsheet = {
    getSheetByName: (name) => (name === "_TEST_MODE" ? markerSheet : null),
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
  assert.match(auth, /clearTestModeCachedReadData\(\)/);
  assert.match(auth, /const clearStores = \["roster", "apiCache"\]/);
  assert.match(state, /LAMBAS_TEST_STORAGE_READY/);
  assert.match(appOffline, /lambas-test-mode-attendance-offline-v1/);
  assert.match(serviceWorker, /lambas-test-mode-shell-v6/);
  assert.doesNotMatch(serviceWorker, /lambas-attendance-offline/);
  assert.match(serviceWorker, /action: "check_test_access"/);
  assert.match(productionServiceWorker, /requestUrl\.pathname\.startsWith\(testModePath\)/);
});
