const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backendSource = fs.readFileSync(
  path.join(__dirname, "..", "Backend", "code.gs"),
  "utf8",
);

function createBackendContext(rosterRows = [["ID", "Name", "Card URL"]]) {
  const scriptProperties = {
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    QR_SECRET_KEY: "test-only-qr-secret-key",
    INITIAL_SETTINGS_PASSWORD: "test-only-password-12345",
    ACTIVE_CARDS_FOLDER_ID: "test-active-folder",
    NEW_CARDS_FOLDER_ID: "test-new-folder",
    CARD_TEMPLATE_IMAGE_ID: "test-image-template",
    CARD_SLIDES_TEMPLATE_ID: "test-slides-template",
  };
  const scriptPropertyValues = { ...scriptProperties };
  const scriptPropertiesStore = {
    getProperties: () => ({ ...scriptPropertyValues }),
    getProperty: (key) => scriptPropertyValues[key] || null,
    setProperty: (key, value) => {
      scriptPropertyValues[key] = String(value);
    },
    deleteProperty: (key) => {
      delete scriptPropertyValues[key];
    },
  };
  const tokenCache = new Map();
  const tokenResponses = new Map();
  let tokenFetchCount = 0;
  const rosterSheet = {
    rows: rosterRows,
    getLastRow() {
      return this.rows.length;
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () =>
          this.rows
            .slice(row - 1, row - 1 + rowCount)
            .map((values) => values.slice(column - 1, column - 1 + columnCount)),
      };
    },
    appendRow(values) {
      this.rows.push(values);
    },
  };
  const context = {
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA-256" },
      computeDigest: (_algorithm, value) =>
        Buffer.from(String(value)).subarray(0, 32),
      base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url"),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => tokenCache.get(key) || null,
        put: (key, value) => tokenCache.set(key, value),
      }),
    },
    PropertiesService: {
      getScriptProperties: () => scriptPropertiesStore,
    },
    UrlFetchApp: {
      fetch: (url) => {
        tokenFetchCount += 1;
        const token = new URL(url).searchParams.get("id_token");
        const tokenInfo = tokenResponses.get(token);
        return {
          getResponseCode: () => (tokenInfo ? 200 : 400),
          getContentText: () => JSON.stringify(tokenInfo || {}),
        };
      },
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === "Roster" ? rosterSheet : null),
      }),
    },
  };

  vm.createContext(context);
  vm.runInContext(backendSource, context);
  context.getAdminNameByEmail = () => "Test Admin";
  context.isAttendanceTimeAllowed = () => false;
  context.generateAllCardsFromRoster = (id) => ({
    success: true,
    cards: [{ driveUrl: `https://drive.google.com/file/d/card-${id}` }],
  });

  return {
    context,
    rosterSheet,
    scriptPropertiesStore,
    tokenResponses,
    getTokenFetchCount: () => tokenFetchCount,
  };
}

test("blocks case/spacing and Arabic-diacritic duplicate names", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [1, "Alice", ""],
    [2, "\u0646\u0648\u0631", ""],
  ]);

  const latinDuplicate = context.saveStudentAndGenerateCard_(
    "  ALICE  ",
    "admin@example.com",
  );
  const arabicDuplicate = context.saveStudentAndGenerateCard_(
    "\u0646\u064f\u0648\u0631",
    "admin@example.com",
  );

  assert.equal(latinDuplicate.code, "DUPLICATE_NAME");
  assert.equal(arabicDuplicate.code, "DUPLICATE_NAME");
  assert.equal(rosterSheet.rows.length, 3);
});

test("allocates the next ID after a successful unique attendee insert", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [8, "Alice", ""],
  ]);
  context.getSettings = () => ({
    startTime: "10:00",
    endTime: "12:00",
    acceptedDelay: 15,
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
  });
  context.isAttendanceTimeAllowedAt_ = () => false;

  const result = context.saveStudentAndGenerateCard_(
    "Bob",
    "admin@example.com",
  );

  assert.equal(result.success, true);
  assert.equal(result.id, 9);
  assert.equal(rosterSheet.rows.at(-1)[1], "Bob");
});

test("updates only the matching date and attendee in the attendance matrix", () => {
  const { context } = createBackendContext();
  const today = new Date().toDateString();
  const rows = [
    ["ID", "Name", today, "other day"],
    [17, "Alice", "", ""],
    [18, "Bob", "", ""],
  ];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () =>
          rows
            .slice(row - 1, row - 1 + rowCount)
            .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValue: (value) => {
          rows[row - 1][column - 1] = value;
        },
      };
    },
  };

  context.setAttendanceMark_(sheet, 18, new Date(), "+");

  assert.deepEqual(rows[1], [17, "Alice", "", ""]);
  assert.deepEqual(rows[2], [18, "Bob", "+", ""]);
});

test("verifies token audience and caches successful Google token checks", () => {
  const { context, tokenResponses, getTokenFetchCount } = createBackendContext();
  const clientId = "test-client-id.apps.googleusercontent.com";
  const validInfo = {
    aud: clientId,
    iss: "accounts.google.com",
    email: "admin@example.com",
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  tokenResponses.set("valid", validInfo);
  tokenResponses.set("wrong-audience", { ...validInfo, aud: "other-client" });

  assert.equal(context.verifyGoogleIdToken_("valid").success, true);
  assert.equal(context.verifyGoogleIdToken_("valid").success, true);
  assert.equal(getTokenFetchCount(), 1);
  assert.equal(context.verifyGoogleIdToken_("wrong-audience").code, "AUTH_INVALID");
  assert.equal(getTokenFetchCount(), 2);
});

test("check_auth returns the email verified from the ID token", () => {
  const { context, tokenResponses } = createBackendContext();
  tokenResponses.set("valid-auth", {
    aud: "test-client-id.apps.googleusercontent.com",
    iss: "accounts.google.com",
    email: "admin@example.com",
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  });
  context.isEmailAllowed = (email) => email === "admin@example.com";
  context.getAdminNameByEmail = () => "Test Admin";
  context.ContentService = {
    MimeType: { JSON: "application/json" },
    createTextOutput: (content) => ({
      setMimeType: () => JSON.parse(content),
    }),
  };
  context.LockService.getScriptLock = () => ({
    waitLock() {},
    releaseLock() {},
  });

  const result = context.doPost({
    postData: {
      contents: JSON.stringify({
        action: "check_auth",
        idToken: "valid-auth",
        email: "spoofed@example.com",
      }),
    },
  });

  assert.equal(result.authorized, true);
  assert.equal(result.email, "admin@example.com");
  assert.equal(result.adminName, "Test Admin");
});

test("evaluates the meeting schedule against the captured event timestamp", () => {
  const { context } = createBackendContext();
  const eventTime = new Date(2026, 9, 18, 11, 0, 0);
  const settings = {
    startTime: "10:00",
    endTime: "12:00",
    acceptedDelay: 15,
    allowedDays: [eventTime.getDay()],
  };

  assert.equal(context.isAttendanceTimeAllowedAt_(eventTime, settings), true);
  assert.equal(
    context.isAttendanceTimeAllowedAt_(new Date(2026, 9, 18, 13, 0, 0), settings),
    false,
  );
});

test("ranks exact, multi-word, and typo-tolerant name search results", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [1, "Alice Johnson", ""],
    [2, "Alicia Jones", ""],
    [3, "John Alice", ""],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => (name === "Roster" ? rosterSheet : null),
  });

  const exact = context.verifyOrSuggestName("alice johnson");
  const reordered = context.verifyOrSuggestName("johnson alice");
  const misspelled = context.verifyOrSuggestName("johnsn alce");

  assert.equal(exact.status, "exact_match");
  assert.equal(exact.id, "1");
  assert.equal(reordered.status, "suggestions");
  assert.equal(reordered.matches[0].id, "1");
  assert.equal(misspelled.status, "suggestions");
  assert.equal(misspelled.matches[0].id, "1");
});

test("prunes only expired offline idempotency records", () => {
  const { context, scriptPropertiesStore } = createBackendContext();
  const now = Date.now();
  scriptPropertiesStore.setProperty(
    "OFFLINE_EVENT_expired",
    JSON.stringify({ status: "COMPLETE", timestamp: new Date(now - 8 * 86400000).toISOString() }),
  );
  scriptPropertiesStore.setProperty(
    "OFFLINE_EVENT_recent",
    JSON.stringify({ status: "COMPLETE", timestamp: new Date(now - 86400000).toISOString() }),
  );
  scriptPropertiesStore.setProperty("unrelated-setting", "preserve");

  context.pruneOfflineEventProperties_(scriptPropertiesStore, now);

  assert.equal(scriptPropertiesStore.getProperty("OFFLINE_EVENT_expired"), null);
  assert.ok(scriptPropertiesStore.getProperty("OFFLINE_EVENT_recent"));
  assert.equal(scriptPropertiesStore.getProperty("unrelated-setting"), "preserve");
});

test("returns a retryable busy response when another request owns the script lock", () => {
  const { context } = createBackendContext();
  context.LockService.getScriptLock = () => ({
    waitLock: () => {
      throw new Error("Lock timeout");
    },
    releaseLock: () => assert.fail("A lock that was not acquired must not be released"),
  });

  const result = context.withScriptLock_(() => assert.fail("Busy callback must not run"));

  assert.equal(result.success, false);
  assert.equal(result.code, "SERVER_BUSY");
});

test("does not apply an offline event twice when the client retries sync", () => {
  const { context } = createBackendContext();
  let applyCount = 0;
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => {
      assert.notEqual(name, "Offline Events");
      return null;
    },
    insertSheet: () => assert.fail("Offline sync must not create spreadsheet tabs"),
  });
  context.saveStudentAndGenerateCard_ = (name, email, options) => {
    applyCount += 1;
    return { success: true, name, email, timestamp: options.timestamp.toISOString() };
  };
  const event = {
    eventId: "offline-event-12345678",
    type: "add_student",
    name: "Offline attendee",
    attendIfOpen: true,
    queuedBy: "admin@example.com",
    timestamp: new Date().toISOString(),
  };

  const first = context.syncOfflineEvents_([event], "admin@example.com");
  const retry = context.syncOfflineEvents_([event], "admin@example.com");

  assert.equal(first.results[0].status, "complete");
  assert.equal(retry.results[0].status, "complete");
  assert.equal(applyCount, 1);
});

test("stops an offline batch when an earlier event is still pending", () => {
  const { context, scriptPropertiesStore } = createBackendContext();
  let applyCount = 0;
  context.saveStudentAndGenerateCard_ = () => {
    applyCount += 1;
    return { success: true };
  };
  const timestamp = new Date().toISOString();
  scriptPropertiesStore.setProperty(
    "OFFLINE_EVENT_pending-event-1234",
    JSON.stringify({ status: "PENDING", timestamp }),
  );
  const events = [
    {
      eventId: "pending-event-1234",
      type: "add_student",
      name: "Already processing",
      queuedBy: "admin@example.com",
      timestamp,
    },
    {
      eventId: "later-event-123456",
      type: "add_student",
      name: "Must wait",
      queuedBy: "admin@example.com",
      timestamp,
    },
  ];

  const result = context.syncOfflineEvents_(events, "admin@example.com");

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].eventId, events[0].eventId);
  assert.equal(result.results[0].status, "pending");
  assert.equal(applyCount, 0);
});

test("syncs offline check-in and check-out through the scan flow without an offline sheet", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [1, "Offline attendee", ""],
  ]);
  const checkinRows = [
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay"],
  ];
  const checkinSheet = {
    getLastRow: () => checkinRows.length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () =>
          checkinRows
            .slice(row - 1, row - 1 + rowCount)
            .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValue: (value) => {
          checkinRows[row - 1][column - 1] = value;
        },
      };
    },
    appendRow: (row) => checkinRows.push(row),
  };
  const checkinTime = new Date();
  checkinTime.setDate(checkinTime.getDate() - 1);
  checkinTime.setHours(10, 0, 0, 0);
  const checkoutTime = new Date(checkinTime.getTime() + 60 * 60 * 1000);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName(name) {
      assert.notEqual(name, "Offline Events");
      return ({
        Roster: rosterSheet,
        "Check-in & Check-out": checkinSheet,
      })[name] || null;
    },
    insertSheet: () => assert.fail("Offline sync must not create spreadsheet tabs"),
  });
  context.isEmailAllowed = (email) => email === "admin@example.com";
  context.Utilities.base64Encode = (value) =>
    Buffer.from(value, "binary").toString("base64");
  context.Utilities.base64Decode = (value) =>
    Array.from(Buffer.from(value, "base64"));
  context.getSettings = () => ({
    startTime: "00:00",
    endTime: "23:59",
    acceptedDelay: 0,
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
  });
  context.isAttendanceTimeAllowedAt_ = () => true;
  context.isCheckoutAllowed = (timestamp) =>
    timestamp.toISOString() === checkoutTime.toISOString();
  context.computeDelayMinutes_ = () => 0;
  context.setAttendanceMark_ = () => {};
  context.Session = { getScriptTimeZone: () => "UTC" };
  context.Utilities.formatDate = () => "11:00 AM";
  const events = [
    {
      eventId: "offline-checkin-123456",
      type: "scan",
      qrText: context.encryptId(1),
      queuedBy: "admin@example.com",
      timestamp: checkinTime.toISOString(),
    },
    {
      eventId: "offline-checkout-123456",
      type: "scan",
      qrText: context.encryptId(1),
      queuedBy: "admin@example.com",
      timestamp: checkoutTime.toISOString(),
    },
  ];

  const firstSync = context.syncOfflineEvents_(events, "admin@example.com");
  const retry = context.syncOfflineEvents_(events, "admin@example.com");

  assert.deepEqual(
    Array.from(firstSync.results, (result) => result.status),
    ["complete", "complete"],
  );
  assert.deepEqual(
    Array.from(retry.results, (result) => result.status),
    ["complete", "complete"],
  );
  assert.equal(firstSync.results[0].result.kind, "success");
  assert.equal(firstSync.results[1].result.kind, "out");
  assert.equal(checkinRows.length, 2);
  assert.equal(checkinRows[1][2].toISOString(), checkinTime.toISOString());
  assert.equal(checkinRows[1][4].toISOString(), checkoutTime.toISOString());
});

test("preserves offline add time and honors the do-not-attend choice", () => {
  const { context, rosterSheet } = createBackendContext();
  const newRows = [];
  const attendanceRows = [["ID", "Name"], [1, "Header"]];
  const checkinRows = [["ID", "Name", "Check-in"]];
  const appendOnlySheet = (rows) => ({ appendRow: (row) => rows.push(row) });
  const newSheet = appendOnlySheet(newRows);
  const attendanceSheet = appendOnlySheet(attendanceRows);
  const checkinSheet = appendOnlySheet(checkinRows);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName(name) {
      return ({
        Roster: rosterSheet,
        New: newSheet,
        Attendance: attendanceSheet,
        "Check-in & Check-out": checkinSheet,
      })[name] || null;
    },
  });
  context.getSettings = () => ({
    startTime: "10:00",
    endTime: "12:00",
    acceptedDelay: 15,
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
  });
  context.isAttendanceTimeAllowedAt_ = () => true;
  const eventTime = new Date("2026-10-18T10:30:00.000Z");

  const result = context.saveStudentAndGenerateCard_("Offline person", "admin@example.com", {
    timestamp: eventTime,
    attendIfOpen: false,
  });

  assert.equal(result.success, true);
  assert.equal(newRows[0][0].toISOString(), eventTime.toISOString());
  assert.equal(checkinRows.length, 1);
});
