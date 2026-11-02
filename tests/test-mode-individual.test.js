const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const testModeRoot = path.join(root, "TestMode");
const backendSource = fs.readFileSync(
  path.join(testModeRoot, "Backend", "Code.js"),
  "utf8",
);
const frontendSource = fs.readFileSync(
  path.join(testModeRoot, "Frontend", "js", "app-individual.js"),
  "utf8",
);
const viewsSource = fs.readFileSync(
  path.join(testModeRoot, "Frontend", "js", "app-views.js"),
  "utf8",
);
const htmlSource = fs.readFileSync(
  path.join(testModeRoot, "Frontend", "index.html"),
  "utf8",
);
const serviceWorkerSource = fs.readFileSync(
  path.join(testModeRoot, "Frontend", "sw.js"),
  "utf8",
);

function makeSheet(rows, id = 1) {
  const data = rows.map((row) => row.slice());
  const sheet = {
    data,
    getLastRow: () => data.length,
    getLastColumn: () =>
      data.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    getSheetId: () => id,
    setFrozenRows(rowCount) {
      this.frozenRows = rowCount;
    },
    setName(name) {
      this.name = name;
      return this;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              data[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? "",
            ),
          );
        },
        getValue() {
          return data[row - 1]?.[column - 1] ?? "";
        },
        setValues(values) {
          values.forEach((valuesRow, rowOffset) => {
            data[row - 1 + rowOffset] = data[row - 1 + rowOffset] || [];
            valuesRow.forEach((value, columnOffset) => {
              data[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        setHorizontalAlignment() {
          return this;
        },
        setVerticalAlignment() {
          return this;
        },
        setWrap() {
          return this;
        },
        setBorder() {
          return this;
        },
        setFontSize() {
          return this;
        },
        setBackground() {
          return this;
        },
        setFontColor() {
          return this;
        },
        setFontWeight() {
          return this;
        },
      };
    },
    setColumnWidth() {},
  };
  return sheet;
}

function createBackendContext() {
  const markerSheet = {
    getRange: () => ({ getValue: () => "LAMBAS_TEST_ONLY" }),
  };
  const rosterSheet = makeSheet([
    ["ID", "Name", "Birthdate", "Phone", "Drive Link", "Status"],
    [7, "Sample Person", "02-29", "555-0100", "", "Active"],
    [8, "Inactive Person", "", "", "", "Inactive"],
  ]);
  const attendanceSheet = makeSheet([
    [
      "ID",
      "Name",
      "2025-03-04",
      "2025-03-11",
      "2025-03-18",
      "2025-03-25",
      "2025-04-01",
      "2025-04-08",
    ],
    [7, "Sample Person", "++", "+", "", "-", "?", ""],
  ]);
  const checkinRows = [
    ["ID", "Name", "Check-in", "By", "Check-out", "Out By", "Delay", "Status"],
  ];
  const checkinSheet = makeSheet(checkinRows);
  const temporarySheets = [];
  const openedSpreadsheetIds = [];
  const movedFileIds = [];
  const trashedFileIds = [];
  const fetchedUrls = [];
  const createdTemporaryNames = [];
  const reconciliationFiles = [];
  const trashFailureIds = [];
  const errorLogs = [];
  let temporarySpreadsheetCount = 0;
  const sourceSheets = new Map([
    ["_TEST_MODE", markerSheet],
    ["Roster", rosterSheet],
    ["Attendance", attendanceSheet],
    ["Check-in & Check-out", checkinSheet],
  ]);
  const testSpreadsheet = {
    getSheetByName: (name) => sourceSheets.get(name) || null,
    getSpreadsheetTimeZone: () => "UTC",
  };
  const temporaryFolder = {
    getDescription: () => "LAMBAS_TEST_ONLY",
    getFiles() {
      let index = 0;
      return {
        hasNext: () => index < reconciliationFiles.length,
        next: () => reconciliationFiles[index++],
      };
    },
  };
  const properties = {
    TEST_MODE_ENABLED: "true",
    TEST_SPREADSHEET_ID: "only-test-spreadsheet",
    PRODUCTION_SPREADSHEET_ID: "never-open-this",
    TEST_EXPORT_FOLDER_ID: "only-test-export-folder",
  };
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] || null,
        setProperty: (key, value) => {
          properties[key] = value;
        },
        deleteProperty: (key) => {
          delete properties[key];
        },
        getProperties: () => ({ ...properties }),
      }),
    },
    SpreadsheetApp: {
      openById(id) {
        openedSpreadsheetIds.push(id);
        if (id !== "only-test-spreadsheet")
          throw new Error("A non-test spreadsheet was requested.");
        return testSpreadsheet;
      },
      create(name) {
        temporarySpreadsheetCount++;
        createdTemporaryNames.push(name);
        const sheet = makeSheet([], 91);
        temporarySheets.push(sheet);
        return {
          getId: () => `temporary-test-export-${temporarySpreadsheetCount}`,
          getSheets: () => [sheet],
          deleteSheet() {},
        };
      },
      getActiveSpreadsheet() {
        throw new Error("Active spreadsheet access is forbidden.");
      },
    },
    DriveApp: {
      getFolderById(id) {
        assert.equal(id, "only-test-export-folder");
        return temporaryFolder;
      },
      getFileById(id) {
        return {
          moveTo(folder) {
            assert.equal(folder, temporaryFolder);
            movedFileIds.push(id);
          },
          setTrashed() {
            if (trashFailureIds.includes(id)) {
              throw new Error("Mock cleanup failure");
            }
            trashedFileIds.push(id);
          },
        };
      },
    },
    UrlFetchApp: {
      fetch(url, options) {
        fetchedUrls.push({ url, options });
        return {
          getResponseCode: () => 200,
          getBlob: () => ({ getBytes: () => [1, 2, 3] }),
        };
      },
    },
    ScriptApp: { getOAuthToken: () => "test-only-oauth-token" },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        setMimeType: () => JSON.parse(content),
      }),
    },
    Utilities: {
      formatDate(date, _timeZone, format) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        if (format === "MM-dd") return `${month}-${day}`;
        if (format === "yyyy-MM-dd|HH|mm|u") {
          const weekday = date.getUTCDay() || 7;
          return `${year}-${month}-${day}|12|00|${weekday}`;
        }
        return `${year}-${month}-${day}`;
      },
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
      base64Decode: (value) => [...Buffer.from(value, "base64")],
      computeDigest: () => [],
      DigestAlgorithm: { SHA_256: "SHA-256" },
    },
    Session: { getScriptTimeZone: () => "UTC" },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {},
      }),
    },
    console: {
      error(...args) { errorLogs.push(args); },
      warn() {},
      log() {},
    },
    openedSpreadsheetIds,
    temporarySheets,
    movedFileIds,
    trashedFileIds,
    fetchedUrls,
    createdTemporaryNames,
    reconciliationFiles,
    trashFailureIds,
    errorLogs,
    get temporarySpreadsheetCount() {
      return temporarySpreadsheetCount;
    },
  };
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
    `TEST_MODE_ALLOWED_EMAILS.splice(0, TEST_MODE_ALLOWED_EMAILS.length, "tester@example.com");`,
    context,
  );
  checkinSheet.data.push(
    [7, "Sample Person", makeDate(context, "2025-03-11"), "", "", "", "15 minutes", "Active"],
    [7, "Sample Person", makeDate(context, "2025-03-18"), "", "", "", "", "Active"],
  );
  context.verifyGoogleIdToken_ = (token) => ({
    success: true,
    email: token === "test-token" ? "tester@example.com" : "outsider@example.com",
  });
  return context;
}

function post(context, action, values = {}, idToken = "test-token") {
  return context.doPost({
    postData: {
      contents: JSON.stringify({ action, idToken, ...values }),
    },
  });
}

function makeDate(context, date) {
  return vm.runInContext(`new Date("${date}T12:00:00.000Z")`, context);
}

test("individual attendance filters inclusively and preserves four evidence states", () => {
  const context = createBackendContext();
  const result = post(context, "get_individual_attendance", {
    id: "7",
    fromDate: "2025-03-04",
    toDate: "2025-04-08",
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    result.meetings.map((meeting) => [meeting.date, meeting.state]),
    [
      ["2025-03-04", "present"],
      ["2025-03-11", "late"],
      ["2025-03-18", "present"],
      ["2025-03-25", "absent"],
      ["2025-04-01", "unknown"],
      ["2025-04-08", "unknown"],
    ],
  );
  assert.ok(result.meetings.every((meeting) => meeting.meetingType === ""));

  const edgeRange = post(context, "get_individual_attendance", {
    id: "7",
    fromDate: "2025-03-11",
    toDate: "2025-03-25",
  });
  assert.deepEqual(
    edgeRange.meetings.map((meeting) => meeting.date),
    ["2025-03-11", "2025-03-18", "2025-03-25"],
  );
});

test("individual attendance rejects invalid and reversed ranges and inactive people", () => {
  const context = createBackendContext();
  const reversed = post(context, "get_individual_attendance", {
    id: "7",
    fromDate: "2025-03-25",
    toDate: "2025-03-11",
  });
  assert.equal(reversed.code, "INVALID_ATTENDANCE_RANGE");

  const invalidDate = post(context, "get_individual_attendance", {
    id: "7",
    fromDate: "2025-02-29",
    toDate: "2025-03-11",
  });
  assert.equal(invalidDate.code, "INVALID_PERSON_ATTENDANCE_REQUEST");

  const inactive = post(context, "get_individual_attendance", {
    id: "8",
    fromDate: "2025-03-04",
    toDate: "2025-03-11",
  });
  assert.equal(inactive.code, "PERSON_NOT_FOUND");
});

test("individual exports use only the marked test folder and clean temporary spreadsheets", () => {
  for (const format of ["pdf", "xlsx"]) {
    const context = createBackendContext();
    const result = post(context, "export_individual_attendance_report", {
      id: "7",
      fromDate: "2025-03-04",
      toDate: "2025-03-11",
      format,
    });

    assert.equal(result.success, true);
    assert.equal(result.format, format);
    assert.match(result.filename, new RegExp(`\\.${format}$`));
    assert.equal(result.base64, "AQID");
    assert.deepEqual(context.openedSpreadsheetIds, ["only-test-spreadsheet"]);
    assert.equal(context.temporarySpreadsheetCount, 1);
    assert.equal(context.movedFileIds.length, 1);
    assert.equal(context.trashedFileIds.length, 1);
    assert.equal(context.fetchedUrls.length, 1);
    assert.match(
      context.createdTemporaryNames[0],
      /^TEST_TMP_EXPORT_INDIVIDUAL_7_2025-03-04_2025-03-11_\d{13}$/,
    );
    assert.match(context.fetchedUrls[0].url, new RegExp(`format=${format}`));
    assert.deepEqual(context.temporarySheets[0].data[3], [
      "2025-03-04",
      "",
      "present",
      "",
    ]);
    if (format === "pdf") {
      const parameters = new URL(context.fetchedUrls[0].url).searchParams;
      assert.equal(parameters.get("size"), "A4");
      assert.equal(parameters.get("scale"), "2");
      assert.equal(parameters.get("fzr"), "true");
      assert.equal(parameters.get("pagenumbers"), "true");
      assert.equal(context.temporarySheets[0].frozenRows, 3);
    } else {
      assert.equal(
        context.temporarySheets[0].data[2][0],
        "Date",
        "Excel exports must contain structured report headers",
      );
    }
  }
});

test("individual export reports cleanup failure and logs the temporary resource ID", () => {
  const context = createBackendContext();
  context.trashFailureIds.push("temporary-test-export-1");

  const result = post(context, "export_individual_attendance_report", {
    id: "7",
    fromDate: "2025-03-04",
    toDate: "2025-03-11",
    format: "pdf",
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "TEMP_EXPORT_CLEANUP_FAILED");
  assert.equal(result.temporaryResourceId, "temporary-test-export-1");
  assert.equal(context.errorLogs.length, 1);
  assert.match(context.errorLogs[0][0], /temporary-test-export-1/);
});

test("daily export still succeeds when temporary spreadsheet cleanup succeeds", () => {
  const context = createBackendContext();
  const copiedSheet = makeSheet([], 92);
  context.getAttendanceDayReport_ = () => ({
    success: true,
    report: { name: "Attendance 2025-03-04" },
    date: "2025-03-04",
  });
  context.getTestSpreadsheet_ = () => ({
    getSheetByName: () => ({ copyTo: () => copiedSheet }),
  });

  const result = context.exportDailyAttendanceReportFile_(
    "2025-03-04",
    "both",
    "pdf",
  );

  assert.equal(result.success, true);
  assert.equal(result.filename, "attendance-2025-03-04.pdf");
  assert.equal(context.trashedFileIds.length, 1);
  assert.equal(copiedSheet.frozenRows, 1);
  const parameters = new URL(context.fetchedUrls[0].url).searchParams;
  assert.equal(parameters.get("fzr"), "true");
  assert.equal(parameters.get("scale"), "2");
  assert.match(
    context.createdTemporaryNames[0],
    /^TEST_TMP_EXPORT_DAILY_2025-03-04_\d{13}$/,
  );
});

test("stale reconciliation trashes only old, named Test Mode exports in the configured folder", () => {
  const context = createBackendContext();
  const now = Date.now();
  const staleCreatedAt = now - 48 * 60 * 60 * 1000;
  const recentCreatedAt = now - 60 * 60 * 1000;
  const staleTimestamp = String(staleCreatedAt);
  const recentTimestamp = String(recentCreatedAt);
  const makeDriveFile = (id, name, createdAt, mimeType = "application/vnd.google-apps.spreadsheet") => ({
    getId: () => id,
    getName: () => name,
    getDateCreated: () => new Date(createdAt),
    getMimeType: () => mimeType,
    setTrashed(value) {
      assert.equal(value, true);
      context.trashedFileIds.push(id);
    },
  });
  context.reconciliationFiles.push(
    makeDriveFile(
      "stale-daily-export",
      `TEST_TMP_EXPORT_DAILY_2025-03-04_${staleTimestamp}`,
      staleCreatedAt,
    ),
    makeDriveFile(
      "stale-individual-export",
      `TEST_TMP_EXPORT_INDIVIDUAL_7_2025-03-04_2025-03-11_${staleTimestamp}`,
      staleCreatedAt,
    ),
    makeDriveFile(
      "recent-export",
      `TEST_TMP_EXPORT_DAILY_2025-03-04_${recentTimestamp}`,
      recentCreatedAt,
    ),
    makeDriveFile(
      "other-file",
      "Attendance export 2025-03-04",
      now - 48 * 60 * 60 * 1000,
    ),
    makeDriveFile(
      "bad-date-export",
      `TEST_TMP_EXPORT_DAILY_2025-02-30_${staleTimestamp}`,
      staleCreatedAt,
    ),
    makeDriveFile(
      "non-spreadsheet-export",
      `TEST_TMP_EXPORT_DAILY_2025-03-04_${staleTimestamp}`,
      staleCreatedAt,
      "application/pdf",
    ),
  );

  const result = context.reconcileStaleTestExports();

  assert.equal(result.success, true);
  assert.equal(result.trashedCount, 2);
  assert.deepEqual(context.trashedFileIds, [
    "stale-daily-export",
    "stale-individual-export",
  ]);
});

test("stale reconciliation includes exports exactly 24 hours old", () => {
  const context = createBackendContext();
  const fixedNow = Date.UTC(2025, 2, 5, 12, 0, 0);
  vm.runInContext(`Date.now = () => ${fixedNow};`, context);
  const exactCutoff = fixedNow - 24 * 60 * 60 * 1000;
  const fileId = "exact-cutoff-export";
  context.reconciliationFiles.push({
    getId: () => fileId,
    getName: () => `TEST_TMP_EXPORT_DAILY_2025-03-04_${exactCutoff}`,
    getDateCreated: () => new Date(exactCutoff),
    getMimeType: () => "application/vnd.google-apps.spreadsheet",
    setTrashed(value) {
      assert.equal(value, true);
      context.trashedFileIds.push(fileId);
    },
  });

  const result = context.reconcileStaleTestExports();

  assert.equal(result.success, true);
  assert.equal(result.trashedCount, 1);
  assert.deepEqual(context.trashedFileIds, [fileId]);
});

test("stale reconciliation reports setTrashed failures explicitly", () => {
  const context = createBackendContext();
  const fixedNow = Date.UTC(2025, 2, 5, 12, 0, 0);
  vm.runInContext(`Date.now = () => ${fixedNow};`, context);
  const staleCreatedAt = fixedNow - 48 * 60 * 60 * 1000;
  const failedFileId = "failed-stale-export";
  context.reconciliationFiles.push({
    getId: () => failedFileId,
    getName: () => `TEST_TMP_EXPORT_DAILY_2025-03-03_${staleCreatedAt}`,
    getDateCreated: () => new Date(staleCreatedAt),
    getMimeType: () => "application/vnd.google-apps.spreadsheet",
    setTrashed() {
      throw new Error("Mock reconciliation failure");
    },
  });

  const result = context.reconcileStaleTestExports();

  assert.equal(result.success, false);
  assert.equal(result.code, "TEMP_EXPORT_RECONCILIATION_FAILED");
  assert.equal(
    result.message,
    "One or more stale Test Mode exports could not be removed.",
  );
  assert.equal(result.trashedCount, 0);
  assert.deepEqual(Array.from(result.failedResourceIds), [failedFileId]);
  assert.equal(context.errorLogs.length, 1);
  assert.match(context.errorLogs[0][0], new RegExp(failedFileId));
});

test("long attendance images paginate at row boundaries within the canvas height", () => {
  const context = vm.createContext({
    window: { addEventListener() {} },
    updateOfflineStatus() {},
  });
  vm.runInContext(viewsSource, context);

  const pages = context.paginateAttendanceImageRows(
    [80, 80, 80, 80, 80],
    300,
    100,
  );
  assert.deepEqual(
    Array.from(pages, (page) => [page.startIndex, page.endIndex]),
    [[0, 2], [2, 4], [4, 5]],
  );
  assert.ok(pages.every((page) => page.startIndex < page.endIndex));

  assert.deepEqual(
    Array.from(
      context.paginateAttendanceImageRows([], 300, 100),
      (page) => [page.startIndex, page.endIndex],
    ),
    [[0, 0]],
  );
});

test("attendance image text wraps long names instead of clipping them", () => {
  const context = vm.createContext({
    window: { addEventListener() {} },
    updateOfflineStatus() {},
  });
  vm.runInContext(viewsSource, context);
  const canvasContext = {
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
  };

  assert.deepEqual(
    Array.from(
      context.wrapAttendanceImageText(
        canvasContext,
        "A verylongpersonname",
        60,
      ),
      String,
    ),
    ["A", "verylo", "ngpers", "onname"],
  );
});

test("individual API actions still enforce Test Mode allowlisting before data access", () => {
  const context = createBackendContext();
  const denied = post(
    context,
    "get_individual_attendance",
    {
      id: "7",
      fromDate: "2025-03-04",
      toDate: "2025-03-11",
    },
    "outsider-token",
  );
  assert.equal(denied.code, "TEST_MODE_ACCESS_DENIED");
  const deniedExport = post(
    context,
    "export_individual_attendance_report",
    {
      id: "7",
      fromDate: "2025-03-04",
      toDate: "2025-03-11",
      format: "pdf",
    },
    "outsider-token",
  );
  assert.equal(deniedExport.code, "TEST_MODE_ACCESS_DENIED");
  assert.deepEqual(context.openedSpreadsheetIds, []);
});

test("birthday week starts Tuesday and ends Monday across weekday boundaries", () => {
  const context = vm.createContext({});
  vm.runInContext(frontendSource, context);
  const date = (value) => makeDate(context, value);
  const weekStart = (value) => {
    const start = context.getBirthdayWeekStart(date(value));
    return [
      start.getFullYear(),
      String(start.getMonth() + 1).padStart(2, "0"),
      String(start.getDate()).padStart(2, "0"),
    ].join("-");
  };

  assert.equal(weekStart("2026-11-03"), "2026-11-03");
  assert.equal(weekStart("2026-11-02"), "2026-10-27");
  assert.equal(weekStart("2026-11-08"), "2026-11-03");
  assert.equal(
    context.isValidIndividualDateRange("2025-03-11", "2025-03-11"),
    true,
  );
  assert.equal(
    context.isValidIndividualDateRange("2025-03-12", "2025-03-11"),
    false,
  );
  assert.equal(
    context.isValidIndividualDateRange("2025-02-29", "2025-03-11"),
    false,
  );
  assert.match(
    viewsSource,
    /function notifyBirthdayRoster\(roster\) \{[\s\S]*?getBirthdayWeekStart\(today\)/,
  );
  assert.match(
    viewsSource,
    /function renderBirthdays\(now = new Date\(\)\) \{[\s\S]*?getBirthdayWeekStart\(today\)/,
  );
});

test("Test Mode exposes accessible individual search and guards API-backed saves offline", () => {
  assert.match(htmlSource, /id="individualSearchAction"[^>]+data-online-only/);
  assert.match(htmlSource, /id="individualPersonSearch"[^>]+type="search"/);
  assert.match(htmlSource, /id="individualAttendanceFrom"[^>]+type="date"/);
  assert.match(htmlSource, /id="individualAttendanceTo"[^>]+type="date"/);
  assert.match(htmlSource, /id="individualExportImage"/);
  assert.match(htmlSource, /id="individualExportPdf"/);
  assert.match(htmlSource, /id="individualExportExcel"/);
  assert.match(htmlSource, /id="saveAttendeeProfileButton"[^>]+data-online-only/);
  assert.match(htmlSource, /app-individual\.js\?v=1/);
  assert.match(serviceWorkerSource, /app-individual\.js\?v=1/);
  assert.match(
    viewsSource,
    /async function saveAttendeeProfile\(event\) \{[\s\S]*?if \(!navigator\.onLine\)[\s\S]*?apiCall\("update_roster_person"/,
  );
  assert.match(frontendSource, /if \(!navigator\.onLine\) \{\s*showToast/);
});
