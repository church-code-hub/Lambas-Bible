const APP_CONFIG = window.LAMBAS_CONFIG || {};
const API_URL = APP_CONFIG.apiUrl || "";
const GOOGLE_SHEET_URL = APP_CONFIG.googleSheetUrl || "";
const OFFLINE_SESSION_KEY = "app_offline_session_email";

var currentUser = null;
var googleIdToken =
  localStorage.getItem("google_id_token") ||
  sessionStorage.getItem("google_id_token") ||
  "";
if (googleIdToken) localStorage.setItem("google_id_token", googleIdToken);
var html5QrCode = null;
var isScannerRunning = false;
var isScannerStarting = false;
var scannerStartGeneration = 0;
var qrLibraryPromise = null;
var isProcessingScan = false;
var currentAttendanceEventId = "";
var currentAttendanceContext = null;
var attendanceContextRefreshPromise = null;
var isNameSearchRunning = false;
var isCardSearchRunning = false;
var isSyncingOfflineQueue = false;
var userActionRequestCount = 0;
var activeApiRequestCount = 0;
var googleSignInInitialized = false;
var pendingSessionRestoreEmail = "";
var isSilentSessionRestore = false;
var offlineDatabasePromise = null;
var cachedRosterPromise = null;
var offlineRosterSearchCache = null;
var verifiedPassword = "";
var scheduleSettingsSnapshot = null;
var adminSettingsSnapshot = null;
var currentLoaderText = "";
var currentActiveViewId = "loginView";
var attendanceReportTab = "attendance";
var attendanceReportRequestId = 0;
var attendanceTrendsRequestId = 0;
var attendanceReportData = null;
var followupReportPeople = [];
var rosterManagementPeople = [];
var currentAttendeesRequestId = 0;
var currentAttendeesSnapshot = "";
var currentAttendeesData = [];
var currentAttendeesRequestInFlight = false;
var currentAttendeesRefreshPending = false;
var currentAttendeesCheckoutOpen = false;
var currentAttendeesRefreshTimer = 0;
var currentAttendeesWindowTimer = 0;
var currentAttendeesWindowRequestId = 0;
var currentAttendeesWindowOpen = false;
var currentAttendeesWindowCloseReason = "";
var currentAttendeesOpenRequestInFlight = false;
var currentAttendeeActionsInFlight = new Set();
var currentEmergencyCheckoutId = "";
var appearanceTransitionTimeout = 0;
var appearanceTransitionGeneration = 0;
var currentLang = localStorage.getItem("app_lang") || "ar";
var currentThemeMode =
  localStorage.getItem("app_theme") ||
  (window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark");

function beginUserActionRequest() {
  userActionRequestCount++;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    userActionRequestCount = Math.max(0, userActionRequestCount - 1);
  };
}

var activePreviewCard = { fileId: "", driveUrl: "", name: "" };
