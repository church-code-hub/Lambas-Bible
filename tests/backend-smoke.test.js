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
      getScriptProperties: () => ({ getProperties: () => ({ ...scriptProperties }) }),
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
