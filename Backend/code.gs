// =========================================================================
// ⚙️ System Settings & Sheet Names
// =========================================================================
const SETTINGS_SHEET_NAME = "Settings";
const DELAYS_SHEET_NAME = "Delays";
const INITIAL_SETTINGS_PASSWORD_PROPERTY = "INITIAL_SETTINGS_PASSWORD";

const DEFAULT_SETTINGS = {
  startTime: "10:00",
  endTime: "12:00",
  acceptedDelay: 15,
  allowedDays: [0, 1, 2, 3, 4, 5, 6],
};

let cachedSettings_ = null;
let cachedAdminsMap_ = null;
let cachedScriptProperties_ = null;

function getRequiredScriptProperty_(propertyKey) {
  if (cachedScriptProperties_ === null) {
    cachedScriptProperties_ =
      PropertiesService.getScriptProperties().getProperties();
  }
  const value = cachedScriptProperties_[propertyKey];
  if (!value || !String(value).trim()) {
    throw new Error("Missing required Script Property: " + propertyKey);
  }
  return String(value).trim();
}

// =========================================================================
// 🔐 Encryption Module (100 Characters)
// =========================================================================
function encryptId(id) {
  if (id === null || id === undefined || id === "") return "";
  const secretKey = getRequiredScriptProperty_("QR_SECRET_KEY");
  let str = String(id).trim();
  let scrambled = "";
  for (let i = 0; i < str.length; i++) {
    let charCode =
      str.charCodeAt(i) ^ secretKey.charCodeAt(i % secretKey.length);
    scrambled += String.fromCharCode(charCode);
  }
  let base64 = Utilities.base64Encode(scrambled);
  let cleanToken = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  let hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    str + secretKey,
  );
  let hashHex = hash
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");
  let combined = cleanToken + "-" + hashHex;
  while (combined.length < 100) {
    combined += hashHex;
  }
  return combined.substring(0, 100);
}

function decryptId(token) {
  if (token === null || token === undefined) return "";
  const secretKey = getRequiredScriptProperty_("QR_SECRET_KEY");
  let cleanToken = String(token).trim();
  if (cleanToken.includes("id=")) {
    let match = cleanToken.match(/id=([^&#]+)/);
    if (match && match[1]) cleanToken = decodeURIComponent(match[1]).trim();
  }
  if (/^\d+$/.test(cleanToken)) return cleanToken;
  if (cleanToken.includes("-")) cleanToken = cleanToken.split("-")[0];
  let base64 = cleanToken.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  try {
    let decodedBytes = Utilities.base64Decode(base64);
    let scrambled = "";
    for (let i = 0; i < decodedBytes.length; i++) {
      let byteVal = decodedBytes[i];
      if (byteVal < 0) byteVal += 256;
      scrambled += String.fromCharCode(byteVal);
    }
    let originalId = "";
    for (let i = 0; i < scrambled.length; i++) {
      let charCode =
        scrambled.charCodeAt(i) ^ secretKey.charCodeAt(i % secretKey.length);
      originalId += String.fromCharCode(charCode);
    }
    if (/^[0-9A-Za-z_-]+$/.test(originalId) && originalId.length > 0)
      return originalId;
    return cleanToken;
  } catch (e) {
    return cleanToken;
  }
}

// =========================================================================
// 🌐 API Router
// =========================================================================
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action;
  const identity = verifyGoogleIdToken_(params.idToken);
  if (!identity.success) return responseJSON_(identity);
  if (!isEmailAllowed(identity.email))
    return responseJSON_(authorizationDenied_());

  let result = {
    success: false,
    code: "UNKNOWN_ACTION",
    message: "إجراء غير معروف",
  };
  try {
    if (action === "get_settings")
      result = { success: true, settings: getPublicSettings_() };
    else if (action === "search")
      result = verifyOrSuggestName(params.name || "");
    else if (action === "get_admins")
      result = { success: true, admins: getAdminsData() };
  } catch (err) {
    result = {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
  return responseJSON_(result);
}

function doPost(e) {
  let result = {
    success: false,
    code: "INVALID_REQUEST",
    message: "طلب غير صالح",
  };
  try {
    let data = {};
    if (e && e.postData && e.postData.contents)
      data = JSON.parse(e.postData.contents);
    else if (e && e.parameter) data = e.parameter;

    const identity = verifyGoogleIdToken_(data.idToken);
    if (!identity.success) return responseJSON_(identity);

    const action = data.action;
    if (action === "check_auth") {
      const authorized = isEmailAllowed(identity.email);
      result = {
        success: true,
        authorized: authorized,
        email: identity.email,
        adminName: authorized ? getAdminNameByEmail(identity.email) : "",
      };
    } else if (!isEmailAllowed(identity.email)) {
      result = authorizationDenied_();
    } else if (action === "sync_offline_events") {
      result = syncOfflineEvents_(data.events, identity.email);
    } else if (action === "scan") {
      result = withScriptLock_(() => processScan(data.id, identity.email));
    } else if (action === "search")
      result = verifyOrSuggestName(data.name || "");
    else if (action === "get_settings")
      result = { success: true, settings: getPublicSettings_() };
    else if (action === "verify_settings_password") {
      const isValid = verifySettingsPassword(data.password);
      result = { success: true, valid: isValid };
    } else if (action === "save_settings")
      result = withScriptLock_(() =>
        saveSettings(
          data.password,
          data.startTime,
          data.endTime,
          data.acceptedDelay,
          data.newPassword,
          data.allowedDays,
        ),
      );
    else if (action === "add_student")
      result = saveStudentAndGenerateCard_(data.name, identity.email, {
        attendIfOpen: data.attendIfOpen !== false,
      });
    else if (action === "get_admins")
      result = { success: true, admins: getAdminsData() };
    else if (action === "add_admin")
      result = withScriptLock_(() =>
        addAdmin(data.email, data.name, data.password),
      );
    else if (action === "delete_admin")
      result = withScriptLock_(() => deleteAdmin(data.email, data.password));
    else if (action === "update_admin_profile")
      result = withScriptLock_(() =>
        updateAdminProfile(identity.email, data.name, data.password),
      );
    else if (action === "search_card_share")
      result = searchCardForShare(data.name);
    else if (action === "share_move_card")
      result = withScriptLock_(() => shareAndMoveCard(data.fileId));
  } catch (err) {
    result = {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }

  return responseJSON_(result);
}

function responseJSON_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getOfflineEventsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Offline Events");
  if (!sheet) {
    sheet = ss.insertSheet("Offline Events");
    sheet
      .getRange(1, 1, 1, 5)
      .setValues([
        [
          "Event ID",
          "Status",
          "Event Timestamp",
          "Result JSON",
          "Completed At",
        ],
      ]);
  }
  return sheet;
}

function syncOfflineEvents_(events, adminEmail) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 20) {
    return {
      success: false,
      code: "INVALID_OFFLINE_BATCH",
      message: "دفعة المزامنة غير صالحة.",
    };
  }

  const results = [];
  for (const event of events) {
    const eventId = String((event && event.eventId) || "");
    const timestamp = new Date((event && event.timestamp) || "");
    const now = Date.now();
    if (
      event &&
      event.queuedBy &&
      String(event.queuedBy).toLowerCase().trim() !==
        adminEmail.toLowerCase().trim()
    ) {
      results.push({
        eventId: eventId,
        status: "rejected",
        code: "OFFLINE_ACCOUNT_MISMATCH",
        message: "سجّل الدخول بالحساب الذي حفظ هذا الإجراء لمزامنته.",
      });
      continue;
    }
    if (
      !/^[A-Za-z0-9_-]{16,80}$/.test(eventId) ||
      isNaN(timestamp.getTime()) ||
      timestamp.getTime() > now + 5 * 60 * 1000 ||
      timestamp.getTime() < now - 7 * 24 * 60 * 60 * 1000
    ) {
      results.push({
        eventId: eventId,
        status: "rejected",
        code: "INVALID_OFFLINE_EVENT",
        message: "تعذر مزامنة حدث قديم أو غير صالح.",
      });
      continue;
    }

    const claim = withScriptLock_(() => {
      const sheet = getOfflineEventsSheet_();
      const lastRow = sheet.getLastRow();
      const rows =
        lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 5).getValues() : [];
      const existingIndex = rows.findIndex((row) => String(row[0]) === eventId);
      if (existingIndex !== -1) {
        const row = rows[existingIndex];
        return {
          status: row[1] === "COMPLETE" ? "complete" : "pending",
          rowNumber: existingIndex + 2,
          result: row[3] ? JSON.parse(row[3]) : null,
        };
      }
      sheet.appendRow([eventId, "PENDING", timestamp, "", ""]);
      return { status: "claimed", rowNumber: sheet.getLastRow() };
    });

    if (!claim || claim.success === false) {
      results.push({
        eventId: eventId,
        status: "pending",
        code: "SERVER_BUSY",
      });
      continue;
    }
    if (claim.status === "complete") {
      results.push({
        eventId: eventId,
        status: "complete",
        result: claim.result,
      });
      continue;
    }
    if (claim.status === "pending") {
      results.push({ eventId: eventId, status: "pending" });
      continue;
    }

    let eventResult;
    try {
      if (event.type === "scan" && event.qrText) {
        eventResult = withScriptLock_(() =>
          processScan(event.qrText, adminEmail, timestamp),
        );
      } else if (event.type === "add_student" && event.name) {
        eventResult = saveStudentAndGenerateCard_(event.name, adminEmail, {
          timestamp: timestamp,
          attendIfOpen: event.attendIfOpen === true,
        });
      } else {
        eventResult = {
          success: false,
          code: "INVALID_OFFLINE_EVENT",
          message: "نوع حدث المزامنة غير صالح.",
        };
      }
    } catch (error) {
      eventResult = {
        success: false,
        code: "OFFLINE_SYNC_FAILED",
        message: "تعذر مزامنة هذا الحدث.",
      };
    }

    const savedResult = withScriptLock_(() => {
      const sheet = getOfflineEventsSheet_();
      sheet
        .getRange(claim.rowNumber, 2, 1, 4)
        .setValues([
          ["COMPLETE", timestamp, JSON.stringify(eventResult), new Date()],
        ]);
      return true;
    });
    results.push({
      eventId: eventId,
      status: savedResult ? "complete" : "pending",
      result: eventResult,
    });
  }
  return { success: true, results: results };
}

function authorizationDenied_() {
  return {
    success: false,
    code: "AUTH_DENIED",
    message: "الحساب غير مصرح له باستخدام النظام.",
  };
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    lock.waitLock(5000);
    locked = true;
    return callback();
  } catch (error) {
    if (!locked) {
      return {
        success: false,
        code: "SERVER_BUSY",
        message: "الخادم مشغول حالياً، يرجى المحاولة بعد قليل.",
      };
    }
    throw error;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function verifyGoogleIdToken_(idToken) {
  if (!idToken || typeof idToken !== "string") {
    return {
      success: false,
      code: "AUTH_REQUIRED",
      message: "يرجى تسجيل الدخول مجدداً.",
    };
  }

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    idToken,
  );
  const cacheKey =
    "id_token_" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
  const cache = CacheService.getScriptCache();
  const cachedIdentity = cache.get(cacheKey);
  if (cachedIdentity) {
    const identity = JSON.parse(cachedIdentity);
    if (identity.expiresAt > Math.floor(Date.now() / 1000))
      return { success: true, email: identity.email };
  }

  try {
    const response = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
        encodeURIComponent(idToken),
      { muteHttpExceptions: true },
    );
    if (response.getResponseCode() !== 200) throw new Error("Invalid token");

    const tokenInfo = JSON.parse(response.getContentText());
    const expiresAt = Number(tokenInfo.exp);
    const email = String(tokenInfo.email || "")
      .toLowerCase()
      .trim();
    const verifiedEmail =
      tokenInfo.email_verified === true || tokenInfo.email_verified === "true";
    const validIssuer =
      tokenInfo.iss === "accounts.google.com" ||
      tokenInfo.iss === "https://accounts.google.com";
    if (
      tokenInfo.aud !== getRequiredScriptProperty_("GOOGLE_CLIENT_ID") ||
      !validIssuer ||
      !verifiedEmail ||
      !email ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new Error("Invalid token claims");
    }

    cache.put(
      cacheKey,
      JSON.stringify({ email: email, expiresAt: expiresAt }),
      Math.min(300, expiresAt - Math.floor(Date.now() / 1000)),
    );
    return { success: true, email: email };
  } catch (error) {
    return {
      success: false,
      code: "AUTH_INVALID",
      message: "تعذر التحقق من تسجيل الدخول. سجّل الدخول مجدداً.",
    };
  }
}

// =========================================================================
// 🔒 Admins & Permissions
// =========================================================================
function loadAdminsMap_() {
  if (cachedAdminsMap_) return cachedAdminsMap_;
  const map = new Map();
  try {
    const ownerEmail = SpreadsheetApp.getActiveSpreadsheet()
      .getOwner()
      .getEmail();
    if (ownerEmail) map.set(ownerEmail.toLowerCase().trim(), "المالك");

    const sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Admins");
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const email = data[i][0]
          ? data[i][0].toString().toLowerCase().trim()
          : "";
        const name = data[i][1] ? data[i][1].toString().trim() : "";
        if (email) map.set(email, name || email);
      }
    }
  } catch (e) {}
  cachedAdminsMap_ = map;
  return map;
}

function isEmailAllowed(email) {
  if (!email) return false;
  return loadAdminsMap_().has(email.toString().toLowerCase().trim());
}

function getAdminNameByEmail(email) {
  if (!email) return "خادم عام";
  const cleanEmail = email.toLowerCase().trim();
  return loadAdminsMap_().get(cleanEmail) || cleanEmail;
}

function getAdminsData() {
  const admins = [];
  try {
    const ownerEmail = SpreadsheetApp.getActiveSpreadsheet()
      .getOwner()
      .getEmail();
    if (ownerEmail)
      admins.push({
        email: ownerEmail.toLowerCase().trim(),
        name: getAdminNameByEmail(ownerEmail),
        isOwner: true,
      });

    const sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Admins");
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const email = data[i][0]
          ? data[i][0].toString().toLowerCase().trim()
          : "";
        const name = data[i][1] ? data[i][1].toString().trim() : "";
        if (email && email !== ownerEmail.toLowerCase().trim()) {
          admins.push({ email: email, name: name || email, isOwner: false });
        }
      }
    }
  } catch (e) {}
  return admins;
}

function addAdmin(email, name, password) {
  if (!verifySettingsPassword(password))
    return { success: false, message: "❌ كلمة المرور غير صحيحة" };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()))
    return { success: false, message: "⚠️ بريد إلكتروني غير صالح" };
  const cleanName = String(name || "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleanName.length > 100 || cleanName.startsWith("="))
    return {
      success: false,
      code: "INVALID_NAME",
      message: "يجب أن يكون الاسم صالحاً وألا يتجاوز 100 حرف.",
    };
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Admins");
    if (!sheet) {
      sheet = ss.insertSheet("Admins");
      sheet.getRange(1, 1, 1, 2).setValues([["Email", "Name"]]);
    }
    const data = sheet.getDataRange().getValues();
    const cleanEmail = email.toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      if (
        data[i][0] &&
        data[i][0].toString().toLowerCase().trim() === cleanEmail
      ) {
        return { success: false, message: "⚠️ هذا الخادم مسجل بالفعل" };
      }
    }
    sheet.appendRow([cleanEmail, cleanName || cleanEmail]);
    cachedAdminsMap_ = null;
    return {
      success: true,
      message: "✅ تم إضافة الخادم بنجاح",
      admins: getAdminsData(),
    };
  } catch (e) {
    return {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
}

function deleteAdmin(email, password) {
  if (!verifySettingsPassword(password))
    return { success: false, message: "❌ كلمة المرور غير صحيحة" };
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Admins");
    if (!sheet) return { success: false, message: "شيت Admins غير موجود" };
    const data = sheet.getDataRange().getValues();
    const cleanEmail = email.toLowerCase().trim();
    let deleted = false;
    for (let i = data.length - 1; i >= 1; i--) {
      if (
        data[i][0] &&
        data[i][0].toString().toLowerCase().trim() === cleanEmail
      ) {
        sheet.deleteRow(i + 1);
        deleted = true;
      }
    }
    if (deleted) {
      cachedAdminsMap_ = null;
      return {
        success: true,
        message: "✅ تم حذف الخادم بنجاح",
        admins: getAdminsData(),
      };
    }
    return { success: false, message: "❌ لم يتم العثور على الخادم" };
  } catch (e) {
    return {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
}

function updateAdminProfile(email, newName, password) {
  if (!verifySettingsPassword(password))
    return { success: false, message: "❌ كلمة المرور غير صحيحة" };
  const cleanName = String(newName || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanName || cleanName.length > 100 || cleanName.startsWith("="))
    return {
      success: false,
      code: "INVALID_NAME",
      message: "يرجى إدخال اسم لا يتجاوز 100 حرف.",
    };
  try {
    let ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Admins");
    if (!sheet) {
      sheet = ss.insertSheet("Admins");
      sheet.getRange(1, 1, 1, 2).setValues([["Email", "Name"]]);
    }
    const data = sheet.getDataRange().getValues();
    const cleanEmail = email.toLowerCase().trim();
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (
        data[i][0] &&
        data[i][0].toString().toLowerCase().trim() === cleanEmail
      ) {
        sheet.getRange(i + 1, 2).setValue(cleanName);
        found = true;
      }
    }
    if (!found) {
      sheet.appendRow([cleanEmail, cleanName]);
    }
    cachedAdminsMap_ = null;
    return {
      success: true,
      message: "✅ تم تحديث اسم الخادم بنجاح",
      name: cleanName,
    };
  } catch (e) {
    return {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
}

// =========================================================================
// ⚙️ Settings Functions
// =========================================================================
function getSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    const initialPassword = getRequiredScriptProperty_(
      INITIAL_SETTINGS_PASSWORD_PROPERTY,
    );
    if (initialPassword.length < 12) {
      throw new Error(
        "INITIAL_SETTINGS_PASSWORD must contain at least 12 characters",
      );
    }
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1, 6, 2).setValues([
      ["Key", "Value"],
      ["StartTime", DEFAULT_SETTINGS.startTime],
      ["EndTime", DEFAULT_SETTINGS.endTime],
      ["AcceptedDelay", DEFAULT_SETTINGS.acceptedDelay],
      ["Password", initialPassword],
      ["AllowedDays", DEFAULT_SETTINGS.allowedDays.join(",")],
    ]);
  }
  return sheet;
}

function getSettings() {
  if (cachedSettings_) return cachedSettings_;
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();
  const settings = Object.assign({}, DEFAULT_SETTINGS);

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0] ? data[i][0].toString().trim() : "";
    const value = data[i][1];
    if (key === "StartTime" && value)
      settings.startTime = value.toString().trim();
    if (key === "EndTime" && value) settings.endTime = value.toString().trim();
    if (key === "AcceptedDelay" && value !== "" && value !== null)
      settings.acceptedDelay = Number(value);
    if (key === "Password" && value !== "" && value !== null)
      settings.password = String(value).trim();
    if (
      key === "AllowedDays" &&
      value !== "" &&
      value !== null &&
      value !== undefined
    ) {
      const parsedDays = value
        .toString()
        .split(",")
        .map((d) => parseInt(d.trim(), 10))
        .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
      if (parsedDays.length > 0) settings.allowedDays = parsedDays;
    }
  }
  cachedSettings_ = settings;
  return settings;
}

function getPublicSettings_() {
  const { password, ...publicSettings } = getSettings();
  return publicSettings;
}

function verifySettingsPassword(password) {
  const settings = getSettings();
  return (
    String(password || "").trim() === String(settings.password || "").trim()
  );
}

function saveSettings(
  password,
  startTime,
  endTime,
  acceptedDelay,
  newPassword,
  allowedDays,
) {
  try {
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(startTime || "")) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(endTime || ""))
    ) {
      return {
        success: false,
        code: "INVALID_SCHEDULE",
        message: "يرجى إدخال مواعيد صحيحة.",
      };
    }
    const delay = Number(acceptedDelay);
    if (newPassword && String(newPassword).trim().length < 8) {
      return {
        success: false,
        code: "PASSWORD_TOO_SHORT",
        message: "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.",
      };
    }
    const days = Array.isArray(allowedDays)
      ? [
          ...new Set(
            allowedDays
              .map(Number)
              .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
          ),
        ]
      : [];
    if (
      !Number.isInteger(delay) ||
      delay < 0 ||
      delay > 240 ||
      days.length === 0
    ) {
      return {
        success: false,
        code: "INVALID_SCHEDULE",
        message: "تحقق من مدة السماح واختر يوماً واحداً على الأقل.",
      };
    }
    const current = getSettings();
    if (String(password).trim() !== String(current.password).trim()) {
      return { success: false, message: "❌ كلمة المرور الحالية غير صحيحة" };
    }
    const sheet = getSettingsSheet_();
    const data = sheet.getDataRange().getValues();
    let foundAllowedDaysRow = false;
    for (let i = 1; i < data.length; i++) {
      const key = data[i][0] ? data[i][0].toString().trim() : "";
      if (key === "StartTime") sheet.getRange(i + 1, 2).setValue(startTime);
      if (key === "EndTime") sheet.getRange(i + 1, 2).setValue(endTime);
      if (key === "AcceptedDelay") sheet.getRange(i + 1, 2).setValue(delay);
      if (
        key === "Password" &&
        newPassword &&
        String(newPassword).trim() !== ""
      ) {
        sheet.getRange(i + 1, 2).setValue(String(newPassword).trim());
      }
      if (key === "AllowedDays") {
        sheet.getRange(i + 1, 2).setValue(days.join(","));
        foundAllowedDaysRow = true;
      }
    }
    if (!foundAllowedDaysRow) sheet.appendRow(["AllowedDays", days.join(",")]);
    cachedSettings_ = null;
    return { success: true, message: "✅ تم حفظ الإعدادات بنجاح" };
  } catch (e) {
    return {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
}

// =========================================================================
// 📁 Card Sharing & Migration
// =========================================================================
function searchCardForShare(name) {
  if (!name) return { status: "error", message: "الاسم فارغ" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName("Roster");
  if (!rosterSheet) return { status: "no_match" };

  const lastRow = rosterSheet.getLastRow();
  const data =
    lastRow >= 2 ? rosterSheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  const cleanInput = normalizeName_(name);
  let matches = [];

  for (let i = 0; i < data.length && matches.length < 5; i++) {
    if (!data[i][0] || !data[i][1]) continue;
    let rowId = data[i][0].toString().trim();
    let rowName = data[i][1].toString().trim();
    let rowUrl = data[i][2] ? data[i][2].toString().trim() : "";

    if (normalizeName_(rowName).includes(cleanInput)) {
      let isNew = false;
      let fileId = "";
      if (rowUrl) {
        let matchId = rowUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          fileId = matchId[1];
          try {
            let file = DriveApp.getFileById(fileId);
            let parents = file.getParents();
            while (parents.hasNext()) {
              if (
                parents.next().getId() ===
                getRequiredScriptProperty_("NEW_CARDS_FOLDER_ID")
              ) {
                isNew = true;
                break;
              }
            }
          } catch (e) {}
        }
      }
      matches.push({
        id: rowId,
        name: rowName,
        driveUrl: rowUrl,
        fileId: fileId,
        isNew: isNew,
      });
    }
  }
  return matches.length > 0
    ? { status: "success", matches: matches }
    : { status: "no_match" };
}

function shareAndMoveCard(fileId) {
  if (!fileId) return { success: false };
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(String(fileId))) {
      return {
        success: false,
        code: "INVALID_CARD",
        message: "معرّف البطاقة غير صالح.",
      };
    }
    const rosterSheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Roster");
    if (!rosterSheet || rosterSheet.getLastRow() < 2) {
      return {
        success: false,
        code: "INVALID_CARD",
        message: "لم يتم العثور على البطاقة في سجل المخدومين.",
      };
    }
    const rosterCards = rosterSheet
      .getRange(2, 3, rosterSheet.getLastRow() - 1, 1)
      .getValues();
    const isRegisteredCard = rosterCards.some((row) => {
      const match = String(row[0] || "").match(/\/d\/([A-Za-z0-9_-]+)/);
      return match && match[1] === String(fileId);
    });
    if (!isRegisteredCard) {
      return {
        success: false,
        code: "INVALID_CARD",
        message: "لم يتم العثور على البطاقة في سجل المخدومين.",
      };
    }
    let file = DriveApp.getFileById(fileId);
    let mainFolder = DriveApp.getFolderById(
      getRequiredScriptProperty_("ACTIVE_CARDS_FOLDER_ID"),
    );
    let parents = file.getParents();
    let wasNew = false;
    while (parents.hasNext()) {
      let p = parents.next();
      if (p.getId() === getRequiredScriptProperty_("NEW_CARDS_FOLDER_ID")) {
        wasNew = true;
        p.removeFile(file);
      }
    }
    mainFolder.addFile(file);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر نقل البطاقة. تحقق من صلاحيات Drive وحاول مجدداً.",
    };
  }
}

// =========================================================================
// ⏱️ Attendance & Processing functions
// =========================================================================
function computeDelayMinutes_(checkinDate, settings) {
  const parts = settings.startTime.split(":");
  const deadline = new Date(checkinDate);
  deadline.setHours(
    parseInt(parts[0], 10) || 0,
    (parseInt(parts[1], 10) || 0) + (Number(settings.acceptedDelay) || 0),
    0,
    0,
  );
  const diffMs = checkinDate.getTime() - deadline.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 60000);
}

function formatDuration_(totalMinutes) {
  const minutes = Math.round(totalMinutes);
  if (minutes < 60) return minutes + " دقيقة";
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? hours + " ساعة" : hours + " ساعة و" + rem + " دقيقة";
}

function recordDelay_(id, name, delayMinutes) {
  if (!delayMinutes || delayMinutes <= 0) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DELAYS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DELAYS_SHEET_NAME);
    sheet
      .getRange(1, 1, 1, 5)
      .setValues([
        [
          "ID",
          "Name",
          "Total Delay (Minutes)",
          "Times Late",
          "Total Delay (Formatted)",
        ],
      ]);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === id.toString().trim()) {
      const curTot = Number(data[i][2]) || 0;
      const curCnt = Number(data[i][3]) || 0;
      const newTot = curTot + delayMinutes;
      sheet
        .getRange(i + 1, 3, 1, 3)
        .setValues([[newTot, curCnt + 1, formatDuration_(newTot)]]);
      return;
    }
  }
  sheet.appendRow([id, name, delayMinutes, 1, formatDuration_(delayMinutes)]);
}

function isAttendanceTimeAllowed() {
  return isAttendanceTimeAllowedAt_(new Date(), getSettings());
}

function isAttendanceTimeAllowedAt_(date, settings) {
  if (settings.allowedDays.indexOf(date.getDay()) === -1) return false;
  const currMin = date.getHours() * 60 + date.getMinutes();
  const startParts = settings.startTime.split(":");
  const endParts = settings.endTime.split(":");
  const startMin =
    parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
  const endMin = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);
  if (endMin < startMin) return currMin >= startMin || currMin <= endMin;
  return currMin >= startMin && currMin <= endMin;
}

function isCheckoutAllowed(checkoutDate, settings) {
  const parts = settings.endTime.split(":");
  const endTime = new Date(checkoutDate);
  endTime.setHours(
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    0,
    0,
  );
  const startWin = new Date(endTime);
  startWin.setMinutes(startWin.getMinutes() - 30);
  const endWin = new Date(endTime);
  endWin.setHours(endWin.getHours() + 1);
  return checkoutDate >= startWin && checkoutDate <= endWin;
}

function setAttendanceMark_(sheet, id, date, mark) {
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 3) return;

  const targetDate = date.toDateString();
  const dateHeaders = sheet.getRange(1, 3, 1, lastColumn - 2).getValues()[0];
  const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const columnIndex = dateHeaders.findIndex((header) => {
    const parsedDate = header instanceof Date ? header : new Date(header);
    return (
      !isNaN(parsedDate.getTime()) && parsedDate.toDateString() === targetDate
    );
  });
  const rowIndex = idValues.findIndex(
    (row) => String(row[0]).trim() === String(id).trim(),
  );
  if (rowIndex !== -1 && columnIndex !== -1) {
    sheet.getRange(rowIndex + 2, columnIndex + 3).setValue(mark);
  }
}

function processScan(scannedInput, adminEmail, capturedTimestamp) {
  try {
    const email = (adminEmail || "").toLowerCase().trim();
    if (!isEmailAllowed(email)) {
      return {
        kind: "error",
        icon: "🔒",
        title: "الحساب غير مصرح له!",
        name: "",
        message: "لا تملك صلاحية لتسجيل الحضور.",
      };
    }
    const realId = decryptId(scannedInput);
    if (!realId)
      return {
        kind: "error",
        icon: "❌",
        title: "كود غير صالح!",
        name: "",
        message: "يرجى مسح كارت صحيح.",
      };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rosterSheet = ss.getSheetByName("Roster");
    const checkinSheet = ss.getSheetByName("Check-in & Check-out");
    if (!rosterSheet || !checkinSheet) {
      return {
        kind: "error",
        icon: "❌",
        title: "خطأ في إعداد النظام",
        name: "",
        message: "تحقق من وجود شيت Roster وCheck-in & Check-out.",
      };
    }
    const rosterLastRow = rosterSheet.getLastRow();
    const rosterData =
      rosterLastRow >= 2
        ? rosterSheet.getRange(2, 1, rosterLastRow - 1, 2).getValues()
        : [];
    let personName = "";

    for (let i = 0; i < rosterData.length; i++) {
      if (
        rosterData[i][0] &&
        String(rosterData[i][0]).trim() === String(realId).trim()
      ) {
        personName = rosterData[i][1];
        break;
      }
    }
    if (!personName)
      return {
        kind: "error",
        icon: "❌",
        title: "كود غير مسجل!",
        name: "",
        message: "الرقم غير مسجل بالقاعدة.",
      };

    const adminLogText = getAdminNameByEmail(email);
    const timestamp = capturedTimestamp
      ? new Date(capturedTimestamp)
      : new Date();
    if (isNaN(timestamp.getTime())) {
      return {
        kind: "error",
        code: "INVALID_TIMESTAMP",
        icon: "❌",
        title: "وقت التسجيل غير صالح",
        name: personName,
        message: "تعذر التحقق من وقت المسح.",
      };
    }
    const todayStr = timestamp.toDateString();
    const settings = getSettings();
    const checkinLastRow = checkinSheet.getLastRow();
    const attendanceData =
      checkinLastRow >= 2
        ? checkinSheet.getRange(2, 1, checkinLastRow - 1, 7).getValues()
        : [];
    let rowIdx = -1,
      existingCheckIn = null;

    for (let j = 0; j < attendanceData.length; j++) {
      if (
        attendanceData[j][0] &&
        attendanceData[j][0].toString().trim() === realId &&
        attendanceData[j][2] instanceof Date &&
        attendanceData[j][2].toDateString() === todayStr
      ) {
        rowIdx = j + 2;
        existingCheckIn = attendanceData[j][2];
        break;
      }
    }

    if (rowIdx !== -1) {
      if (attendanceData[rowIdx - 2][3]) {
        return {
          kind: "warn",
          icon: "⚠️",
          title: "مسجّل حضور وانصراف!",
          name: personName,
          message: "تم رصد حضور وانصراف مسبقاً اليوم.",
        };
      }
      if (isCheckoutAllowed(timestamp, settings)) {
        checkinSheet.getRange(rowIdx, 4).setValue(timestamp);
        checkinSheet.getRange(rowIdx, 7).setValue(adminLogText);
        const delayMin = computeDelayMinutes_(existingCheckIn, settings);

        setAttendanceMark_(
          ss.getSheetByName("Attendance"),
          realId,
          timestamp,
          delayMin > 0 ? "+" : "++",
        );
        return {
          kind: "out",
          icon: "👋",
          title: "تم تسجيل الانصراف!",
          name: personName,
          message:
            "وقت الانصراف: " +
            Utilities.formatDate(
              timestamp,
              Session.getScriptTimeZone(),
              "hh:mm a",
            ),
        };
      } else {
        return {
          kind: "warn",
          icon: "⚠️",
          title: "مسجّل حضور بالفعل!",
          name: personName,
          message: "تم تسجيل الحضور اليوم.",
        };
      }
    }

    if (!isAttendanceTimeAllowedAt_(timestamp, settings)) {
      return {
        kind: "closed",
        icon: "🕒",
        title: "النظام مغلق الآن!",
        name: "",
        message: "يستقبل التسجيل في المواعيد الرسمية فقط.",
      };
    }

    const delayMin = computeDelayMinutes_(timestamp, settings);
    const delayText = delayMin > 0 ? formatDuration_(delayMin) : "";
    if (delayMin > 0) recordDelay_(realId, personName, delayMin);

    checkinSheet.appendRow([
      realId,
      personName,
      timestamp,
      "",
      delayText,
      adminLogText,
    ]);
    setAttendanceMark_(
      ss.getSheetByName("Attendance"),
      realId,
      timestamp,
      delayMin > 0 ? "+" : "-",
    );
    if (delayMin > 0) {
      return {
        kind: "late",
        icon: "⏱",
        title: "تم الحضور - متأخر",
        name: personName,
        message: "مقدار التأخير: " + delayText,
      };
    }
    return {
      kind: "success",
      icon: "✓",
      title: "تم تسجيل الحضور بنجاح!",
      name: personName,
      message: "🎯 في الموعد المحدد",
    };
  } catch (e) {
    const errorMessage = String(e && e.message ? e.message : e);
    if (errorMessage.includes("QR_SECRET_KEY")) {
      return {
        kind: "error",
        code: "QR_KEY_NOT_CONFIGURED",
        icon: "⚙️",
        title: "إعداد النظام غير مكتمل",
        name: "",
        message:
          "خاصية QR_SECRET_KEY غير مضبوطة في Script Properties في Apps Script.",
      };
    }
    return {
      kind: "error",
      code: "ATTENDANCE_FAILED",
      icon: "❌",
      title: "خطأ",
      name: "",
      message: "تعذر إتمام تسجيل الحضور. حاول مرة أخرى.",
    };
  }
}

function normalizeName_(name) {
  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function verifyOrSuggestName(inputName) {
  if (!inputName) return { status: "error", message: "الاسم فارغ" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName("Roster");
  if (!rosterSheet) return { status: "no_match" };
  const lastRow = rosterSheet.getLastRow();
  const data =
    lastRow >= 2 ? rosterSheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  const cleanInput = normalizeName_(inputName);
  let suggestions = [];

  for (let i = 0; i < data.length; i++) {
    if (!data[i][0] || !data[i][1]) continue;
    let rowId = data[i][0].toString().trim();
    let rowName = data[i][1].toString().trim();
    let cleanRow = normalizeName_(rowName);
    if (cleanRow === cleanInput)
      return { status: "exact_match", id: rowId, name: rowName };
    if (cleanRow.includes(cleanInput) && suggestions.length < 5)
      suggestions.push({ id: rowId, name: rowName });
  }
  return suggestions.length > 0
    ? { status: "suggestions", matches: suggestions }
    : { status: "no_match" };
}

function saveStudentAndGenerateCard_(name, adminEmail, options = {}) {
  const cleanName = String(name || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanName)
    return {
      success: false,
      code: "NAME_REQUIRED",
      message: "يرجى إدخال اسم المخدوم.",
    };
  if (cleanName.startsWith("="))
    return {
      success: false,
      code: "INVALID_NAME",
      message: "لا يمكن أن يبدأ الاسم بعلامة =.",
    };
  if (cleanName.length > 120)
    return {
      success: false,
      code: "NAME_TOO_LONG",
      message: "يجب ألا يتجاوز الاسم 120 حرفاً.",
    };

  const cleanEmail = String(adminEmail || "")
    .toLowerCase()
    .trim();
  const reservation = withScriptLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rosterSheet = ss.getSheetByName("Roster");
    if (!rosterSheet)
      return {
        success: false,
        code: "ROSTER_MISSING",
        message: "شيت Roster غير موجود.",
      };

    const lastRow = rosterSheet.getLastRow();
    const rosterData =
      lastRow >= 2
        ? rosterSheet.getRange(2, 1, lastRow - 1, 2).getValues()
        : [];
    const normalizedName = normalizeName_(cleanName);
    for (const row of rosterData) {
      if (row[1] && normalizeName_(row[1]) === normalizedName) {
        return {
          success: false,
          code: "DUPLICATE_NAME",
          name: String(row[1]),
          id: String(row[0]),
          message: "يوجد مخدوم مسجل بهذا الاسم بالفعل.",
        };
      }
    }

    const maxId = rosterData.reduce(
      (maximum, row) => Math.max(maximum, Number(row[0]) || 0),
      0,
    );
    const newId = maxId + 1;
    const adminName = getAdminNameByEmail(cleanEmail);
    const newSheet = ss.getSheetByName("New");
    const checkinSheet = ss.getSheetByName("Check-in & Check-out");
    const attendanceSheet = ss.getSheetByName("Attendance");
    const attendanceTimestamp = options.timestamp
      ? new Date(options.timestamp)
      : new Date();

    if (newSheet)
      newSheet.appendRow([
        attendanceTimestamp,
        cleanName,
        cleanEmail,
        adminName,
      ]);
    rosterSheet.appendRow([newId, cleanName]);
    if (attendanceSheet) attendanceSheet.appendRow([newId, cleanName]);

    const shouldAttend = options.attendIfOpen !== false;
    const settings = getSettings();
    if (
      checkinSheet &&
      shouldAttend &&
      isAttendanceTimeAllowedAt_(attendanceTimestamp, settings)
    ) {
      const checkinTime = attendanceTimestamp;
      const delayMin = computeDelayMinutes_(checkinTime, settings);
      checkinSheet.appendRow([
        newId,
        cleanName,
        checkinTime,
        "",
        delayMin > 0 ? formatDuration_(delayMin) : "",
        adminName,
      ]);
      setAttendanceMark_(
        attendanceSheet,
        newId,
        checkinTime,
        delayMin > 0 ? "+" : "-",
      );
      if (delayMin > 0) recordDelay_(newId, cleanName, delayMin);
    }
    return { success: true, id: newId, name: cleanName };
  });

  if (!reservation.success) return reservation;
  const cardRes = generateAllCardsFromRoster(reservation.id);
  const cardUrl =
    cardRes && cardRes.cards && cardRes.cards[0]
      ? cardRes.cards[0].driveUrl
      : "";
  return {
    ...reservation,
    driveUrl: cardUrl,
    cardGenerationFailed: !cardUrl,
    code: cardUrl ? "STUDENT_CREATED" : "STUDENT_CREATED_CARD_FAILED",
  };
}

function generateAllCardsFromRoster(targetStudentId) {
  try {
    const folderId = getRequiredScriptProperty_("NEW_CARDS_FOLDER_ID");
    const squareTemplateImageId = getRequiredScriptProperty_(
      "CARD_TEMPLATE_IMAGE_ID",
    );
    const blankSlidesTemplateId = getRequiredScriptProperty_(
      "CARD_SLIDES_TEMPLATE_ID",
    );

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rosterSheet = ss.getSheetByName("Roster");
    const rosterLastRow = rosterSheet.getLastRow();
    if (rosterLastRow < 2) return { success: true, cards: [] };
    const data = rosterSheet.getRange(2, 1, rosterLastRow - 1, 3).getValues();
    const folder = DriveApp.getFolderById(folderId);
    const templateImageBlob = DriveApp.getFileById(
      squareTemplateImageId,
    ).getBlob();

    let generatedCards = [];
    for (let i = 0; i < data.length; i++) {
      const studentId = data[i][0];
      const studentName = data[i][1];
      if (targetStudentId && String(targetStudentId) !== String(studentId))
        continue;
      if (data[i][2] && String(data[i][2]).includes("drive.google.com"))
        continue;

      const encryptedToken = encryptId(studentId);
      const qrApiUrl =
        "https://api.qrserver.com/v1/create-qr-code/?size=350x350&format=png&margin=16&ecc=M&data=" +
        encodeURIComponent(encryptedToken);
      const qrBlob = UrlFetchApp.fetch(qrApiUrl)
        .getBlob()
        .setName(studentName + ".png");

      const tempFile = DriveApp.getFileById(blankSlidesTemplateId).makeCopy(
        "Temp_" + studentId,
        folder,
      );
      const presentation = SlidesApp.openById(tempFile.getId());
      const slide = presentation.getSlides()[0];
      slide.getPageElements().forEach((el) => el.remove());
      slide.insertImage(templateImageBlob, 0, -20, 400, 600);
      slide.insertImage(qrBlob, 120, 300, 160, 160);
      const textBox = slide.insertTextBox(
        studentName.toString().trim(),
        65,
        469,
        240,
        30,
      );
      textBox
        .getText()
        .getParagraphStyle()
        .setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
      textBox
        .getText()
        .getTextStyle()
        .setFontSize(25)
        .setBold(true)
        .setForegroundColor("#3e1e04")
        .setFontFamily("Segoe UI");
      presentation.saveAndClose();

      const exportUrl =
        "https://docs.google.com/presentation/d/" +
        presentation.getId() +
        "/export/png?id=" +
        presentation.getId() +
        "&pageid=" +
        slide.getObjectId();
      const response = UrlFetchApp.fetch(exportUrl, {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      });

      if (response.getResponseCode() === 200) {
        const finalFile = folder.createFile(
          response.getBlob().setName(studentName + ".png"),
        );
        finalFile.setSharing(
          DriveApp.Access.ANYONE_WITH_LINK,
          DriveApp.Permission.VIEW,
        );
        const driveUrl = finalFile.getUrl();
        rosterSheet.getRange(i + 2, 3).setValue(driveUrl);
        generatedCards.push({
          id: studentId,
          name: studentName,
          driveUrl: driveUrl,
        });
      }
      tempFile.setTrashed(true);
    }
    return { success: true, cards: generatedCards };
  } catch (e) {
    return {
      success: false,
      code: "CARD_GENERATION_FAILED",
      message: "تعذر إنشاء بطاقة المخدوم.",
    };
  }
}
