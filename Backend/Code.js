// =========================================================================
// ⚙️ System Settings & Sheet Names
// =========================================================================
const SETTINGS_SHEET_NAME = "Settings";
const DELAYS_SHEET_NAME = "Delays";
const DELAY_DETAILS_SHEET_NAME = "Delay Details";

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
    else if (action === "get_roster") {
      const roster = getRosterSnapshot_();
      result = roster
        ? { success: true, roster: roster.map((person) => ({
            ...person,
            qrId: encryptId(person.id),
          })) }
        : {
            success: false,
            code: "ROSTER_MISSING",
            message: "شيت Roster غير موجود.",
          };
    }
    else if (action === "search")
      result = verifyOrSuggestName(params.name || "");
    else if (action === "get_admins")
      result = { success: true, admins: getAdminsData() };
  } catch (err) {
    console.error("GET API action failed: " + String(action || "unknown"), err);
    result = {
      success: false,
      code: "SERVER_ERROR",
      message: "تعذر إتمام الطلب. حاول مرة أخرى.",
    };
  }
  return responseJSON_(result);
}

function doPost(e) {
  let action = "unknown";
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

    action = data.action;
    if (action === "check_auth") {
      const authorized = isEmailAllowed(identity.email);
      result = {
        success: true,
        authorized: authorized,
        email: identity.email,
        adminName: authorized ? getAdminNameByEmail(identity.email) : "",
        isOwner: authorized && isSpreadsheetOwner_(identity.email),
      };
    } else if (!isEmailAllowed(identity.email)) {
      result = authorizationDenied_();
    } else if (action === "sync_offline_events") {
      result = syncOfflineEvents_(data.events, identity.email);
    } else if (action === "get_attendance_day") {
      result = getAttendanceDayReport_(data.date, data.name || "");
    } else if (action === "get_attendance_dates") {
      result = getAttendanceDates_();
    } else if (action === "get_attendance_trends") {
      result = getAttendanceTrends_(data.meetings);
    } else if (action === "get_attendance_window") {
      result = getAttendanceWindow_();
    } else if (action === "get_current_attendees") {
      result = getCurrentAttendees_();
    } else if (action === "checkout_attendance") {
      result = withScriptLock_(() =>
        checkoutAttendance_(data.id, identity.email),
      );
    } else if (action === "emergency_checkout_attendance") {
      result = withScriptLock_(() =>
        checkoutAttendance_(data.id, identity.email, data.reason, true),
      );
    } else if (action === "create_daily_attendance_report") {
      result = getAttendanceDayReport_(data.date, "", true, data.type || "both");
    } else if (action === "get_followups") {
      result = getFollowupCandidates_();
    } else if (action === "complete_followup") {
      result = withScriptLock_(() =>
        completeFollowup_(data.id, identity.email),
      );
    } else if (action === "cancel_checkin") {
      result = withScriptLock_(() => cancelCheckin_(data.id, identity.email));
    } else if (action === "scan") {
      result = withScriptLock_(() => processScan(data.id, identity.email));
    } else if (action === "get_roster") {
      const roster = getRosterSnapshot_();
      result = roster
        ? { success: true, roster: roster.map((person) => ({
            ...person,
            qrId: encryptId(person.id),
          })) }
        : {
            success: false,
            code: "ROSTER_MISSING",
            message: "شيت Roster غير موجود.",
          };
    } else if (action === "get_roster_management") {
      result = getRosterManagement_();
    } else if (action === "update_roster_person") {
      result = withScriptLock_(() =>
        updateRosterPerson_(data.id, data.name, data.active, identity.email),
      );
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
    else if (action === "generate_student_card")
      result = generateStudentCard_(data.id);
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
    console.error("POST API action failed: " + String(action || "unknown"), err);
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

const OFFLINE_EVENT_PROPERTY_PREFIX_ = "OFFLINE_EVENT_";

function pruneOfflineEventProperties_(properties, now) {
  const expirationTime = now - 7 * 24 * 60 * 60 * 1000;
  const propertyValues = properties.getProperties();
  Object.keys(propertyValues).forEach((key) => {
    if (!key.startsWith(OFFLINE_EVENT_PROPERTY_PREFIX_)) return;
    const record = JSON.parse(propertyValues[key]);
    const recordedAt = Date.parse(record.timestamp);
    if (!Number.isFinite(recordedAt)) {
      throw new Error("Invalid offline event record timestamp.");
    }
    if (recordedAt < expirationTime) properties.deleteProperty(key);
  });
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
  let didPruneEventProperties = false;
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

    const propertyKey = OFFLINE_EVENT_PROPERTY_PREFIX_ + eventId;
    const claim = withScriptLock_(() => {
      const properties = PropertiesService.getScriptProperties();
      if (!didPruneEventProperties) {
        pruneOfflineEventProperties_(properties, now);
        didPruneEventProperties = true;
      }
      const existingRecord = properties.getProperty(propertyKey);
      if (existingRecord) {
        const record = JSON.parse(existingRecord);
        if (record.status === "COMPLETE") {
          const failedResult = record.result &&
            (record.result.success === false || record.result.kind === "error");
          if (!failedResult) return { status: "complete", result: record.result || null };
        } else if (record.status === "PENDING") {
          return { status: "pending" };
        }
      }
      properties.setProperty(
        propertyKey,
        JSON.stringify({ status: "PENDING", timestamp: timestamp.toISOString() }),
      );
      return { status: "claimed" };
    });

    if (!claim || claim.success === false) {
      results.push({
        eventId: eventId,
        status: "pending",
        code: "SERVER_BUSY",
      });
      break;
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
      break;
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

    const failed = eventResult.success === false || eventResult.kind === "error";
    const savedResult = withScriptLock_(() => {
      PropertiesService.getScriptProperties().setProperty(
        propertyKey,
        JSON.stringify({
          status: failed ? "FAILED" : "COMPLETE",
          timestamp: timestamp.toISOString(),
          result: eventResult,
        }),
      );
      return true;
    });
    results.push({
      eventId: eventId,
      status: savedResult ? "complete" : "pending",
      result: eventResult,
    });
    if (failed) break;
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

function isSpreadsheetOwner_(email) {
  if (!email) return false;
  try {
    const ownerEmail = SpreadsheetApp.getActiveSpreadsheet()
      .getOwner()
      .getEmail();
    return String(ownerEmail || "").toLowerCase().trim() ===
      String(email).toLowerCase().trim();
  } catch (error) {
    return false;
  }
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
    else {
      settings.password = getRequiredScriptProperty_(
        "INITIAL_SETTINGS_PASSWORD_PROPERTY",
      );
    }
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
    if (newPassword && !/^\d+$/.test(String(newPassword).trim())) {
      return {
        success: false,
        code: "PASSWORD_DIGITS_ONLY",
        message: "يجب أن تتكون كلمة المرور الجديدة من أرقام فقط.",
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
function searchCardForShare(name, sharingState) {
  if (!name) return { status: "error", message: "الاسم فارغ" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName("Roster");
  if (!rosterSheet) return { status: "no_match" };

  const lastRow = rosterSheet.getLastRow();
  const data =
    lastRow >= 2 ? rosterSheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];
  const cleanInput = normalizeName_(name);
  let matches = [];

  for (let i = 0; i < data.length && matches.length < 5; i++) {
    if (!data[i][0] || !data[i][1] || String(data[i][3] || "").toLowerCase() === "inactive") continue;
    let rowId = data[i][0].toString().trim();
    let rowName = data[i][1].toString().trim();
    let rowUrl = data[i][2] ? data[i][2].toString().trim() : "";

    if (normalizeName_(rowName).includes(cleanInput)) {
      let isNew = false;
      let fileId = "";
      let updatedAt = 0;
      if (rowUrl) {
        let matchId = rowUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          fileId = matchId[1];
          try {
            let file = DriveApp.getFileById(fileId);
            updatedAt = file.getLastUpdated().getTime();
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
        updatedAt: updatedAt,
      });
    }
  }
  if (sharingState === "shared") {
    matches = matches.filter((match) => !match.isNew);
  } else if (sharingState === "unshared") {
    matches = matches.filter((match) => match.isNew);
  }
  matches.sort((left, right) => right.updatedAt - left.updatedAt);
  matches.forEach((match) => delete match.updatedAt);
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

function recordDelay_(id, name, delayMinutes, checkinDate, adminName) {
  if (!delayMinutes || delayMinutes <= 0) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let detailsSheet = ss.getSheetByName(DELAY_DETAILS_SHEET_NAME);
  if (!detailsSheet) {
    detailsSheet = ss.insertSheet(DELAY_DETAILS_SHEET_NAME);
    detailsSheet
      .getRange(1, 1, 1, 6)
      .setValues([["ID", "Name", "Attendance Date", "Check-in Time", "Delay Minutes", "Recorded By"]]);
  }
  const attendanceDate =
    checkinDate && typeof checkinDate.getTime === "function"
      ? checkinDate
      : new Date();
  detailsSheet.appendRow([
    id,
    name,
    new Date(attendanceDate.getFullYear(), attendanceDate.getMonth(), attendanceDate.getDate()),
    attendanceDate,
    delayMinutes,
    adminName || "",
  ]);

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

function attendanceTimeParts_(date) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const timeZone =
    spreadsheet && spreadsheet.getSpreadsheetTimeZone
      ? spreadsheet.getSpreadsheetTimeZone()
      : Session.getScriptTimeZone();
  const parts = Utilities.formatDate(date, timeZone, "yyyy-MM-dd|HH|mm|u").split("|");
  return {
    dateKey: parts[0],
    day: Number(parts[3]) % 7,
    minute: Number(parts[1]) * 60 + Number(parts[2]),
  };
}

function previousAttendanceDateKey_(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const previousDate = new Date(Date.UTC(year, month - 1, day - 1));
  return [
    previousDate.getUTCFullYear(),
    String(previousDate.getUTCMonth() + 1).padStart(2, "0"),
    String(previousDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function meetingOccurrenceAt_(date, settings) {
  const local = attendanceTimeParts_(date);
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  const candidates = [
    { dateKey: local.dateKey, day: local.day, minute: local.minute },
    {
      dateKey: previousAttendanceDateKey_(local.dateKey),
      day: (local.day + 6) % 7,
      minute: local.minute + 24 * 60,
    },
  ];
  return candidates.find((candidate) =>
    settings.allowedDays.indexOf(candidate.day) !== -1 &&
    candidate.minute >= start &&
    candidate.minute <= end + 60,
  ) || null;
}

function isAttendanceTimeAllowedAt_(date, settings) {
  const occurrence = meetingOccurrenceAt_(date, settings);
  if (!occurrence) return false;
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return occurrence.minute <= end;
}

function isCheckoutAllowed(checkoutDate, settings) {
  const occurrence = meetingOccurrenceAt_(checkoutDate, settings);
  if (!occurrence) return false;
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return occurrence.minute >= end - 30 && occurrence.minute <= end + 60;
}

function isCurrentAttendanceWindowOpen_(date, settings) {
  return Boolean(meetingOccurrenceAt_(date, settings));
}

function attendanceWindowCloseReason_(date, settings) {
  const local = attendanceTimeParts_(date);
  const [startHour, startMinute] = settings.startTime.split(":").map(Number);
  const [endHour, endMinute] = settings.endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (
    end <= start &&
    settings.allowedDays.indexOf((local.day + 6) % 7) !== -1 &&
    local.minute > end + 60
  ) return "after_meeting";
  if (settings.allowedDays.indexOf(local.day) === -1) return "no_meeting_today";
  return local.minute < start ? "before_meeting" : "after_meeting";
}

function attendanceSessionDateKey_(date, settings) {
  const occurrence = meetingOccurrenceAt_(date, settings);
  return occurrence ? occurrence.dateKey : attendanceTimeParts_(date).dateKey;
}

function getAttendanceWindow_() {
  const now = new Date();
  const settings = getSettings();
  const windowOpen = isCurrentAttendanceWindowOpen_(now, settings);
  return {
    success: true,
    windowOpen: windowOpen,
    closeReason: windowOpen ? "" : attendanceWindowCloseReason_(now, settings),
    nextCheckMs: 30 * 1000,
  };
}

function getCurrentAttendees_() {
  const now = new Date();
  const settings = getSettings();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const checkinSheet = spreadsheet.getSheetByName("Check-in & Check-out");
  const lastRow = checkinSheet ? checkinSheet.getLastRow() : 0;
  const rows = checkinSheet && lastRow >= 2
    ? checkinSheet.getRange(2, 1, lastRow - 1, 8).getValues()
    : [];
  const todayKey = attendanceSessionDateKey_(now, settings);
  const attendees = rows
    .filter((row) =>
      row[0] &&
      row[7] !== "Cancelled" &&
      row[2] instanceof Date &&
      attendanceDateKey_(row[2]) === todayKey &&
      !row[4],
    )
    .map((row) => ({
      id: String(row[0]).trim(),
      name: String(row[1] || ""),
      checkinTime: row[2],
      checkedInBy: String(row[3] || ""),
    }));
  return {
    success: true,
    date: todayKey,
    windowOpen: isCurrentAttendanceWindowOpen_(now, settings),
    closeReason: isCurrentAttendanceWindowOpen_(now, settings)
      ? ""
      : attendanceWindowCloseReason_(now, settings),
    checkoutOpen: isCheckoutAllowed(now, settings),
    attendees: attendees,
  };
}

/*
 * Keep this section's time comparisons anchored to the spreadsheet's timezone.
 */

function getAttendanceAuditSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName("Attendance Audit");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("Attendance Audit");
  }
  const headers = [[
    "ID",
    "Name",
    "Check-in Time",
    "Action At",
    "Action By",
    "Action",
    "Details",
  ]];
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, 7).setValues(headers);
  } else if (sheet.getLastColumn() < 7) {
    sheet.getRange(1, 1, 1, 7).setValues(headers);
  }
  return sheet;
}

function appendAttendanceAudit_(spreadsheet, record, action, details, adminEmail, actionAt) {
  getAttendanceAuditSheet_(spreadsheet).appendRow([
    String(record[0]),
    String(record[1] || ""),
    record[2] || "",
    actionAt,
    getAdminNameByEmail(adminEmail),
    action,
    details || "",
  ]);
}

function checkoutAttendance_(id, adminEmail, emergencyReason, emergency) {
  const cleanId = String(id || "").trim();
  const reason = String(emergencyReason || "").replace(/\s+/g, " ").trim();
  if (emergency && (reason.length < 5 || reason.length > 500)) {
    return {
      kind: "error",
      code: "INVALID_EMERGENCY_REASON",
      message: "يجب إدخال سبب من 5 إلى 500 حرف.",
    };
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName("Check-in & Check-out");
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (!cleanId || lastRow < 2) {
    return { kind: "error", code: "CHECKIN_NOT_FOUND", message: "لا يوجد حضور نشط لهذا الشخص." };
  }

  const now = new Date();
  const settings = getSettings();
  if (emergency) {
    if (!isCurrentAttendanceWindowOpen_(now, settings)) {
      return {
        kind: "error",
        code: "ATTENDANCE_WINDOW_CLOSED",
        message: "إدارة الحضور غير متاحة خارج وقت الاجتماع.",
      };
    }
  } else if (!isCheckoutAllowed(now, settings)) {
    return {
      kind: "error",
      code: "CHECKOUT_WINDOW_CLOSED",
      message: "وقت الانصراف الرسمي غير مفتوح حالياً.",
    };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const todayKey = attendanceSessionDateKey_(now, settings);
  const index = rows.findIndex((row) =>
    String(row[0] || "").trim() === cleanId &&
    row[7] !== "Cancelled" &&
    row[2] instanceof Date &&
    attendanceDateKey_(row[2]) === todayKey &&
    !row[4],
  );
  if (index === -1) {
    return { kind: "error", code: "CHECKIN_NOT_FOUND", message: "لا يوجد حضور نشط لهذا الشخص." };
  }

  const record = rows[index];
  const delayMinutes = Number(record[6]) > 0
    ? Number(record[6])
    : parseDelayMinutes_(record[6]);
  const delayText = delayMinutes > 0 ? formatDuration_(delayMinutes) : "";
  sheet.getRange(index + 2, 5, 1, 2).setValues([[
    now,
    getAdminNameByEmail(adminEmail),
  ]]);
  setAttendanceMark_(
    spreadsheet.getSheetByName("Attendance"),
    cleanId,
    now,
    delayMinutes > 0 ? "+ " + delayText : "++",
  );
  appendAttendanceAudit_(
    spreadsheet,
    record,
    emergency ? "Emergency check-out" : "Check-out",
    emergency ? reason : delayText,
    adminEmail,
    now,
  );

  if (emergency) {
    let emergencySheet = spreadsheet.getSheetByName("Emergency Check-out");
    if (!emergencySheet) {
      emergencySheet = spreadsheet.insertSheet("Emergency Check-out");
      emergencySheet.getRange(1, 1, 1, 6).setValues([[
        "ID",
        "Name",
        "Check-in Time",
        "Check-out Time",
        "Reason",
        "Recorded By",
      ]]);
    }
    emergencySheet.appendRow([
      cleanId,
      record[1],
      record[2],
      now,
      reason,
      getAdminNameByEmail(adminEmail),
    ]);
  }
  return {
    kind: "out",
    id: cleanId,
    name: String(record[1] || ""),
    message: "تم تسجيل الانصراف.",
  };
}

function parseDelayMinutes_(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const hours = Number((text.match(/(\d+)\s*ساعة/) || [])[1]) || 0;
  const minutes = Number((text.match(/(\d+)\s*دقيقة/) || [])[1]) || 0;
  if (hours || minutes) return hours * 60 + minutes;
  const number = Number(text.match(/\d+/)?.[0]) || 0;
  return number;
}

function setAttendanceMark_(sheet, id, date, mark) {
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 3) return;

  const dateHeaders = sheet.getRange(1, 3, 1, lastColumn - 2).getValues()[0];
  const columnIndex = dateHeaders.findIndex((header) => {
    return attendanceDateKey_(header) === attendanceDateKey_(date);
  });
  const targetRow = findExactRowIndexByValue_(sheet, 1, id, 2);
  if (targetRow !== -1 && columnIndex !== -1) {
    const attendanceMark = mark === "++"
      ? "++"
      : String(mark || "").startsWith("+")
        ? "+"
        : String(mark || "");
    const markRange = sheet.getRange(targetRow, columnIndex + 3);
    markRange.setValue(attendanceMark);
    if (typeof markRange.setBackground === "function") {
      markRange.setBackground(attendanceMarkColor_(attendanceMark));
    }
  }
}

function attendanceMarkColor_(mark) {
  if (mark === "++") return "#93c47d";
  if (String(mark || "").startsWith("+")) return "#f6b26b";
  if (mark === "-") return "#ffe599";
  return "#ffffff";
}

function parseAttendanceDate_(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
  );
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

function attendanceDateKey_(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  return attendanceTimeParts_(date).dateKey;
}

function getAttendanceDates_() {
  const attendanceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Attendance");
  if (!attendanceSheet || attendanceSheet.getLastColumn() < 3 || attendanceSheet.getLastRow() < 1) {
    return {
      success: false,
      code: "ATTENDANCE_SHEETS_MISSING",
      message: "تعذر العثور على أعمدة تواريخ الحضور.",
    };
  }
  const headers = attendanceSheet
    .getRange(1, 3, 1, attendanceSheet.getLastColumn() - 2)
    .getValues()[0];
  const dates = Array.from(new Set(
    headers.map((header) => attendanceDateKey_(header)).filter(Boolean),
  )).sort();
  return { success: true, dates: dates };
}

function getAttendanceDayReport_(dateValue, nameQuery, createSheet, requestedSheetType) {
  const targetDate = parseAttendanceDate_(dateValue);
  if (!targetDate) {
    return {
      success: false,
      code: "INVALID_ATTENDANCE_DATE",
      message: "اختر تاريخ حضور صالحاً.",
    };
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const attendanceSheet = spreadsheet.getSheetByName("Attendance");
  const rosterSheet = spreadsheet.getSheetByName("Roster");
  if (!attendanceSheet || !rosterSheet || attendanceSheet.getLastColumn() < 3) {
    return {
      success: false,
      code: "ATTENDANCE_SHEETS_MISSING",
      message: "تعذر العثور على شيت الحضور أو قائمة المخدومين.",
    };
  }

  const attendanceLastRow = attendanceSheet.getLastRow();
  const attendanceLastColumn = attendanceSheet.getLastColumn();
  const targetKey = String(dateValue);
  const dateHeaders = attendanceSheet.getRange(
    1,
    3,
    1,
    attendanceLastColumn - 2,
  ).getValues()[0];
  const dateColumnOffset = dateHeaders.findIndex(
    (header) => attendanceDateKey_(header) === targetKey,
  );
  if (dateColumnOffset === -1) {
    return {
      success: false,
      code: "ATTENDANCE_DATE_NOT_FOUND",
      message: "لا يوجد عمود لهذا التاريخ في شيت الحضور.",
    };
  }

  const rosterLastRow = rosterSheet.getLastRow();
  const rosterRows = rosterLastRow >= 2
    ? rosterSheet.getRange(2, 1, rosterLastRow - 1, 4).getValues()
    : [];
  const attendanceRows = attendanceLastRow >= 2
    ? attendanceSheet.getRange(2, 1, attendanceLastRow - 1, 1).getValues()
    : [];
  const attendanceMarks = attendanceLastRow >= 2
    ? attendanceSheet.getRange(
        2,
        dateColumnOffset + 3,
        attendanceLastRow - 1,
        1,
      ).getValues()
    : [];
  const marksById = new Map();
  attendanceRows.forEach((row, index) => {
    if (row[0] !== "" && row[0] !== null && row[0] !== undefined) {
      marksById.set(String(row[0]).trim(), String(attendanceMarks[index][0] || "").trim());
    }
  });

  const checkinSheet = spreadsheet.getSheetByName("Check-in & Check-out");
  const checkinLastRow = checkinSheet ? checkinSheet.getLastRow() : 0;
  const checkinRows = checkinSheet && checkinLastRow >= 2
    ? checkinSheet.getRange(2, 1, checkinLastRow - 1, 8).getValues()
    : [];
  const checkinsById = new Map();
  checkinRows.forEach((row) => {
    if (
      !row[0] ||
      row[7] === "Cancelled" ||
      !row[2] ||
      typeof row[2].getTime !== "function" ||
      attendanceDateKey_(row[2]) !== targetKey
    ) return;
    checkinsById.set(String(row[0]).trim(), row);
  });
  const people = rosterRows
    .filter((row) => row[0] !== "" && row[0] !== null && row[1])
    .map((row) => {
      const id = String(row[0]).trim();
      const mark = marksById.get(id) || "";
      const checkin = checkinsById.get(id) || [];
      const attendanceState = resolveAttendanceState_(mark, checkin);
      return {
        id: id,
        name: String(row[1]),
        mark: attendanceState.mark,
        attended: attendanceState.state !== "absent",
        state: attendanceState.state,
        delayMinutes: attendanceState.delayMinutes,
        delay: attendanceState.delayMinutes > 0 ? formatDuration_(attendanceState.delayMinutes) : "",
      };
    });
  const attendees = people.filter((person) => person.attended);
  const query = normalizeName_(nameQuery);
  const matches = query
    ? people.filter((person) => normalizeName_(person.name).includes(query))
    : [];
  const response = {
    success: true,
    date: targetKey,
    count: attendees.length,
    people: people,
    matches: matches.map((person) => ({
      id: person.id,
      name: person.name,
      attended: person.attended,
      state: person.state,
      mark: person.mark,
      delayMinutes: person.delayMinutes,
      delay: person.delay,
    })),
  };

  if (createSheet) {
    const sheetType = ["attendees", "absents", "both"].includes(requestedSheetType)
      ? requestedSheetType
      : ["attendees", "absents", "both"].includes(createSheet)
        ? createSheet
      : "both";
    const sheetSuffix = sheetType === "both"
      ? ""
      : sheetType === "attendees"
        ? " - Attendees"
        : " - Absentees";
    const sheetName = "Attendance " + targetKey + sheetSuffix;
    let reportSheet = spreadsheet.getSheetByName(sheetName);
    const alreadyExists = Boolean(reportSheet);
    const exportedPeople = people.filter((person) =>
      sheetType === "both" ||
      (sheetType === "attendees" && person.attended) ||
      (sheetType === "absents" && !person.attended),
    );
    response.exportedCount = exportedPeople.length;
    if (!reportSheet) {
      reportSheet = spreadsheet.insertSheet(sheetName);
      const reportRows = [["Name", "Attendance Mark", "Delay"]];
      exportedPeople.forEach((person) => reportRows.push([
        person.name,
        person.attended ? person.state === "delayed" ? "+" : "++" : "",
        person.state === "delayed" ? person.delay : "",
      ]));
      reportSheet.getRange(1, 1, reportRows.length, 3).setValues(reportRows);
      const reportRange = reportSheet.getRange(1, 1, reportRows.length, 3);
      reportRange
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
      reportSheet
        .getRange(1, 1, 1, 3)
        .setBackground("#f5bd55")
        .setFontColor("#182333")
        .setFontWeight("bold");
      if (exportedPeople.length) {
        reportSheet
          .getRange(2, 2, exportedPeople.length, 1)
          .setBackgrounds(exportedPeople.map((person) => [
            attendanceMarkColor_(
              person.attended ? person.state === "delayed" ? "+" : "++" : "",
            ),
          ]));
      }
    }
    response.report = {
      name: sheetName,
      sheetId: reportSheet.getSheetId(),
      alreadyExists: alreadyExists,
      type: sheetType,
    };
  }
  return response;
}

function resolveAttendanceState_(mark, checkin) {
  const delayMinutes = parseDelayMinutes_(checkin[6]);
  const markDelayMinutes = parseDelayMinutes_(mark.replace(/^\+\s*/, ""));
  const effectiveDelayMinutes = delayMinutes || markDelayMinutes;
  const hasCheckin = Boolean(checkin[2] && typeof checkin[2].getTime === "function");
  const state = hasCheckin || mark === "++"
    ? effectiveDelayMinutes > 0 || /^\+\s*(?!\+)/.test(mark)
      ? "delayed"
      : "on_time"
    : mark.startsWith("+")
      ? "delayed"
      : "absent";
  return { state: state, delayMinutes: effectiveDelayMinutes, mark: mark };
}

function getAttendanceTrends_(requestedMeetings) {
  const meetings = Number.isInteger(Number(requestedMeetings))
    ? Math.min(24, Math.max(1, Number(requestedMeetings)))
    : 8;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const attendanceSheet = spreadsheet.getSheetByName("Attendance");
  const rosterSheet = spreadsheet.getSheetByName("Roster");
  if (!attendanceSheet || !rosterSheet || attendanceSheet.getLastColumn() < 3) {
    return {
      success: false,
      code: "ATTENDANCE_SHEETS_MISSING",
      message: "تعذر العثور على شيت الحضور أو قائمة المخدومين.",
    };
  }
  const lastColumn = attendanceSheet.getLastColumn();
  const headers = attendanceSheet.getRange(1, 3, 1, lastColumn - 2).getValues()[0];
  const todayKey = attendanceSessionDateKey_(new Date(), getSettings());
  const dates = Array.from(new Set(
    headers.map((header) => attendanceDateKey_(header))
      .filter((date) => date && date <= todayKey),
  )).sort().slice(-meetings);
  const attendanceLastRow = attendanceSheet.getLastRow();
  const attendanceRows = attendanceLastRow >= 2
    ? attendanceSheet.getRange(2, 1, attendanceLastRow - 1, lastColumn).getValues()
    : [];
  const rosterLastRow = rosterSheet.getLastRow();
  const rosterRows = rosterLastRow >= 2
    ? rosterSheet.getRange(2, 1, rosterLastRow - 1, 4).getValues()
    : [];
  const rosterIds = new Set(rosterRows.filter((row) => row[0] && row[1]).map((row) => String(row[0]).trim()));
  const rowsById = new Map(attendanceRows.map((row) => [String(row[0] || "").trim(), row]));
  const checkinSheet = spreadsheet.getSheetByName("Check-in & Check-out");
  const checkinLastRow = checkinSheet ? checkinSheet.getLastRow() : 0;
  const checkinRows = checkinSheet && checkinLastRow >= 2
    ? checkinSheet.getRange(2, 1, checkinLastRow - 1, 8).getValues()
    : [];
  const checkinsByDateAndId = new Map();
  checkinRows.forEach((row) => {
    if (
      !row[0] ||
      row[7] === "Cancelled" ||
      !row[2] ||
      typeof row[2].getTime !== "function"
    ) return;
    const key = attendanceDateKey_(row[2]) + "|" + String(row[0]).trim();
    checkinsByDateAndId.set(key, row);
  });

  const trends = dates.map((date) => {
    const dateOffset = headers.findIndex((header) => attendanceDateKey_(header) === date);
    let attended = 0;
    let delayed = 0;
    rosterIds.forEach((id) => {
      const attendanceRow = rowsById.get(id) || [];
      const mark = String(attendanceRow[dateOffset + 2] || "").trim();
      const checkin = checkinsByDateAndId.get(date + "|" + id) || [];
      const state = resolveAttendanceState_(mark, checkin);
      if (state.state !== "absent") attended++;
      if (state.state === "delayed") delayed++;
    });
    return {
      date: date,
      attended: attended,
      absent: rosterIds.size - attended,
      delayed: delayed,
      total: rosterIds.size,
      attendanceRate: rosterIds.size ? Math.round(attended * 100 / rosterIds.size) : 0,
    };
  });
  return { success: true, trends: trends };
}

function getFollowupCandidates_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const attendanceSheet = spreadsheet.getSheetByName("Attendance");
  const rosterSheet = spreadsheet.getSheetByName("Roster");
  if (!attendanceSheet || !rosterSheet) {
    return {
      success: false,
      code: "ATTENDANCE_SHEETS_MISSING",
      message: "تعذر العثور على شيت الحضور أو قائمة المخدومين.",
    };
  }

  const attendanceLastRow = attendanceSheet.getLastRow();
  const attendanceLastColumn = attendanceSheet.getLastColumn();
  if (attendanceLastRow < 2 || attendanceLastColumn < 3) {
    return { success: true, followups: [] };
  }
  const attendanceRows = attendanceSheet
    .getRange(1, 1, attendanceLastRow, attendanceLastColumn)
    .getValues();
  const currentTimestamp = new Date();
  const todayKey = attendanceSessionDateKey_(currentTimestamp, getSettings());
  const meetingColumns = attendanceRows[0]
    .map((header, index) => ({ date: attendanceDateKey_(header), index: index }))
    .filter((column) => column.index >= 2 && column.date && column.date <= todayKey)
    .sort((left, right) => right.date.localeCompare(left.date));
  if (meetingColumns.length < 2) return { success: true, followups: [] };

  const rosterLastRow = rosterSheet.getLastRow();
  const rosterRows = rosterLastRow >= 2
    ? rosterSheet.getRange(2, 1, rosterLastRow - 1, 2).getValues()
    : [];
  const attendanceById = new Map();
  attendanceRows.slice(1).forEach((row) => {
    const id = String(row[0] || "").trim();
    if (id) attendanceById.set(id, row);
  });
  const candidates = [];
  const isPresentForDate = (id, column, attendanceRow) => {
    return Boolean(String(attendanceRow[column.index] || "").trim());
  };
  rosterRows.forEach((row) => {
    if (!row[0] || !row[1] || String(row[3] || "").toLowerCase() === "inactive") return;
    const id = String(row[0]).trim();
    const attendanceRow = attendanceById.get(id);
    if (!attendanceRow) return;
    let missedMeetings = 0;
    let lastAttended = "";
    for (const column of meetingColumns) {
      if (isPresentForDate(id, column, attendanceRow)) break;
      missedMeetings++;
    }
    if (missedMeetings < 2) return;
    for (const column of meetingColumns.slice(missedMeetings)) {
      if (isPresentForDate(id, column, attendanceRow)) {
        lastAttended = column.date;
        break;
      }
    }
    if (!lastAttended) return;
    candidates.push({
      id: id,
      name: String(row[1]),
      missedMeetings: missedMeetings,
      lastAttended: lastAttended,
      lastMissed: meetingColumns[0].date,
    });
  });

  const sheetName = "Follow-up";
  let followupSheet = spreadsheet.getSheetByName(sheetName);
  if (!followupSheet) {
    followupSheet = spreadsheet.insertSheet(sheetName);
    followupSheet.getRange(1, 1, 1, 7).setValues([[
      "ID",
      "Name",
      "Missed Meetings",
      "Last Attended",
      "Status",
      "Updated At",
      "Completed By",
    ]]);
  }
  const lastRow = followupSheet.getLastRow();
  const savedRows = lastRow >= 2
    ? followupSheet.getRange(2, 1, lastRow - 1, 7).getValues()
    : [];
  const savedIndexById = new Map();
  savedRows.forEach((row, index) => {
    const id = String(row[0] || "").trim();
    if (id && !savedIndexById.has(id)) savedIndexById.set(id, index);
  });
  const now = new Date();
  const pendingUpdates = [];
  const addedRows = [];
  candidates.forEach((candidate) => {
    const rowIndex = savedIndexById.get(candidate.id);
    if (rowIndex === undefined) {
      addedRows.push([
        candidate.id,
        candidate.name,
        candidate.missedMeetings,
        candidate.lastAttended,
        "مفتوح",
        now,
        "",
      ]);
      candidate.status = "مفتوح";
      return;
    }
    const saved = savedRows[rowIndex];
    const status = saved[4] === "مكتمل" && saved[3] === candidate.lastAttended
      ? "مكتمل"
      : "مفتوح";
    pendingUpdates.push({
      rowIndex: rowIndex,
      values: [
        candidate.name,
        candidate.missedMeetings,
        candidate.lastAttended,
        status,
        now,
        status === "مكتمل" ? saved[6] : "",
      ],
    });
    candidate.status = status;
  });
  pendingUpdates.sort((left, right) => left.rowIndex - right.rowIndex);
  for (let index = 0; index < pendingUpdates.length;) {
    const start = index;
    const firstRowIndex = pendingUpdates[index].rowIndex;
    index++;
    while (
      index < pendingUpdates.length &&
      pendingUpdates[index].rowIndex === pendingUpdates[index - 1].rowIndex + 1
    ) index++;
    followupSheet
      .getRange(firstRowIndex + 2, 2, index - start, 6)
      .setValues(pendingUpdates.slice(start, index).map((update) => update.values));
  }
  if (addedRows.length) {
    followupSheet.getRange(lastRow + 1, 1, addedRows.length, 7).setValues(addedRows);
  }

  return {
    success: true,
    followups: candidates.filter((candidate) => candidate.status !== "مكتمل"),
  };
}

function completeFollowup_(id, adminEmail) {
  const cleanId = String(id || "").trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Follow-up");
  if (!cleanId || !sheet || sheet.getLastRow() < 2) {
    return { success: false, code: "FOLLOWUP_NOT_FOUND" };
  }
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const index = rows.findIndex((row) => String(row[0]).trim() === cleanId);
  if (index === -1) return { success: false, code: "FOLLOWUP_NOT_FOUND" };
  sheet.getRange(index + 2, 5, 1, 3).setValues([[
    "مكتمل",
    new Date(),
    getAdminNameByEmail(adminEmail),
  ]]);
  return { success: true };
}

function removeDelayForAttendance_(id, attendanceDate) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const detailSheet = spreadsheet.getSheetByName(DELAY_DETAILS_SHEET_NAME);
  if (!detailSheet || detailSheet.getLastRow() < 2) return;
  const rows = detailSheet
    .getRange(2, 1, detailSheet.getLastRow() - 1, 6)
    .getValues();
  const targetKey = attendanceDateKey_(attendanceDate);
  const index = rows.findIndex(
    (row) =>
      String(row[0]).trim() === String(id).trim() &&
      attendanceDateKey_(row[2]) === targetKey,
  );
  if (index === -1) return;

  const removedMinutes = Number(rows[index][4]) || 0;
  detailSheet.deleteRow(index + 2);
  const summarySheet = spreadsheet.getSheetByName(DELAYS_SHEET_NAME);
  if (!summarySheet || summarySheet.getLastRow() < 2) return;
  const summaryRows = summarySheet
    .getRange(2, 1, summarySheet.getLastRow() - 1, 5)
    .getValues();
  const summaryIndex = summaryRows.findIndex(
    (row) => String(row[0]).trim() === String(id).trim(),
  );
  if (summaryIndex === -1) return;
  const total = Math.max(0, (Number(summaryRows[summaryIndex][2]) || 0) - removedMinutes);
  const count = Math.max(0, (Number(summaryRows[summaryIndex][3]) || 0) - 1);
  if (count === 0) summarySheet.deleteRow(summaryIndex + 2);
  else {
    summarySheet.getRange(summaryIndex + 2, 3, 1, 3).setValues([[
      total,
      count,
      formatDuration_(total),
    ]]);
  }
}

function cancelCheckin_(id, adminEmail) {
  const cleanId = String(id || "").trim();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName("Check-in & Check-out");
  if (!cleanId || !sheet || sheet.getLastRow() < 2) {
    return { success: false, code: "CHECKIN_NOT_FOUND" };
  }
  const now = new Date();
  const todayKey = attendanceSessionDateKey_(now, getSettings());
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  const index = rows.findIndex(
    (row) =>
      String(row[0] || "").trim() === cleanId &&
      row[7] !== "Cancelled" &&
      row[2] &&
      typeof row[2].getTime === "function" &&
      attendanceDateKey_(row[2]) === todayKey,
  );
  if (index === -1) return { success: false, code: "CHECKIN_NOT_FOUND" };
  const record = rows[index];
  if (record[4]) return { success: false, code: "CHECKOUT_ALREADY_RECORDED" };

  appendAttendanceAudit_(
    spreadsheet,
    record,
    "Check-in cancelled",
    "",
    adminEmail,
    new Date(),
  );
  sheet.deleteRow(index + 2);
  setAttendanceMark_(spreadsheet.getSheetByName("Attendance"), cleanId, record[2], "");
  removeDelayForAttendance_(cleanId, record[2]);
  return { success: true };
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
    const rosterRow = findExactRowByValue_(rosterSheet, 1, realId, 2, 2);
    const personName = rosterRow ? rosterRow[1] : "";
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
    const todayStr = attendanceSessionDateKey_(timestamp, getSettings());
    const settings = getSettings();
    const checkinLastRow = checkinSheet.getLastRow();
    const attendanceData =
      checkinLastRow >= 2
        ? checkinSheet.getRange(2, 1, checkinLastRow - 1, 8).getValues()
        : [];
    let rowIdx = -1,
      existingCheckIn = null;

    for (let j = 0; j < attendanceData.length; j++) {
      if (attendanceData[j][7] === "Cancelled") continue;
      if (
        attendanceData[j][0] &&
        attendanceData[j][0].toString().trim() === realId &&
        attendanceData[j][2] instanceof Date &&
        attendanceSessionDateKey_(attendanceData[j][2], getSettings()) === todayStr
      ) {
        rowIdx = j + 2;
        existingCheckIn = attendanceData[j][2];
        break;
      }
    }

    if (rowIdx !== -1) {
      if (attendanceData[rowIdx - 2][5]) {
        return {
          kind: "warn",
          icon: "⚠️",
          title: "مسجّل حضور وانصراف!",
          name: personName,
          message: "تم رصد حضور وانصراف مسبقاً اليوم.",
        };
      }
      if (isCheckoutAllowed(timestamp, settings)) {
        checkinSheet.getRange(rowIdx, 5).setValue(timestamp);
        checkinSheet.getRange(rowIdx, 6).setValue(adminLogText);
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
    if (delayMin > 0)
      recordDelay_(realId, personName, delayMin, timestamp, adminLogText);

    checkinSheet.appendRow([
      realId,
      personName,
      timestamp,
      adminLogText,
      "",
      "",
      delayText,
      "Active",
    ]);
    setAttendanceMark_(
      ss.getSheetByName("Attendance"),
      realId,
      timestamp,
      delayMin > 0 ? "+" : "++",
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
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRosterSnapshot_() {
  const rosterSheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Roster");
  if (!rosterSheet) return null;
  const lastRow = rosterSheet.getLastRow();
  const data =
    lastRow >= 2 ? rosterSheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];
  return data
    .filter((row) =>
      row[0] !== "" &&
      row[0] !== null &&
      row[1] &&
      String(row[3] || "").toLowerCase() !== "inactive",
    )
    .map((row) => ({
      id: String(row[0]).trim(),
      name: String(row[1]).trim(),
    }));
}

function getRosterManagement_() {
  const rosterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Roster");
  if (!rosterSheet) {
    return {
      success: false,
      code: "ROSTER_MISSING",
      message: "شيت Roster غير موجود.",
    };
  }
  const lastRow = rosterSheet.getLastRow();
  const rows = lastRow >= 2
    ? rosterSheet.getRange(2, 1, lastRow - 1, 4).getValues()
    : [];
  return {
    success: true,
    people: rows
      .filter((row) => row[0] !== "" && row[0] !== null && row[1])
      .map((row) => ({
        id: String(row[0]).trim(),
        name: String(row[1]).trim(),
        active: String(row[3] || "").toLowerCase() !== "inactive",
      })),
  };
}

function updateRosterPerson_(id, name, active, adminEmail) {
  const cleanId = String(id || "").trim();
  const cleanName = String(name || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!cleanId || !cleanName || cleanName.startsWith("=") || cleanName.length > 120) {
    return {
      success: false,
      code: "INVALID_ROSTER_UPDATE",
      message: "يرجى إدخال اسم صالح لا يتجاوز 120 حرفاً.",
    };
  }
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = spreadsheet.getSheetByName("Roster");
  if (!rosterSheet || rosterSheet.getLastRow() < 2) {
    return { success: false, code: "ROSTER_MISSING", message: "شيت Roster غير موجود." };
  }
  const rows = rosterSheet.getRange(2, 1, rosterSheet.getLastRow() - 1, 4).getValues();
  const rowIndex = rows.findIndex((row) => String(row[0]).trim() === cleanId);
  if (rowIndex === -1) {
    return { success: false, code: "PERSON_NOT_FOUND", message: "لم يتم العثور على الشخص." };
  }
  const normalizedName = normalizeName_(cleanName);
  const isActive = active !== false;
  const duplicate = isActive && rows.find((row, index) =>
    index !== rowIndex &&
    row[1] &&
    String(row[3] || "").toLowerCase() !== "inactive" &&
    normalizeName_(row[1]) === normalizedName,
  );
  if (duplicate) {
    return {
      success: false,
      code: "DUPLICATE_NAME",
      name: String(duplicate[1]),
      id: String(duplicate[0]),
      message: "يوجد شخص نشط مسجل بهذا الاسم بالفعل.",
    };
  }

  const current = rows[rowIndex];
  const oldName = String(current[1]);
  const oldActive = String(current[3] || "").toLowerCase() !== "inactive";
  if (rosterSheet.getLastColumn() < 4) rosterSheet.getRange(1, 4).setValue("Status");
  const rosterRowNumber = rowIndex + 2;
  rosterSheet.getRange(rosterRowNumber, 2).setValue(cleanName);
  rosterSheet.getRange(rosterRowNumber, 4).setValue(isActive ? "Active" : "Inactive");

  if (oldName !== cleanName) {
    [
      ["Attendance", 2],
      ["Check-in & Check-out", 2],
      ["Follow-up", 2],
    ].forEach(([sheetName, nameColumn]) => {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;
      const nameRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, nameColumn).getValues();
      nameRows.forEach((row, index) => {
        if (String(row[0]).trim() === cleanId) {
          sheet.getRange(index + 2, nameColumn).setValue(cleanName);
        }
      });
    });
  }

  let auditSheet = spreadsheet.getSheetByName("Roster Audit");
  if (!auditSheet) {
    auditSheet = spreadsheet.insertSheet("Roster Audit");
    auditSheet.getRange(1, 1, 1, 7).setValues([[
      "ID",
      "Previous Name",
      "New Name",
      "Previous Status",
      "New Status",
      "Updated At",
      "Updated By",
    ]]);
  }
  auditSheet.appendRow([
    cleanId,
    oldName,
    cleanName,
    oldActive ? "Active" : "Inactive",
    isActive ? "Active" : "Inactive",
    new Date(),
    getAdminNameByEmail(adminEmail),
  ]);
  return {
    success: true,
    person: { id: cleanId, name: cleanName, active: isActive },
  };
}

function findExactRowIndexByValue_(sheet, column, value, startRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return -1;

  const searchRange = sheet.getRange(startRow, column, lastRow - startRow + 1, 1);
  if (typeof searchRange.createTextFinder === "function") {
    const match = searchRange
      .createTextFinder(String(value))
      .matchEntireCell(true)
      .matchCase(true)
      .findNext();
    return match ? match.getRow() : -1;
  }

  const values = searchRange.getValues();
  const index = values.findIndex(
    (row) => String(row[0] || "").trim() === String(value).trim(),
  );
  return index === -1 ? -1 : startRow + index;
}

function findExactRowByValue_(sheet, column, value, startRow, columnCount) {
  const rowIndex = findExactRowIndexByValue_(sheet, column, value, startRow);
  return rowIndex === -1
    ? null
    : sheet.getRange(rowIndex, 1, 1, columnCount).getValues()[0];
}

function editDistanceAtMostOne_(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex++;
      rightIndex++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length > right.length) leftIndex++;
    else if (right.length > left.length) rightIndex++;
    else {
      leftIndex++;
      rightIndex++;
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) edits++;
  return edits <= 1;
}

function verifyOrSuggestName(inputName) {
  const cleanInput = normalizeName_(inputName);
  if (!cleanInput) return { status: "error", message: "الاسم فارغ" };
  const data = (getRosterSnapshot_() || []).map((person) => {
    const normalizedName = normalizeName_(person.name);
    return {
      id: person.id,
      name: person.name,
      normalizedName: normalizedName,
      nameTokens: normalizedName.split(" "),
    };
  });
  const exactMatch = data.find((person) => person.normalizedName === cleanInput);
  if (exactMatch)
    return {
      status: "exact_match",
      id: exactMatch.id,
      name: exactMatch.name,
    };

  const queryTokens = cleanInput.split(" ");
  const matches = data
    .map((person) => ({
      id: person.id,
      name: person.name,
      score: scoreNameTokens_(person.nameTokens, queryTokens),
    }))
    .filter((person) => person.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.length - right.name.length ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 8)
    .map(({ id, name }) => ({ id, name }));
  return matches.length > 0
    ? { status: "suggestions", matches: matches }
    : { status: "no_match" };
}

function scoreNameTokens_(nameTokens, queryTokens) {
  let score = 0;
  for (const queryToken of queryTokens) {
    let bestScore = 0;
    for (const nameToken of nameTokens) {
      if (nameToken === queryToken) bestScore = Math.max(bestScore, 100);
      else if (nameToken.startsWith(queryToken))
        bestScore = Math.max(bestScore, 80);
      else if (nameToken.includes(queryToken))
        bestScore = Math.max(bestScore, 60);
      else if (
        queryToken.length >= 4 &&
        editDistanceAtMostOne_(nameToken, queryToken)
      )
        bestScore = Math.max(bestScore, 40);
    }
    if (!bestScore) return -1;
    score += bestScore;
  }
  return score;
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
        ? rosterSheet.getRange(2, 1, lastRow - 1, 4).getValues()
        : [];
    const normalizedName = normalizeName_(cleanName);
    for (const row of rosterData) {
      if (
        row[1] &&
        String(row[3] || "").toLowerCase() !== "inactive" &&
        normalizeName_(row[1]) === normalizedName
      ) {
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
        adminName,
        "",
        "",
        delayMin > 0 ? formatDuration_(delayMin) : "",
        "Active",
      ]);
      setAttendanceMark_(
        attendanceSheet,
        newId,
        checkinTime,
        delayMin > 0 ? "+" : "++",
      );
      if (delayMin > 0)
        recordDelay_(
          newId,
          cleanName,
          delayMin,
          checkinTime,
          getAdminNameByEmail(adminEmail),
        );
    }
    return { success: true, id: newId, name: cleanName };
  });

  if (!reservation.success) return reservation;
  const cardRes = generateAllCardsFromRoster(reservation.id);
  const generatedCard = cardRes && Array.isArray(cardRes.cards)
    ? cardRes.cards.find((card) => String(card.id) === String(reservation.id))
    : null;
  const cardUrl = generatedCard ? generatedCard.driveUrl : "";
  return {
    ...reservation,
    driveUrl: cardUrl,
    cardGenerationFailed: !cardUrl,
    code: cardUrl ? "STUDENT_CREATED" : "STUDENT_CREATED_CARD_FAILED",
  };
}

function generateStudentCard_(studentId) {
  const normalizedId = String(studentId || "").trim();
  const rosterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Roster");
  if (!normalizedId || !rosterSheet || rosterSheet.getLastRow() < 2) {
    return {
      success: false,
      code: "STUDENT_NOT_FOUND",
      message: "لم يتم العثور على المخدوم.",
    };
  }

  const rows = rosterSheet.getRange(2, 1, rosterSheet.getLastRow() - 1, 4).getValues();
  const student = rows.find((row) => String(row[0]) === normalizedId);
  if (!student || String(student[3] || "").toLowerCase() === "inactive") {
    return {
      success: false,
      code: "STUDENT_NOT_FOUND",
      message: "لم يتم العثور على المخدوم.",
    };
  }
  if (String(student[2] || "").includes("drive.google.com")) {
    return { success: true, id: student[0], driveUrl: student[2] };
  }

  const cardResult = generateAllCardsFromRoster(student[0]);
  const generatedCard = cardResult && Array.isArray(cardResult.cards)
    ? cardResult.cards.find((card) => String(card.id) === normalizedId)
    : null;
  if (!generatedCard || !generatedCard.driveUrl) {
    return {
      success: false,
      code: "CARD_GENERATION_FAILED",
      message: "تعذر إنشاء بطاقة المخدوم. حاول مرة أخرى.",
    };
  }
  return { success: true, id: student[0], driveUrl: generatedCard.driveUrl };
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
    const data = rosterSheet.getRange(2, 1, rosterLastRow - 1, 4).getValues();
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
      if (String(data[i][3] || "").toLowerCase() === "inactive") continue;
      if (data[i][2] && String(data[i][2]).includes("drive.google.com"))
        continue;

      const encryptedToken = encryptId(studentId);
      const qrSizePx = 350;
      const qrApiUrl =
        "https://api.qrserver.com/v1/create-qr-code/?size=" +
        qrSizePx + "x" + qrSizePx +
        "&format=png&margin=16&ecc=M&data=" +
        encodeURIComponent(encryptedToken);
      const qrResponse = UrlFetchApp.fetch(qrApiUrl, { muteHttpExceptions: true });
      if (qrResponse.getResponseCode() !== 200) {
        throw new Error("QR image service returned HTTP " + qrResponse.getResponseCode());
      }
      const qrBlob = qrResponse
        .getBlob()
        .setName(studentName + ".png");

      const tempFile = DriveApp.getFileById(blankSlidesTemplateId).makeCopy(
        "Temp_" + studentId,
        folder,
      );
      try {
        const presentation = SlidesApp.openById(tempFile.getId());
        const slide = presentation.getSlides()[0];
        slide.getPageElements().forEach((el) => el.remove());
        slide.insertImage(templateImageBlob, 0, -20, 400, 600);
        const qrX = 120;
        const qrY = 300;
        const qrW = 160;
        const qrH = 160;
        slide.insertImage(qrBlob, qrX, qrY, qrW, qrH);
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

        if (response.getResponseCode() !== 200) {
          throw new Error("Slides card export returned HTTP " + response.getResponseCode());
        }
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
      } finally {
        tempFile.setTrashed(true);
      }
    }
    return { success: true, cards: generatedCards };
  } catch (e) {
    console.error("Card generation failed:", e);
    return {
      success: false,
      code: "CARD_GENERATION_FAILED",
      message: "تعذر إنشاء بطاقة المخدوم.",
    };
  }
}
