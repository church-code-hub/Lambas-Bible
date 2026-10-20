const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backendSource = fs.readFileSync(
  path.join(__dirname, "..", "Backend", "Code.js"),
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
    cards: [{ id, driveUrl: `https://drive.google.com/file/d/card-${id}` }],
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

test("retries a missing servant card and reuses an existing card URL", () => {
  const { context } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [7, "Alice", "https://drive.google.com/file/d/card-7"],
    [8, "Bob", ""],
  ]);
  let generatedFor = "";
  context.generateAllCardsFromRoster = (id) => {
    generatedFor = String(id);
    return {
      success: true,
      cards: [{ id, driveUrl: `https://drive.google.com/file/d/card-${id}` }],
    };
  };

  const existing = context.generateStudentCard_(7);
  const retried = context.generateStudentCard_(8);

  assert.equal(existing.success, true);
  assert.equal(existing.driveUrl, "https://drive.google.com/file/d/card-7");
  assert.equal(retried.success, true);
  assert.equal(retried.driveUrl, "https://drive.google.com/file/d/card-8");
  assert.equal(generatedFor, "8");
});

test("retains the configured card template and folder property names", () => {
  for (const propertyName of [
    "ACTIVE_CARDS_FOLDER_ID",
    "NEW_CARDS_FOLDER_ID",
    "CARD_TEMPLATE_IMAGE_ID",
    "CARD_SLIDES_TEMPLATE_ID",
  ]) {
    assert.ok(backendSource.includes(`"${propertyName}"`));
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
    assert.ok(readme.includes(`\`${propertyName}\``));
  }
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

test("records each delay by attendance date and retains the aggregate summary", () => {
  const { context } = createBackendContext();
  const sheets = new Map();
  const createSheet = () => {
    const rows = [];
    return {
      rows,
      getDataRange: () => ({ getValues: () => rows.map((row) => row.slice()) }),
      getRange(row, column) {
        return {
          setValues: (values) => {
            values.forEach((valuesRow, rowOffset) => {
              const targetRow = row - 1 + rowOffset;
              rows[targetRow] ||= [];
              valuesRow.forEach((value, columnOffset) => {
                rows[targetRow][column - 1 + columnOffset] = value;
              });
            });
          },
        };
      },
      appendRow: (values) => rows.push(values),
    };
  };
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = createSheet();
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const firstDate = new Date(2026, 9, 4, 10, 32);
  const secondDate = new Date(2026, 9, 11, 10, 47);
  context.recordDelay_(42, "Sam", 17, firstDate, "Admin A");
  context.recordDelay_(42, "Sam", 32, secondDate, "Admin B");

  const details = sheets.get("Delay Details").rows;
  assert.equal(details.length, 3);
  assert.equal(details[1][2].toDateString(), firstDate.toDateString());
  assert.equal(details[2][2].toDateString(), secondDate.toDateString());
  assert.equal(details[1][4], 17);
  assert.equal(details[2][5], "Admin B");
  assert.equal(
    JSON.stringify(sheets.get("Delays").rows[1]),
    JSON.stringify([42, "Sam", 49, 2, "49 دقيقة"]),
  );
});

test("builds a daily attendance report and can find an absent person by name", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [1, "Alice", ""],
    [2, "Bob", ""],
  ]);
  const meetingDate = new Date(2026, 9, 18, 12);
  const makeSheet = (rows, sheetId = 0) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map((row) => row.length)),
    getSheetId: () => sheetId,
    clearContents: () => { rows.length = 0; },
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValues: (values) => values.forEach((valuesRow, rowOffset) => {
          rows[row - 1 + rowOffset] = valuesRow.slice();
        }),
      };
    },
  });
  const attendanceSheet = makeSheet([
    ["ID", "Name", meetingDate],
    [1, "Alice", "-"],
    [2, "Bob", ""],
  ]);
  const checkinSheet = makeSheet([
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay", "Status"],
    [1, "Alice", new Date(2026, 9, 18, 10), "Admin", "", "", "", "Active"],
  ]);
  const sheets = new Map([
    ["Attendance", attendanceSheet],
    ["Roster", rosterSheet],
    ["Check-in & Check-out", checkinSheet],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = makeSheet([], 77);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const report = context.getAttendanceDayReport_("2026-10-18", "Bob", true);

  assert.equal(report.success, true);
  assert.equal(report.count, 1);
  assert.equal(report.people[0].name, "Alice");
  assert.equal(report.people[1].name, "Bob");
  assert.equal(report.people[1].attended, false);
  assert.equal(report.matches[0].name, "Bob");
  assert.equal(report.matches[0].attended, false);
  assert.equal(report.report.sheetId, 77);
  assert.equal(sheets.get("Attendance 2026-10-18").rows.length, 3);
  assert.equal(sheets.get("Attendance 2026-10-18").rows[1][1], "Alice");
  assert.equal(sheets.get("Attendance 2026-10-18").rows[2][1], "Bob");
  assert.equal(sheets.get("Attendance 2026-10-18").rows[2][2], "Not attended");
});

test("adds previously attending people missing three meetings to follow-up", () => {
  const { context, rosterSheet } = createBackendContext([
    ["ID", "Name", "Card URL"],
    [1, "Alice", ""],
    [2, "Bob", ""],
  ]);
  const dates = [21, 14, 7, 0].map((daysAgo) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(12, 0, 0, 0);
    return date;
  });
  const makeSheet = (rows) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map((row) => row.length)),
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValues: (values) => values.forEach((valuesRow, rowOffset) => {
          const targetRow = row - 1 + rowOffset;
          rows[targetRow] ||= [];
          valuesRow.forEach((value, columnOffset) => {
            rows[targetRow][column - 1 + columnOffset] = value;
          });
        }),
      };
    },
    appendRow: (values) => rows.push(values),
  });
  const attendanceSheet = makeSheet([
    ["ID", "Name", ...dates],
    [1, "Alice", "-", "", "", ""],
    [2, "Bob", "", "", "", ""],
  ]);
  const sheets = new Map([
    ["Attendance", attendanceSheet],
    ["Roster", rosterSheet],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = makeSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const firstList = context.getFollowupCandidates_();
  assert.deepEqual(
    Array.from(firstList.followups, (person) => [person.id, person.missedMeetings]),
    [["1", 3]],
  );
  assert.equal(context.completeFollowup_("1", "admin@example.com").success, true);
  const refreshedList = context.getFollowupCandidates_();
  assert.deepEqual(
    Array.from(refreshedList.followups, (person) => person.id),
    [],
  );
});

test("cancels today's check-in without deleting its audit history", () => {
  const { context } = createBackendContext();
  const today = new Date();
  const attendanceRows = [["ID", "Name", today], [7, "Sam", "-"]];
  const checkinRows = [
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay", "Status"],
    [7, "Sam", today, "Admin A", "", "", "", "Active"],
  ];
  const makeSheet = (rows) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map((row) => row.length)),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValue: (value) => { rows[row - 1][column - 1] = value; },
        setValues: (values) => values.forEach((valuesRow, rowOffset) => {
          rows[row - 1 + rowOffset] = valuesRow.slice();
        }),
      };
    },
    appendRow: (values) => rows.push(values),
  });
  const attendanceSheet = makeSheet(attendanceRows);
  const checkinSheet = makeSheet(checkinRows);
  const sheets = new Map([
    ["Attendance", attendanceSheet],
    ["Check-in & Check-out", checkinSheet],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = makeSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const result = context.cancelCheckin_(7, "admin@example.com");

  assert.equal(result.success, true);
  assert.equal(checkinRows[1][7], "Cancelled");
  assert.equal(attendanceRows[1][2], "");
  assert.equal(sheets.get("Attendance Audit").rows.length, 2);
  assert.equal(sheets.get("Attendance Audit").rows[1][4], "Test Admin");
  assert.equal(context.cancelCheckin_(7, "admin@example.com").code, "CHECKIN_NOT_FOUND");
});

test("allows authorized users to use the check-in cancellation API", () => {
  const { context, tokenResponses } = createBackendContext();
  const ownerEmail = "owner@example.com";
  const createTokenInfo = (email) => ({
    aud: "test-client-id.apps.googleusercontent.com",
    iss: "accounts.google.com",
    email: email,
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  });
  tokenResponses.set("owner-token", createTokenInfo(ownerEmail));
  tokenResponses.set("admin-token", createTokenInfo("admin@example.com"));
  tokenResponses.set("unauthorized-token", createTokenInfo("other@example.com"));
  context.isEmailAllowed = (email) => email === ownerEmail || email === "admin@example.com";
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getOwner: () => ({ getEmail: () => ownerEmail }),
    getSheetByName: () => null,
  });
  context.ContentService = {
    MimeType: { JSON: "application/json" },
    createTextOutput: (content) => ({
      setMimeType: () => JSON.parse(content),
    }),
  };
  let cancellationCount = 0;
  context.cancelCheckin_ = () => {
    cancellationCount++;
    return { success: true };
  };
  const send = (idToken) => context.doPost({
    postData: {
      contents: JSON.stringify({ action: "cancel_checkin", id: "7", idToken }),
    },
  });

  const ownerResult = send("owner-token");
  const adminResult = send("admin-token");
  const unauthorizedResult = send("unauthorized-token");

  assert.equal(ownerResult.success, true);
  assert.equal(adminResult.success, true);
  assert.equal(unauthorizedResult.success, false);
  assert.equal(cancellationCount, 2);
});

test("requires a numeric password of at least eight digits when changing settings", () => {
  const { context } = createBackendContext();
  const save = (newPassword) => context.saveSettings(
    "current-password",
    "18:00",
    "20:00",
    0,
    newPassword,
    [0],
  );

  assert.equal(save("1234abcd").code, "PASSWORD_DIGITS_ONLY");
  assert.equal(save("1234567").code, "PASSWORD_TOO_SHORT");
});

test("filters card searches by sharing state and sorts matches by most recent update", () => {
  const { context } = createBackendContext([
    ["ID", "Name", "Card URL"],
    ["1", "Ada One", "https://drive.google.com/file/d/card-old/view"],
    ["2", "Ada Two", "https://drive.google.com/file/d/card-new/view"],
    ["3", "Ada Three", "https://drive.google.com/file/d/card-unshared/view"],
  ]);
  const cards = {
    "card-old": { folder: "active", updatedAt: "2025-01-01T00:00:00Z" },
    "card-new": { folder: "active", updatedAt: "2025-03-01T00:00:00Z" },
    "card-unshared": { folder: "new", updatedAt: "2025-02-01T00:00:00Z" },
  };
  context.DriveApp = {
    getFileById: (id) => ({
      getLastUpdated: () => new Date(cards[id].updatedAt),
      getParents: () => {
        let read = false;
        return {
          hasNext: () => !read,
          next: () => {
            read = true;
            return { getId: () => cards[id].folder === "new" ? "test-new-folder" : "active-folder" };
          },
        };
      },
    }),
  };

  const shared = context.searchCardForShare("Ada", "shared");
  const unshared = context.searchCardForShare("Ada", "unshared");

  assert.deepEqual(Array.from(shared.matches, (match) => match.fileId), ["card-new", "card-old"]);
  assert.deepEqual(Array.from(unshared.matches, (match) => match.fileId), ["card-unshared"]);
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

test("cached roster includes the original QR token while retaining its attendee ID", () => {
  const { context, tokenResponses } = createBackendContext([
    ["ID", "Name", "Card URL"],
    ["001", "Attendee One", ""],
  ]);
  tokenResponses.set("roster-token", {
    aud: "test-client-id.apps.googleusercontent.com",
    iss: "accounts.google.com",
    email: "admin@example.com",
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  });
  context.encryptId = (id) => `encrypted:${id}`;
  context.isEmailAllowed = () => true;
  context.ContentService = {
    MimeType: { JSON: "application/json" },
    createTextOutput: (content) => ({
      setMimeType: () => JSON.parse(content),
    }),
  };

  const result = context.doPost({
    postData: {
      contents: JSON.stringify({ action: "get_roster", idToken: "roster-token" }),
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    Array.from(result.roster, (person) => [person.id, person.qrId]),
    [["001", "encrypted:001"]],
  );
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

test("allows failed offline events to retry without reapplying completed events", () => {
  const { context } = createBackendContext();
  let applyCount = 0;
  context.saveStudentAndGenerateCard_ = (name, email) => {
    applyCount += 1;
    return applyCount === 1
      ? { success: false, message: "Temporary failure" }
      : { success: true, name, email };
  };
  const event = {
    eventId: "offline-retry-event-1234",
    type: "add_student",
    name: "Offline attendee",
    queuedBy: "admin@example.com",
    timestamp: new Date().toISOString(),
  };

  const first = context.syncOfflineEvents_([event], "admin@example.com");
  const retry = context.syncOfflineEvents_([event], "admin@example.com");
  const duplicate = context.syncOfflineEvents_([event], "admin@example.com");

  assert.equal(first.results[0].result.success, false);
  assert.equal(retry.results[0].result.success, true);
  assert.equal(duplicate.results[0].result.success, true);
  assert.equal(applyCount, 2);
});

test("lists only valid attendance date columns without duplicate dates", () => {
  const { context } = createBackendContext();
  const headers = [
    new Date(2025, 0, 5, 12),
    new Date(2025, 0, 5, 12),
    new Date(2025, 0, 8, 12),
    "not a date",
  ];
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => name === "Attendance"
      ? {
          getLastColumn: () => headers.length + 2,
          getLastRow: () => 1,
          getRange: (row, column, rowCount, columnCount) => ({
            getValues: () => [headers.slice(column - 3, column - 3 + columnCount)],
          }),
        }
      : null,
  });

  const result = context.getAttendanceDates_();

  assert.deepEqual(Array.from(result.dates), ["2025-01-05", "2025-01-08"]);
});

test("checks for an active check-in before delegating report check-out to scan flow", () => {
  const { context } = createBackendContext();
  const checkinDate = vm.runInContext("new Date()", context);
  const rows = [[
    "1",
    "Attendee",
    checkinDate,
    "Test Admin",
    "",
    "",
    "",
    "Active",
  ]];
  let processScanCount = 0;
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => name === "Check-in & Check-out"
      ? {
          getLastRow: () => rows.length + 1,
          getRange: () => ({ getValues: () => rows }),
        }
      : null,
  });
  context.encryptId = (id) => `qr:${id}`;
  context.processScan = (token, email) => {
    processScanCount += 1;
    return { kind: "out", token, email };
  };

  const checkedOut = context.checkoutAttendance_("1", "admin@example.com");
  rows[0][4] = vm.runInContext("new Date()", context);
  const alreadyCheckedOut = context.checkoutAttendance_("1", "admin@example.com");

  assert.equal(checkedOut.kind, "out");
  assert.equal(checkedOut.token, "qr:1");
  assert.equal(alreadyCheckedOut.kind, "error");
  assert.equal(processScanCount, 1);
});

test("logs an emergency check-out reason and rejects a missing reason", () => {
  const { context } = createBackendContext();
  const now = new Date();
  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  let schedule = {
    startTime: formatTime(new Date(now.getTime() + 2 * 60 * 60 * 1000)),
    endTime: formatTime(new Date(now.getTime() + 3 * 60 * 60 * 1000)),
    allowedDays: [now.getDay()],
  };
  context.getSettings = () => schedule;
  const checkinDate = vm.runInContext("new Date()", context);
  const rows = [[
    "1",
    "Attendee",
    checkinDate,
    "Test Admin",
    "",
    "",
    "",
    "Active",
  ]];
  const auditRows = [];
  const checkinSheet = {
    getLastRow: () => rows.length + 1,
    getRange: () => ({ getValues: () => rows }),
  };
  const auditSheet = { appendRow: (row) => auditRows.push(row) };
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => {
      if (name === "Check-in & Check-out") return checkinSheet;
      if (name === "Emergency Check-out") return auditSheet;
      return null;
    },
    insertSheet: (name) => {
      assert.equal(name, "Emergency Check-out");
      return auditSheet;
    },
  });
  context.encryptId = (id) => `qr:${id}`;
  context.getAdminNameByEmail = () => "Test Admin";
  context.processScan = (token, email, timestamp, emergency) => ({
    kind: emergency ? "out" : "warn",
    token,
    email,
    name: "Attendee",
  });

  const missingReason = context.checkoutAttendance_("1", "admin@example.com", "", true);
  const closedWindow = context.checkoutAttendance_(
    "1",
    "admin@example.com",
    "Medical emergency",
    true,
  );
  schedule = {
    startTime: formatTime(new Date(now.getTime() - 60 * 60 * 1000)),
    endTime: formatTime(new Date(now.getTime() + 60 * 60 * 1000)),
    allowedDays: [new Date(now.getTime() - 60 * 60 * 1000).getDay()],
  };
  const result = context.checkoutAttendance_(
    "1",
    "admin@example.com",
    "Medical emergency",
    true,
  );

  assert.equal(missingReason.code, "INVALID_EMERGENCY_REASON");
  assert.equal(closedWindow.code, "ATTENDANCE_WINDOW_CLOSED");
  assert.equal(result.kind, "out");
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0][4], "Medical emergency");
});

test("returns only active check-ins with schedule-window state", () => {
  const { context } = createBackendContext();
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const addMinutes = (date, minutes) => {
    const value = new Date(date.getTime() + minutes * 60000);
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  };
  context.getSettings = () => ({
    startTime: addMinutes(now, -60),
    endTime: addMinutes(now, 15),
    allowedDays: [now.getDay()],
  });
  const rows = [
    ["1", "Active person", vm.runInContext("new Date()", context), "A", "", "", "", "Active"],
    ["2", "Cancelled person", vm.runInContext("new Date()", context), "A", "", "", "", "Cancelled"],
    ["3", "Checked out person", vm.runInContext("new Date()", context), "A", new Date(), "A", "", "Active"],
  ];
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => name === "Check-in & Check-out"
      ? {
          getLastRow: () => rows.length + 1,
          getRange: () => ({ getValues: () => rows }),
        }
      : null,
  });

  const result = context.getCurrentAttendees_();

  assert.equal(result.success, true);
  assert.deepEqual(Array.from(result.attendees, (person) => person.id), ["1"]);
  assert.equal(result.windowOpen, true);
  assert.equal(result.checkoutOpen, true);
});

test("keeps current-attendance management open through the checkout window", () => {
  const { context } = createBackendContext();
  const meetingDay = new Date(2026, 9, 19, 10, 0, 0, 0);
  const settings = {
    startTime: "10:00",
    endTime: "12:00",
    allowedDays: [meetingDay.getDay()],
  };
  const at = (hour, minute) => {
    const date = new Date(meetingDay);
    date.setHours(hour, minute, 0, 0);
    return date;
  };

  assert.equal(context.isCurrentAttendanceWindowOpen_(at(9, 59), settings), false);
  assert.equal(context.isCurrentAttendanceWindowOpen_(at(10, 0), settings), true);
  assert.equal(context.isCurrentAttendanceWindowOpen_(at(12, 30), settings), true);
  assert.equal(context.isCurrentAttendanceWindowOpen_(at(13, 0), settings), true);
  assert.equal(context.isCurrentAttendanceWindowOpen_(at(13, 1), settings), false);
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
