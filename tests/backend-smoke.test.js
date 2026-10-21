const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backendSource = fs.readFileSync(
  path.join(__dirname, "..", "Backend", "Code.js"),
  "utf8",
);

function createBackendContext(
  rosterRows = [["ID", "Name", "Card URL"]],
  { stubCardGeneration = true } = {},
) {
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
      formatDate: (date, timeZone, pattern) => {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            weekday: "short",
          }).formatToParts(date).map((part) => [part.type, part.value]),
        );
        const weekday = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        if (pattern !== "yyyy-MM-dd|HH|mm|u") throw new Error("Unsupported date format");
        return `${parts.year}-${parts.month}-${parts.day}|${parts.hour}|${parts.minute}|${weekday[parts.weekday]}`;
      },
    },
    Session: { getScriptTimeZone: () => "UTC" },
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
  context.getSettings = () => ({
    startTime: "10:00",
    endTime: "12:00",
    acceptedDelay: 15,
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
    password: "current-password",
  });
  context.getAdminNameByEmail = () => "Test Admin";
  context.isAttendanceTimeAllowed = () => false;
  if (stubCardGeneration) {
    context.generateAllCardsFromRoster = (id) => ({
      success: true,
      cards: [{ id, driveUrl: `https://drive.google.com/file/d/card-${id}` }],
    });
  }

  return {
    context,
    rosterSheet,
    scriptPropertiesStore,
    tokenResponses,
    getTokenFetchCount: () => tokenFetchCount,
  };
}

function createMutableSheet(rows) {
  return {
    rows,
    getLastRow() {
      return this.rows.length;
    },
    getLastColumn() {
      return Math.max(0, ...this.rows.map((row) => row.length));
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      const sheet = this;
      return {
        getValues() {
          return sheet.rows
            .slice(row - 1, row - 1 + rowCount)
            .map((values) => values.slice(column - 1, column - 1 + columnCount));
        },
        setValues(values) {
          values.forEach((valuesRow, rowOffset) => {
            const targetRow = row - 1 + rowOffset;
            sheet.rows[targetRow] ||= [];
            valuesRow.forEach((value, columnOffset) => {
              sheet.rows[targetRow][column - 1 + columnOffset] = value;
            });
          });
        },
        setValue(value) {
          sheet.rows[row - 1] ||= [];
          sheet.rows[row - 1][column - 1] = value;
        },
        setBackground() {},
      };
    },
    appendRow(values) {
      this.rows.push(values);
    },
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

test("manages roster names and archives people without removing historical rows", () => {
  const rosterSheet = createMutableSheet([
    ["ID", "Name", "Card URL", "Status"],
    [1, "Alice", "", "Active"],
    [2, "Bob", "", "Active"],
  ]);
  const sheets = new Map([["Roster", rosterSheet]]);
  const { context } = createBackendContext();
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = createMutableSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  assert.deepEqual(
    Array.from(context.getRosterManagement_().people, (person) => person.name),
    ["Alice", "Bob"],
  );
  const saved = context.updateRosterPerson_("1", "Alice Smith", false, "admin@example.com");
  assert.equal(saved.success, true);
  assert.deepEqual(rosterSheet.rows[1], [1, "Alice Smith", "", "Inactive"]);
  assert.deepEqual(
    Array.from(context.getRosterSnapshot_(), (person) => [person.id, person.name]),
    [["2", "Bob"]],
  );
  assert.equal(sheets.get("Roster Audit").rows.length, 2);
});

test("attendance trends summarize recent meeting attendance rates", () => {
  const { context } = createBackendContext();
  const today = context.attendanceSessionDateKey_(new Date(), context.getSettings());
  const previous = context.previousAttendanceDateKey_(today);
  const rosterSheet = createMutableSheet([
    ["ID", "Name", "Card URL", "Status"],
    [1, "Alice", "", "Active"],
    [2, "Bob", "", "Active"],
  ]);
  const attendanceSheet = createMutableSheet([
    ["ID", "Name", previous, today],
    [1, "Alice", "++", "+"],
    [2, "Bob", "", ""],
  ]);
  const sheets = new Map([
    ["Roster", rosterSheet],
    ["Attendance", attendanceSheet],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = createMutableSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const result = context.getAttendanceTrends_(8);
  assert.equal(result.success, true);
  assert.equal(result.trends.length, 2);
  assert.deepEqual(
    [
      result.trends[1].attended,
      result.trends[1].absent,
      result.trends[1].delayed,
      result.trends[1].attendanceRate,
    ],
    [1, 1, 1, 50],
  );
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

test("generates a card with one QR image and no QR frame", () => {
  const { context } = createBackendContext(
    [
      ["ID", "Name", "Card URL"],
      [7, "Alice", ""],
    ],
    { stubCardGeneration: false },
  );
  const rosterSheet = {
    getLastRow: () => 2,
    getRange: () => ({
      getValues: () => [[7, "Alice", ""]],
      setValue: () => {},
    }),
  };
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: () => rosterSheet,
  });

  const qrBlob = { setName(name) { this.name = name; return this; } };
  const templateBlob = {};
  const exportBlob = { setName(name) { this.name = name; return this; } };
  const insertedImages = [];
  let insertedTextBoxGeometry = null;
  let insertedTextBoxFontSize = null;
  const textStyle = {
    setFontSize(size) { insertedTextBoxFontSize = size; return this; },
    setBold() { return this; },
    setForegroundColor() { return this; },
    setFontFamily() { return this; },
  };
  const textBox = {
    getText: () => ({
      getParagraphStyle: () => ({ setParagraphAlignment() {} }),
      getTextStyle: () => textStyle,
    }),
  };
  const slide = {
    getPageElements: () => [],
    insertImage(blob, ...geometry) {
      insertedImages.push({ blob, geometry });
    },
    insertTextBox: (_text, ...geometry) => {
      insertedTextBoxGeometry = geometry;
      return textBox;
    },
    getObjectId: () => "slide-1",
  };
  const presentation = {
    getSlides: () => [slide],
    getId: () => "presentation-1",
    saveAndClose() {},
  };
  const finalFile = {
    setSharing() {},
    getUrl: () => "https://drive.google.com/file/d/card-7",
  };
  context.DriveApp = {
    Access: { ANYONE_WITH_LINK: "anyone" },
    Permission: { VIEW: "view" },
    getFolderById: () => ({ createFile: () => finalFile }),
    getFileById: (id) => id === "test-image-template"
      ? { getBlob: () => templateBlob }
      : {
        getBlob: () => ({}),
        makeCopy: () => ({
          getId: () => "presentation-1",
          setTrashed() {},
        }),
      },
  };
  context.SlidesApp = {
    ParagraphAlignment: { CENTER: "center" },
    openById: () => presentation,
  };
  context.ScriptApp = { getOAuthToken: () => "test-token" };
  context.Utilities.base64Encode = (value) => Buffer.from(value).toString("base64");
  const errors = [];
  context.console = { error: (...args) => errors.push(args) };
  context.UrlFetchApp.fetch = (url) => ({
    getResponseCode: () => 200,
    getBlob: () => url.includes("api.qrserver.com") ? qrBlob : exportBlob,
  });

  const result = context.generateAllCardsFromRoster(7);

  assert.equal(result.success, true, String(errors[0]?.[1]));
  assert.equal(insertedImages.length, 2);
  assert.equal(insertedImages[0].blob, templateBlob);
  assert.equal(insertedImages[1].blob, qrBlob);
  assert.deepEqual(Array.from(insertedImages[0].geometry), [0, -20, 400, 600]);
  assert.deepEqual(Array.from(insertedImages[1].geometry), [120, 300, 160, 160]);
  assert.deepEqual(Array.from(insertedTextBoxGeometry), [65, 469, 240, 30]);
  assert.equal(insertedTextBoxFontSize, 25);
  assert.equal(qrBlob.name, "Alice.png");
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
        setBackground: (color) => {
          sheet.backgrounds ||= {};
          sheet.backgrounds[`${row}:${column}`] = color;
        },
      };
    },
    backgrounds: {},
  };

  context.setAttendanceMark_(sheet, 18, new Date(), "+");

  assert.deepEqual(rows[1], [17, "Alice", "", ""]);
  assert.deepEqual(rows[2], [18, "Bob", "+", ""]);
  assert.equal(sheet.backgrounds["3:3"], "#f6b26b");
});

test("attendance marks discard embedded delay text and apply the requested colors", () => {
  const { context } = createBackendContext();
  const date = new Date();
  const rows = [["ID", "Name", date], [7, "Sam", ""]];
  const backgrounds = [];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValue: (value) => { rows[row - 1][column - 1] = value; },
        setBackground: (color) => backgrounds.push(color),
      };
    },
  };

  context.setAttendanceMark_(sheet, 7, date, "+ 30 دقيقة");
  assert.equal(rows[1][2], "+");
  context.setAttendanceMark_(sheet, 7, date, "++");
  context.setAttendanceMark_(sheet, 7, date, "-");

  assert.equal(rows[1][2], "-");
  assert.deepEqual(backgrounds, ["#f6b26b", "#93c47d", "#ffe599"]);
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
    [3, "Charlie", ""],
  ]);
  const meetingDate = new Date(2026, 9, 18, 12);
  const makeSheet = (rows, sheetId = 0) => {
    const sheet = {
      rows,
      backgrounds: [],
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(...rows.map((row) => row.length)),
      getSheetId: () => sheetId,
      clearContents: () => { rows.length = 0; },
      formatting: {},
      getRange(row, column, rowCount, columnCount) {
        const range = {
          getValues: () => rows
            .slice(row - 1, row - 1 + rowCount)
            .map((values) => values.slice(column - 1, column - 1 + columnCount)),
          setValues: (values) => values.forEach((valuesRow, rowOffset) => {
            rows[row - 1 + rowOffset] = valuesRow.slice();
          }),
          setBackgrounds: (values) => { sheet.backgrounds = values; },
          setHorizontalAlignment: (value) => {
            sheet.formatting.horizontalAlignment = value;
            return range;
          },
          setVerticalAlignment: (value) => {
            sheet.formatting.verticalAlignment = value;
            return range;
          },
          setBackground: (value) => {
            sheet.formatting.headerBackground = value;
            return range;
          },
          setFontColor: (value) => {
            sheet.formatting.headerFontColor = value;
            return range;
          },
          setFontWeight: (value) => {
            sheet.formatting.headerFontWeight = value;
            return range;
          },
        };
        return range;
      },
    };
    return sheet;
  };
  const attendanceSheet = makeSheet([
    ["ID", "Name", meetingDate],
    [1, "Alice", "-"],
    [2, "Bob", ""],
    [3, "Charlie", "+ 1 ساعة و15 دقيقة"],
  ]);
  const checkinSheet = makeSheet([
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay", "Status"],
    [1, "Alice", new Date(2026, 9, 18, 10), "Admin", "", "", "", "Active"],
    [3, "Charlie", new Date(2026, 9, 18, 11, 15), "Admin", "", "", "1 ساعة و15 دقيقة", "Active"],
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
  assert.equal(report.count, 2);
  assert.equal(report.people[0].name, "Alice");
  assert.equal(report.people[1].name, "Bob");
  assert.equal(report.people[1].attended, false);
  assert.equal(report.matches[0].name, "Bob");
  assert.equal(report.matches[0].attended, false);
  assert.equal(report.report.sheetId, 77);
  assert.equal(report.people[2].state, "delayed");
  assert.equal(report.people[2].delay, "1 ساعة و15 دقيقة");
  assert.equal(sheets.get("Attendance 2026-10-18").rows.length, 4);
  assert.deepEqual(
    Array.from(sheets.get("Attendance 2026-10-18").rows[0]),
    ["Name", "Attendance Mark", "Delay"],
  );
  assert.deepEqual(
    Array.from(sheets.get("Attendance 2026-10-18").rows[1]),
    ["Alice", "++", ""],
  );
  assert.deepEqual(
    Array.from(sheets.get("Attendance 2026-10-18").rows[2]),
    ["Bob", "", ""],
  );
  assert.deepEqual(
    Array.from(sheets.get("Attendance 2026-10-18").rows[3]),
    ["Charlie", "+", "1 ساعة و15 دقيقة"],
  );
  assert.deepEqual(
    Array.from(sheets.get("Attendance 2026-10-18").backgrounds, (row) => Array.from(row)),
    [["#93c47d"], ["#ffffff"], ["#f6b26b"]],
  );
  assert.deepEqual(sheets.get("Attendance 2026-10-18").formatting, {
    horizontalAlignment: "center",
    verticalAlignment: "middle",
    headerBackground: "#f5bd55",
    headerFontColor: "#182333",
    headerFontWeight: "bold",
  });
  const preservedRows = JSON.stringify(sheets.get("Attendance 2026-10-18").rows);
  const existingReport = context.getAttendanceDayReport_("2026-10-18", "", true);
  assert.equal(existingReport.report.alreadyExists, true);
  assert.equal(existingReport.report.sheetId, 77);
  assert.equal(JSON.stringify(sheets.get("Attendance 2026-10-18").rows), preservedRows);

  const attendeeSheet = context.getAttendanceDayReport_(
    "2026-10-18",
    "",
    true,
    "attendees",
  );
  const absentSheet = context.getAttendanceDayReport_(
    "2026-10-18",
    "",
    true,
    "absents",
  );
  assert.equal(attendeeSheet.report.name, "Attendance 2026-10-18 - Attendees");
  assert.equal(attendeeSheet.exportedCount, 2);
  assert.equal(sheets.get(attendeeSheet.report.name).rows.length, 3);
  assert.deepEqual(
    Array.from(sheets.get(attendeeSheet.report.name).rows[2]),
    ["Charlie", "+", "1 ساعة و15 دقيقة"],
  );
  assert.equal(absentSheet.report.name, "Attendance 2026-10-18 - Absentees");
  assert.equal(absentSheet.exportedCount, 1);
  assert.deepEqual(
    Array.from(sheets.get(absentSheet.report.name).rows[1]),
    ["Bob", "", ""],
  );
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
    writeCount: 0,
    appendCount: 0,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(...rows.map((row) => row.length)),
    getRange(row, column, rowCount, columnCount) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValues: (values) => {
          this.writeCount++;
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
    appendRow(values) {
      this.appendCount++;
      rows.push(values);
    },
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
  const followupSheet = sheets.get("Follow-up");
  assert.equal(followupSheet.writeCount, 2);
  assert.equal(followupSheet.appendCount, 0);
  assert.equal(context.completeFollowup_("1", "admin@example.com").success, true);
  const refreshedList = context.getFollowupCandidates_();
  assert.deepEqual(
    Array.from(refreshedList.followups, (person) => person.id),
    [],
  );
  assert.equal(followupSheet.writeCount, 4);
});

test("cancels today's check-in by removing its row and retaining an audit record", () => {
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
    deleteRow: (row) => rows.splice(row - 1, 1),
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
  assert.equal(checkinRows.length, 1);
  assert.equal(attendanceRows[1][2], "");
  assert.equal(sheets.get("Attendance Audit").rows.length, 2);
  assert.equal(sheets.get("Attendance Audit").rows[1][4], "Test Admin");
  assert.equal(sheets.get("Attendance Audit").rows[1][5], "Check-in cancelled");
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

test("finds one roster row through an exact sheet text search", () => {
  const { context } = createBackendContext();
  let finderValue = "";
  let exactMatchEnabled = false;
  let caseSensitiveEnabled = false;
  const sheet = {
    getLastRow: () => 5,
    getRange(row, column, rowCount, columnCount) {
      if (column === 1 && rowCount === 4) {
        return {
          createTextFinder: (value) => {
            finderValue = value;
            return {
              matchEntireCell(value) {
                exactMatchEnabled = value;
                return this;
              },
              matchCase(value) {
                caseSensitiveEnabled = value;
                return this;
              },
              findNext: () => ({ getRow: () => 4 }),
            };
          },
          getValues: () => assert.fail("The entire roster should not be read"),
        };
      }
      assert.deepEqual([row, column, rowCount, columnCount], [4, 1, 1, 2]);
      return { getValues: () => [[7, "Alice"]] };
    },
  };

  const result = context.findExactRowByValue_(sheet, 1, 7, 2, 2);

  assert.deepEqual(Array.from(result), [7, "Alice"]);
  assert.equal(finderValue, "7");
  assert.equal(exactMatchEnabled, true);
  assert.equal(caseSensitiveEnabled, true);
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

test("evaluates attendance windows and dates in the spreadsheet timezone", () => {
  const { context } = createBackendContext();
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSpreadsheetTimeZone: () => "America/Los_Angeles",
    getSheetByName: () => null,
  });

  test("explains why the attendance window is closed", () => {
    const { context } = createBackendContext();
    const settings = {
      startTime: "10:00",
      endTime: "12:00",
      allowedDays: [0, 1, 2, 3, 4, 5, 6],
    };
    assert.equal(
      context.attendanceWindowCloseReason_(new Date("2026-10-21T08:00:00Z"), settings),
      "before_meeting",
    );
    assert.equal(
      context.attendanceWindowCloseReason_(new Date("2026-10-21T14:00:00Z"), settings),
      "after_meeting",
    );
    assert.equal(
      context.attendanceWindowCloseReason_(
        new Date("2026-10-21T08:00:00Z"),
        { ...settings, allowedDays: [] },
      ),
      "no_meeting_today",
    );
  });
  const sundayMeeting = {
    startTime: "10:00",
    endTime: "12:00",
    allowedDays: [0],
  };
  const duringMeeting = new Date("2026-10-18T18:00:00.000Z");
  const afterMeeting = new Date("2026-10-18T21:30:00.000Z");

  assert.equal(context.isCurrentAttendanceWindowOpen_(duringMeeting, sundayMeeting), true);
  assert.equal(context.isAttendanceTimeAllowedAt_(duringMeeting, sundayMeeting), true);
  assert.equal(context.isCurrentAttendanceWindowOpen_(afterMeeting, sundayMeeting), false);

  const overnightMeeting = {
    startTime: "22:00",
    endTime: "01:00",
    allowedDays: [0],
  };
  const afterMidnight = new Date("2026-10-19T06:00:00.000Z");
  assert.equal(context.isAttendanceTimeAllowedAt_(afterMidnight, overnightMeeting), true);
  assert.equal(context.attendanceSessionDateKey_(afterMidnight, overnightMeeting), "2026-10-18");
  assert.equal(context.attendanceDateKey_(afterMidnight), "2026-10-18");
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

test("checks out directly from the current-attendee action and audits the action", () => {
  const { context } = createBackendContext();
  const now = new Date();
  const backendDate = (date) =>
    vm.runInContext(`new Date(${date.getTime()})`, context);
  const pad = (value) => String(value).padStart(2, "0");
  const timeAtOffset = (minutes) => {
    const date = new Date(now.getTime() + minutes * 60000);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const checkinRows = [
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay", "Status"],
    [
    "1",
    "Attendee",
    backendDate(new Date(now.getTime() - 5 * 60000)),
    "Test Admin",
    "",
    "",
    "40 دقيقة",
    "Active",
    ],
  ];
  const attendanceRows = [
    ["ID", "Name", backendDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()))],
    ["1", "Attendee", "-"],
  ];
  const makeSheet = (rows) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(1, ...rows.map((row) => row.length)),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => rows
          .slice(row - 1, row - 1 + rowCount)
          .map((values) => values.slice(column - 1, column - 1 + columnCount)),
        setValue: (value) => { rows[row - 1][column - 1] = value; },
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
    deleteRow: (row) => rows.splice(row - 1, 1),
  });
  const sheets = new Map([
    ["Check-in & Check-out", makeSheet(checkinRows)],
    ["Attendance", makeSheet(attendanceRows)],
  ]);
  context.getSettings = () => ({
    startTime: timeAtOffset(-45),
    endTime: timeAtOffset(0),
    acceptedDelay: 0,
    allowedDays: [now.getDay()],
  });
  context.getAdminNameByEmail = () => "Test Admin";
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = makeSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });

  const checkedOut = context.checkoutAttendance_("1", "admin@example.com");
  const alreadyCheckedOut = context.checkoutAttendance_("1", "admin@example.com");

  assert.equal(checkedOut.kind, "out", checkedOut.message);
  assert.equal(checkinRows[1][5], "Test Admin");
  assert.equal(attendanceRows[1][2], "+");
  assert.equal(sheets.get("Attendance Audit").rows[1][5], "Check-out");
  assert.equal(alreadyCheckedOut.kind, "error");
});

test("logs an emergency check-out reason and rejects a missing reason", () => {
  const { context } = createBackendContext();
  const now = new Date();
  const backendDate = (date) =>
    vm.runInContext(`new Date(${date.getTime()})`, context);
  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  let schedule = {
    startTime: formatTime(new Date(now.getTime() + 2 * 60 * 60 * 1000)),
    endTime: formatTime(new Date(now.getTime() + 3 * 60 * 60 * 1000)),
    allowedDays: [now.getDay()],
  };
  context.getSettings = () => schedule;
  const checkinRows = [
    ["ID", "Name", "Check-in", "Admin Check-in", "Check-out", "Admin Check-out", "Delay", "Status"],
    ["1", "Attendee", backendDate(now), "Test Admin", "", "", "", "Active"],
  ];
  const makeSheet = (rows) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(1, ...rows.map((row) => row.length)),
    getRange(row, column, rowCount = 1, columnCount = 1) {
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
    appendRow: (row) => rows.push(row),
  });
  const sheets = new Map([
    ["Check-in & Check-out", makeSheet(checkinRows)],
  ]);
  context.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = makeSheet([]);
      sheets.set(name, sheet);
      return sheet;
    },
  });
  context.getAdminNameByEmail = () => "Test Admin";

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
  assert.equal(result.kind, "out", result.message);
  assert.equal(sheets.get("Emergency Check-out").rows[1][4], "Medical emergency");
  assert.equal(sheets.get("Attendance Audit").rows[1][5], "Emergency check-out");
  assert.equal(sheets.get("Attendance Audit").rows[1][6], "Medical emergency");
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
