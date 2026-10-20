      const APP_CONFIG = window.LAMBAS_CONFIG || {};
      const API_URL = APP_CONFIG.apiUrl || "";
      const GOOGLE_SHEET_URL = APP_CONFIG.googleSheetUrl || "";
      const OFFLINE_SESSION_KEY = "app_offline_session_email";

      var currentUser = null;
      var googleIdToken = sessionStorage.getItem("google_id_token") || "";
      var html5QrCode = null;
      var isScannerRunning = false;
      var isScannerStarting = false;
      var scannerStartGeneration = 0;
      var qrLibraryPromise = null;
      var isProcessingScan = false;
      var isNameSearchRunning = false;
      var isCardSearchRunning = false;
      var isSyncingOfflineQueue = false;
      var googleSignInInitialized = false;
      var pendingSessionRestoreEmail = "";
      var offlineDatabasePromise = null;
      var verifiedPassword = "";
      var currentLoaderText = "";
      var currentActiveViewId = "loginView";
      var currentLang = localStorage.getItem("app_lang") || "ar";
      var currentThemeMode = localStorage.getItem("app_theme") || "dark";

      var activePreviewCard = { fileId: "", driveUrl: "", name: "" };

      const translations = {
        ar: {
          offlineMsg: "⚠️ لا توجد اتصال بالإنترنت، يرجى التحقق من الشبكة",
          offlineQueueStatus: "سيتم حفظ الإجراءات على هذا الجهاز حتى عودة الاتصال.",
          queuedEventsCount: "إجراءات محفوظة للمزامنة: ",
          offlineScanQueued: "تم حفظ المسح على هذا الجهاز وسيُسجل عند عودة الاتصال.",
          offlineAddQueued: "تم حفظ إضافة المخدوم على هذا الجهاز وستتم مزامنتها عند عودة الاتصال.",
          offlineSyncing: "جارٍ مزامنة الإجراءات المحفوظة...",
          offlineNeedsLogin: "سجّل الدخول بحساب مخول عند عودة الاتصال لمزامنة الإجراءات.",
          offlineStorageError: "تعذر حفظ الإجراء دون اتصال على هذا الجهاز.",
          offlineSyncFailed: "تعذرت مزامنة الإجراءات المحفوظة. ستظل محفوظة على هذا الجهاز للمحاولة لاحقاً.",
          offlineQueuedTitle: "محفوظ للمزامنة",
          offlineSyncMessage: "سيتم تسجيل الإجراء عند عودة الاتصال والتحقق من الحساب.",
          offlineAccountMismatch: "بعض الإجراءات المحفوظة تخص حساباً آخر. سجّل الدخول بذلك الحساب لمزامنتها.",
          attendanceReports: "تقارير الحضور",
          attendancePersonPlaceholder: "ابحث عن اسم في هذا اليوم",
          searchAttendanceBtn: "البحث في هذا اليوم",
          createDailySheetBtn: "إنشاء تبويب لهذا اليوم",
          attendanceNoMatches: "لا توجد نتيجة لهذا الاسم في هذا اليوم.",
          attended: "حضر",
          absent: "لم يحضر",
          dailySheetCreated: "تم إنشاء تبويب اليوم في ملف الحضور.",
          followupsTitle: "قائمة الافتقاد",
          followupsNote: "أشخاص غابوا عن اجتماعين متتاليين.",
          refreshFollowupsBtn: "تحديث القائمة",
          markFollowupComplete: "تم الافتقاد",
          noFollowups: "لا توجد أسماء تحتاج إلى افتقاد حالياً.",
          followupCompleted: "تم إكمال الافتقاد.",
          offlineQueueTitle: "الإجراءات المحفوظة",
          offlineManualSyncNote: "راجع الأحداث واحذف غير المطلوب قبل المزامنة اليدوية.",
          syncOfflineEventsBtn: "مزامنة الإجراءات",
          syncNow: "مزامنة الآن",
          offlineSyncProgressTitle: "نتائج المزامنة",
          offlineSyncProgressCount: "تمت معالجة {completed} من {total}",
          offlineSyncProgressWaiting: "في الانتظار",
          offlineSyncProgressSyncing: "جارٍ المزامنة",
          offlineSyncProgressComplete: "تمت المزامنة",
          offlineSyncProgressFailed: "فشلت",
          offlineSyncProgressNotSynced: "لم تتم المزامنة",
          offlineSyncProgressNoResult: "لم تكتمل المزامنة. سيظل الإجراء محفوظاً للمحاولة لاحقاً.",
          deleteOfflineEventBtn: "حذف",
          noOfflineEvents: "لا توجد إجراءات محفوظة للمزامنة.",
          offlineEventScan: "مسح حضور أو انصراف",
          offlineEventAdd: "إضافة مخدوم",
          attendanceCancelCheckin: "إلغاء تسجيل الحضور",
          confirmCancelCheckin: "هل تريد إلغاء تسجيل الحضور لهذا الشخص؟ سيبقى الإلغاء محفوظاً في سجل التدقيق.",
          confirmDeleteOfflineEvent: "حذف هذا الإجراء المحفوظ؟",
          ownerOnlyCancel: "إلغاء تسجيل الحضور متاح لمالك ملف الشيت فقط.",
          checkoutAlreadyRecorded: "لا يمكن الإلغاء بعد تسجيل الانصراف.",
          attendNewStudent: "تسجيل حضور المخدوم إذا كان وقت الاجتماع مفتوحاً",
          searchRequiresInternet: "هذه الميزة تحتاج إلى اتصال بالإنترنت.",
          offlineRosterUnavailable: "لا توجد قائمة أسماء محفوظة على هذا الجهاز. اتصل بالإنترنت مرة واحدة لتجهيز البحث دون اتصال.",
          offlineSearchResults: "نتائج من القائمة المحفوظة على هذا الجهاز. قد لا تتضمن أحدث التغييرات.",
          offlineSearchCacheFailed: "تعذر تحديث قائمة البحث دون اتصال. ستظل آخر قائمة محفوظة متاحة.",
          offlineSearchNoCache: "لا يمكن البحث دون اتصال قبل حفظ قائمة الأسماء على هذا الجهاز.",
          noSearchMatches: "لم يتم العثور على أسماء مطابقة.",
          searchSuggestions: "أفضل النتائج",
          home: "الرئيسية",
          loading: "جاري معالجة الطلب...",
          loginTitle: "🔐 تسجيل الدخول للنظام",
          loginSub: "يرجى تسجيل الدخول بحساب Google المصرح له للبدء",
          logout: "خروج",
          dashboardTitle: "🏠 لوحة التحكم",
          scanQr: "مسح QR",
          searchName: "تحضير بالاسم",
          shareCard: "مشاركة كارت QR",
          openSheet: "فتح الشيت",
          addStudent: "إضافة مخدوم",
          meetingSchedule: "مواعيد الاجتماع",
          scanQrTitle: "مسح QR",
          cameraStarting: "جاري تشغيل الكاميرا...",
          cameraActive: "📸 الكاميرا تعمل",
          cameraUnavailable: "❌ الكاميرا غير متاحة",
          cameraError: "❌ تعذر تشغيل الكاميرا",
          restartCamera: "إعادة تشغيل الكاميرا",
          quickSearchTitle: "التحضير السريع بالاسم",
          searchPlaceholder: "اكتب الاسم هنا...",
          searchBtn: "بحث",
          shareCardTitle: "مشاركة كارت المخدوم",
          sharePlaceholder: "اكتب اسم المخدوم للبحث...",
          searchCardBtn: "بحث عن الكارت",
          cardPreviewTitle: "معاينة الكارت والمشاركة",
          addStudentTitle: "إضافة مخدوم جديد",
          studentNamePlaceholder: "اسم المخدوم ثلاثي...",
          saveGenerateBtn: "حفظ وتوليد الكارت 🎨",
          adminSettingsTitle: "إدارة الخدام وكلمة المرور",
          passwordPlaceholder: "ادخل كلمة المرور",
          enterBtn: "دخول",
          editMyName: "تعديل اسمك في الشيت",
          adminNamePlaceholder: "اسمك الذي يظهر في الشيت",
          updateMyNameBtn: "تحديث اسمي",
          newPasswordLabel: "كلمة مرور النظام الجديدة (اختياري)",
          newPasswordPlaceholder: "اتركها فارغة للإبقاء على الحالية",
          adminsListTitle: "👥 قائمة الخدام",
          newAdminEmailPlaceholder: "البريد الإلكتروني للخادم الجديد",
          newAdminNamePlaceholder: "اسم الخادم",
          addAdminBtn: "إضافة خادم جديد",
          saveChangesBtn: "💾 حفظ التغييرات",
          scheduleTitle: "مواعيد الاجتماع وأيامه",
          startTimeLabel: "موعد بدء الاجتماع",
          endTimeLabel: "موعد نهاية الاجتماع",
          delayLabel: "مدة السماح بالتأخير (دقائق)",
          allowedDaysLabel: "الأيام المسموحة",
          daySun: "الأحد",
          dayMon: "الاثنين",
          dayTue: "الثلاثاء",
          dayWed: "الأربعاء",
          dayThu: "الخميس",
          dayFri: "الجمعة",
          daySat: "السبت",
          saveScheduleBtn: "💾 حفظ المواعيد",
          scanAnother: "مسح آخر",
          alreadyShared: "✅ تمت مشاركته مسبقاً",
          notShared: "⚠️ لم يتم مشاركته من قبل",
          sendCopyBtn: "📤 مشاركة الصورة (Send a Copy)",
          openDriveBtn: "فتح في Google Drive",
          backBtn: "رجوع",
          searching: "جاري البحث...",
          noCardsFound: "لم يتم العثور على بطاقات",
          themeTooltip: "تبديل الثيم",
          adminTooltip: "إدارة الخدام",
          appIconAlt: "أيقونة تطبيق لمبات الكتاب المقدس",
          avatarAlt: "الصورة الشخصية للمستخدم",
          cardPreviewAlt: "معاينة بطاقة QR",
        },
        en: {
          offlineMsg: "⚠️ No internet connection, please check your network",
          offlineQueueStatus: "Actions will be saved on this device until the connection returns.",
          queuedEventsCount: "Actions waiting to sync: ",
          offlineScanQueued: "Scan saved on this device and will be recorded when online.",
          offlineAddQueued: "Attendee addition saved on this device and will sync when online.",
          offlineSyncing: "Syncing saved actions...",
          offlineNeedsLogin: "Sign in with an authorized account when online to sync saved actions.",
          offlineStorageError: "Could not save this offline action on the device.",
          offlineSyncFailed: "Saved actions could not sync. They remain on this device for another attempt.",
          offlineQueuedTitle: "Saved for sync",
          offlineSyncMessage: "This action will be recorded after connection and account verification return.",
          offlineAccountMismatch: "Some saved actions belong to another account. Sign in with that account to sync them.",
          attendanceReports: "Attendance Reports",
          attendancePersonPlaceholder: "Search for a person on this date",
          searchAttendanceBtn: "Search this date",
          createDailySheetBtn: "Create daily tab",
          attendanceNoMatches: "No result for this name on this date.",
          attended: "Attended",
          absent: "Absent",
          dailySheetCreated: "The daily tab was created in the attendance spreadsheet.",
          followupsTitle: "Follow-up List",
          followupsNote: "People who missed two consecutive meetings.",
          refreshFollowupsBtn: "Refresh list",
          markFollowupComplete: "Mark completed",
          noFollowups: "No one currently needs follow-up.",
          followupCompleted: "Follow-up marked completed.",
          offlineQueueTitle: "Saved Actions",
          offlineManualSyncNote: "Review events and remove unwanted ones before manual sync.",
          syncOfflineEventsBtn: "Sync actions",
          syncNow: "Sync now",
          offlineSyncProgressTitle: "Sync results",
          offlineSyncProgressCount: "{completed} of {total} processed",
          offlineSyncProgressWaiting: "Waiting",
          offlineSyncProgressSyncing: "Syncing",
          offlineSyncProgressComplete: "Synced",
          offlineSyncProgressFailed: "Failed",
          offlineSyncProgressNotSynced: "Not synced",
          offlineSyncProgressNoResult: "Sync did not finish. This action remains saved for another attempt.",
          deleteOfflineEventBtn: "Delete",
          noOfflineEvents: "No saved actions to sync.",
          offlineEventScan: "Check-in or check-out scan",
          offlineEventAdd: "Add attendee",
          attendanceCancelCheckin: "Cancel check-in",
          confirmCancelCheckin: "Cancel this check-in? The cancellation will remain in the audit log.",
          confirmDeleteOfflineEvent: "Delete this saved action?",
          ownerOnlyCancel: "Only the spreadsheet owner can cancel a check-in.",
          checkoutAlreadyRecorded: "A check-in cannot be cancelled after checkout.",
          attendNewStudent: "Record attendance if the meeting is open",
          searchRequiresInternet: "This feature requires an internet connection.",
          offlineRosterUnavailable: "No saved roster is available on this device. Connect once to enable offline search.",
          offlineSearchResults: "Results from this device's saved roster. Recent changes may not be included.",
          offlineSearchCacheFailed: "Could not refresh offline search data. The last saved roster remains available.",
          offlineSearchNoCache: "Offline search is unavailable until the roster has been saved on this device.",
          noSearchMatches: "No matching names found.",
          searchSuggestions: "Best matches",
          home: "Home",
          loading: "Processing request...",
          loginTitle: "🔐 System Login",
          loginSub: "Please sign in with an authorized Google account to start",
          logout: "Logout",
          dashboardTitle: "🏠 Dashboard",
          scanQr: "Scan QR",
          searchName: "Search by Name",
          shareCard: "Share QR Card",
          openSheet: "Open Sheet",
          addStudent: "Add Servant",
          meetingSchedule: "Meeting Schedule",
          scanQrTitle: "Scan QR",
          cameraStarting: "Starting camera...",
          cameraActive: "📸 Camera active",
          cameraUnavailable: "❌ Camera unavailable",
          cameraError: "❌ Could not start camera",
          restartCamera: "Restart Camera",
          quickSearchTitle: "Quick Check-in by Name",
          searchPlaceholder: "Type name here...",
          searchBtn: "Search",
          shareCardTitle: "Share Servant Card",
          sharePlaceholder: "Type servant name...",
          searchCardBtn: "Search Card",
          cardPreviewTitle: "Card Preview & Sharing",
          addStudentTitle: "Add New Servant",
          studentNamePlaceholder: "Full servant name...",
          saveGenerateBtn: "Save & Generate Card 🎨",
          adminSettingsTitle: "Admins & Password Management",
          passwordPlaceholder: "Enter Password",
          enterBtn: "Enter",
          editMyName: "Edit Your Name in Sheet",
          adminNamePlaceholder: "Your name in the sheet",
          updateMyNameBtn: "Update My Name",
          newPasswordLabel: "New System Password (Optional)",
          newPasswordPlaceholder: "Leave blank to keep current",
          adminsListTitle: "👥 Admins List",
          newAdminEmailPlaceholder: "New admin email",
          newAdminNamePlaceholder: "Admin name",
          addAdminBtn: "Add New Admin",
          saveChangesBtn: "💾 Save Changes",
          scheduleTitle: "Meeting Schedule & Days",
          startTimeLabel: "Meeting Start Time",
          endTimeLabel: "Meeting End Time",
          delayLabel: "Allowed Delay (Minutes)",
          allowedDaysLabel: "Allowed Days",
          daySun: "Sunday",
          dayMon: "Monday",
          dayTue: "Tuesday",
          dayWed: "Wednesday",
          dayThu: "Thursday",
          dayFri: "Friday",
          daySat: "Saturday",
          saveScheduleBtn: "💾 Save Schedule",
          scanAnother: "Scan Another",
          alreadyShared: "✅ Already shared",
          notShared: "⚠️ Not shared yet",
          sendCopyBtn: "📤 Send a Copy",
          openDriveBtn: "Open in Google Drive",
          backBtn: "Back",
          searching: "Searching...",
          noCardsFound: "No cards found",
          themeTooltip: "Toggle theme",
          adminTooltip: "Admin management",
          appIconAlt: "Lambas Bible app icon",
          avatarAlt: "User profile picture",
          cardPreviewAlt: "QR card preview",
        },
      };

      const backendMsgMap = {
        "إجراء غير معروف": { ar: "إجراء غير معروف", en: "Unknown action" },
        "الخادم مشغول حالياً، يرجى المحاولة بعد قليل.": {
          ar: "الخادم مشغول حالياً، يرجى المحاولة بعد قليل.",
          en: "Server is busy, please try again shortly.",
        },
        "طلب غير صالح": { ar: "طلب غير صالح", en: "Invalid request" },
        "❌ كلمة المرور غير صحيحة": {
          ar: "❌ كلمة المرور غير صحيحة",
          en: "❌ Incorrect password",
        },
        "⚠️ بريد إلكتروني غير صالح": {
          ar: "⚠️ بريد إلكتروني غير صالح",
          en: "⚠️ Invalid email",
        },
        "⚠️ هذا الخادم مسجل بالفعل": {
          ar: "⚠️ هذا الخادم مسجل بالفعل",
          en: "⚠️ This admin is already registered",
        },
        "✅ تم إضافة الخادم بنجاح": {
          ar: "✅ تم إضافة الخادم بنجاح",
          en: "✅ Admin added successfully",
        },
        "❌ لم يتم العثور على الخادم": {
          ar: "❌ لم يتم العثور على الخادم",
          en: "❌ Admin not found",
        },
        "✅ تم حذف الخادم بنجاح": {
          ar: "✅ تم حذف الخادم بنجاح",
          en: "✅ Admin deleted successfully",
        },
        "✅ تم تحديث اسم الخادم بنجاح": {
          ar: "✅ تم تحديث اسم الخادم بنجاح",
          en: "✅ Admin name updated successfully",
        },
        "✅ تم حفظ الإعدادات بنجاح": {
          ar: "✅ تم حفظ الإعدادات بنجاح",
          en: "✅ Settings saved successfully",
        },
        "الحساب غير مصرح له!": {
          ar: "الحساب غير مصرح له!",
          en: "Account not authorized!",
        },
        "كود غير صالح!": { ar: "كود غير صالح!", en: "Invalid code!" },
        "كود غير مسجل!": { ar: "كود غير مسجل!", en: "Unregistered code!" },
        "مسجّل حضور وانصراف!": {
          ar: "مسجّل حضور وانصراف!",
          en: "Checked in & out already!",
        },
        "تم تسجيل الانصراف!": {
          ar: "تم تسجيل الانصراف!",
          en: "Checked out successfully!",
        },
        "مسجّل حضور بالفعل!": {
          ar: "مسجّل حضور بالفعل!",
          en: "Already checked in!",
        },
        "النظام مغلق الآن!": {
          ar: "النظام مغلق الآن!",
          en: "System is closed now!",
        },
        "تم الحضور - متأخر": {
          ar: "تم الحضور - متأخر",
          en: "Attendance recorded - Late",
        },
        "تم تسجيل الحضور بنجاح!": {
          ar: "تم تسجيل الحضور بنجاح!",
          en: "Attendance recorded successfully!",
        },
        "لا تملك صلاحية لتسجيل الحضور.": { ar: "لا تملك صلاحية لتسجيل الحضور.", en: "You are not authorized to record attendance." },
        "يرجى مسح كارت صحيح.": { ar: "يرجى مسح كارت صحيح.", en: "Please scan a valid card." },
        "الرقم غير مسجل بالقاعدة.": { ar: "الرقم غير مسجل بالقاعدة.", en: "This ID is not in the roster." },
        "تم رصد حضور وانصراف مسبقاً اليوم.": { ar: "تم رصد حضور وانصراف مسبقاً اليوم.", en: "Check-in and check-out are already recorded for today." },
        "تم تسجيل الحضور اليوم.": { ar: "تم تسجيل الحضور اليوم.", en: "Check-in is already recorded for today." },
        "يستقبل التسجيل في المواعيد الرسمية فقط.": { ar: "يستقبل التسجيل في المواعيد الرسمية فقط.", en: "Attendance is closed outside the scheduled hours." },
        "🎯 في الموعد المحدد": { ar: "🎯 في الموعد المحدد", en: "🎯 On time" },
        "لا يوجد مخدوم مسجل بهذا الاسم.": { ar: "لا يوجد مخدوم مسجل بهذا الاسم.", en: "No attendee matches that name." },
        "يوجد مخدوم مسجل بهذا الاسم بالفعل.": { ar: "يوجد مخدوم مسجل بهذا الاسم بالفعل.", en: "An attendee with this name is already registered." },
        "شيت Roster غير موجود.": { ar: "شيت Roster غير موجود.", en: "The Roster sheet is missing." },
        "الحساب غير مصرح له باستخدام النظام.": { ar: "الحساب غير مصرح له باستخدام النظام.", en: "This account is not authorized to use the system." },
        "يرجى تسجيل الدخول مجدداً.": { ar: "يرجى تسجيل الدخول مجدداً.", en: "Please sign in again." },
        "تعذر التحقق من تسجيل الدخول. سجّل الدخول مجدداً.": { ar: "تعذر التحقق من تسجيل الدخول. سجّل الدخول مجدداً.", en: "Sign-in verification failed. Please sign in again." },
        "تعذر إتمام الطلب. حاول مرة أخرى.": { ar: "تعذر إتمام الطلب. حاول مرة أخرى.", en: "The request could not be completed. Please try again." },
        "يرجى إدخال مواعيد صحيحة.": { ar: "يرجى إدخال مواعيد صحيحة.", en: "Enter valid meeting times." },
        "تحقق من مدة السماح واختر يوماً واحداً على الأقل.": { ar: "تحقق من مدة السماح واختر يوماً واحداً على الأقل.", en: "Check the grace period and select at least one allowed day." },
        "يرجى إدخال اسم المخدوم.": { ar: "يرجى إدخال اسم المخدوم.", en: "Enter the attendee's name." },
        "يجب ألا يتجاوز الاسم 120 حرفاً.": { ar: "يجب ألا يتجاوز الاسم 120 حرفاً.", en: "The name must be 120 characters or fewer." },
        "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.": { ar: "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.", en: "The new password must be at least 8 characters long." },
        "يرجى إدخال اسم لا يتجاوز 100 حرف.": { ar: "يرجى إدخال اسم لا يتجاوز 100 حرف.", en: "Enter a name of 100 characters or fewer." },
        "معرّف البطاقة غير صالح.": { ar: "معرّف البطاقة غير صالح.", en: "Invalid card ID." },
        "لم يتم العثور على البطاقة في سجل المخدومين.": { ar: "لم يتم العثور على البطاقة في سجل المخدومين.", en: "Card was not found in the roster." },
        "وقت الانصراف: ": { ar: "وقت الانصراف: ", en: "Checkout time: " },
        "خطأ في إعداد النظام": { ar: "خطأ في إعداد النظام", en: "System configuration error" },
        "تحقق من وجود شيت Roster وCheck-in & Check-out.": { ar: "تحقق من وجود شيت Roster وCheck-in & Check-out.", en: "Make sure the Roster and Check-in & Check-out sheets exist." },
        "تعذر إتمام تسجيل الحضور. حاول مرة أخرى.": { ar: "تعذر إتمام تسجيل الحضور. حاول مرة أخرى.", en: "Attendance could not be recorded. Please try again." },
        "خاصية QR_SECRET_KEY غير مضبوطة في Script Properties في Apps Script.": { ar: "خاصية QR_SECRET_KEY غير مضبوطة في Script Properties في Apps Script.", en: "The QR_SECRET_KEY Script Property is missing from the Apps Script project." },
        "تعذر نقل البطاقة. تحقق من صلاحيات Drive وحاول مجدداً.": { ar: "تعذر نقل البطاقة. تحقق من صلاحيات Drive وحاول مجدداً.", en: "Could not move the card. Check Drive permissions and try again." },
        "طلب غير صالح": { ar: "طلب غير صالح", en: "Invalid request" },
        "إجراء غير معروف": { ar: "إجراء غير معروف", en: "Unknown action" },
        "خطأ": { ar: "خطأ", en: "Error" },
        "إجراء غير معروف": { ar: "إجراء غير معروف", en: "Unknown action" },
        "❌ كلمة المرور غير صحيحة": { ar: "❌ كلمة المرور غير صحيحة", en: "❌ Incorrect password" },
        "⚠️ بريد إلكتروني غير صالح": { ar: "⚠️ بريد إلكتروني غير صالح", en: "⚠️ Invalid email" },
        "⚠️ هذا الخادم مسجل بالفعل": { ar: "⚠️ هذا الخادم مسجل بالفعل", en: "⚠️ This admin is already registered" },
        "✅ تم إضافة الخادم بنجاح": { ar: "✅ تم إضافة الخادم بنجاح", en: "✅ Admin added successfully" },
        "شيت Admins غير موجود": { ar: "شيت Admins غير موجود", en: "The Admins sheet is missing." },
        "❌ لم يتم العثور على الخادم": { ar: "❌ لم يتم العثور على الخادم", en: "❌ Admin not found" },
        "✅ تم حذف الخادم بنجاح": { ar: "✅ تم حذف الخادم بنجاح", en: "✅ Admin deleted successfully" },
        "✅ تم تحديث اسم الخادم بنجاح": { ar: "✅ تم تحديث اسم الخادم بنجاح", en: "✅ Admin name updated successfully" },
        "✅ تم حفظ الإعدادات بنجاح": { ar: "✅ تم حفظ الإعدادات بنجاح", en: "✅ Settings saved successfully" },
      };

      const uiMessages = {
        "Please enter a name": { ar: "يرجى إدخال الاسم", en: "Please enter a name" },
        "⚠️ Please enter a name": { ar: "⚠️ يرجى إدخال الاسم", en: "⚠️ Please enter a name" },
        "❌ No matching results found": { ar: "❌ لم يتم العثور على نتائج مطابقة", en: "❌ No matching results found" },
        "❌ Error during search": { ar: "❌ حدث خطأ أثناء البحث", en: "❌ Error during search" },
        "⚠️ Please enter a servant name": { ar: "⚠️ يرجى إدخال اسم المخدوم", en: "⚠️ Please enter an attendee name" },
        "❌ Search error": { ar: "❌ حدث خطأ أثناء البحث", en: "❌ Search error" },
        "💾 Image downloaded successfully": { ar: "💾 تم تنزيل الصورة بنجاح", en: "💾 Image downloaded successfully" },
        "✅ Shared successfully": { ar: "✅ تمت المشاركة بنجاح", en: "✅ Shared successfully" },
        "⚠️ Link unavailable": { ar: "⚠️ الرابط غير متاح", en: "⚠️ Link unavailable" },
        "Please enter servant name": { ar: "يرجى إدخال اسم المخدوم", en: "Please enter an attendee name" },
        "🎉 Servant created successfully!": { ar: "🎉 تمت إضافة المخدوم بنجاح", en: "🎉 Attendee created successfully" },
        "Server connection error": { ar: "تعذر الاتصال بالخادم", en: "Could not connect to the server" },
        "Please enter password": { ar: "يرجى إدخال كلمة المرور", en: "Please enter the password" },
        "❌ Incorrect password": { ar: "❌ كلمة المرور غير صحيحة", en: "❌ Incorrect password" },
        "Verification error": { ar: "تعذر التحقق من البيانات", en: "Could not verify the request" },
        "Please enter name": { ar: "يرجى إدخال الاسم", en: "Please enter a name" },
        "Update failed": { ar: "تعذر التحديث", en: "Update failed" },
        "Connection error": { ar: "تعذر الاتصال بالخادم", en: "Connection error" },
        "Please enter email": { ar: "يرجى إدخال البريد الإلكتروني", en: "Please enter an email" },
        "Failed": { ar: "فشلت العملية", en: "The operation failed" },
        "Error": { ar: "حدث خطأ", en: "An error occurred" },
        "⚠️ No new password entered": { ar: "⚠️ لم يتم إدخال كلمة مرور جديدة", en: "⚠️ Enter a new password first" },
        "✅ Password changed successfully": { ar: "✅ تم تغيير كلمة المرور بنجاح", en: "✅ Password changed successfully" },
        "Preparing image for sharing...": { ar: "جارٍ تجهيز الصورة للمشاركة...", en: "Preparing image for sharing..." },
        "Registering & generating card...": { ar: "جارٍ تسجيل المخدوم وإنشاء البطاقة...", en: "Registering attendee and generating card..." },
        "Verifying...": { ar: "جارٍ التحقق...", en: "Verifying..." },
        "Updating...": { ar: "جارٍ التحديث...", en: "Updating..." },
        "Adding...": { ar: "جارٍ الإضافة...", en: "Adding..." },
        "Deleting...": { ar: "جارٍ الحذف...", en: "Deleting..." },
        "Saving...": { ar: "جارٍ الحفظ...", en: "Saving..." },
        "Saving schedule...": { ar: "جارٍ حفظ المواعيد...", en: "Saving schedule..." },
        "Invalid Code": { ar: "كود غير صالح", en: "Invalid code" },
        "Make sure to scan a valid card": { ar: "تأكد من مسح بطاقة صحيحة", en: "Make sure to scan a valid card" },
        "Connection Error": { ar: "خطأ في الاتصال", en: "Connection error" },
        "Failed to connect to server": { ar: "تعذر الاتصال بالخادم", en: "Failed to connect to the server" },
        "❌ Unauthorized account.": { ar: "❌ هذا الحساب غير مصرح له", en: "❌ This account is not authorized" },
        "Could not read Google account data": { ar: "تعذر قراءة بيانات حساب Google", en: "Could not read Google account data" },
        "❌ Sorry, email is not authorized.": { ar: "❌ هذا البريد الإلكتروني غير مصرح له", en: "❌ This email is not authorized" },
        "Email not listed in Admins: ": { ar: "هذا البريد غير موجود في قائمة Admins: ", en: "Email not listed in Admins: " },
        "Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.": { ar: "تعذر التحقق من تسجيل الدخول. تحقق من خاصية GOOGLE_CLIENT_ID في Apps Script ثم أعد نشر الخادم.", en: "Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend." },
        "Sign-in check failed on the server. Verify the latest Apps Script deployment.": { ar: "فشل التحقق من تسجيل الدخول على الخادم. تحقق من نشر أحدث إصدار من Apps Script.", en: "Sign-in check failed on the server. Verify the latest Apps Script deployment." },
        "Connection error.": { ar: "تعذر الاتصال بالخادم", en: "Connection error" },
        "Suggestions:": { ar: "اقتراحات:", en: "Suggestions:" },
        "No cards found": { ar: "لم يتم العثور على بطاقات", en: "No cards found" },
        "Are you sure you want to delete this admin?": { ar: "هل أنت متأكد من حذف هذا المشرف؟", en: "Are you sure you want to delete this admin?" },
        "Servant created successfully!": { ar: "تمت إضافة المخدوم بنجاح", en: "Attendee created successfully" },
        "Open Card in Drive": { ar: "فتح البطاقة في Google Drive", en: "Open card in Google Drive" },
        "Owner": { ar: "المالك", en: "Owner" },
        "Delete": { ar: "حذف", en: "Delete" },
        "QR Card: ": { ar: "بطاقة QR: ", en: "QR Card: " },
        "Church attendance card for ": { ar: "بطاقة حضور الكنيسة لـ ", en: "Church attendance card for " },
        "Request failed": { ar: "فشل الطلب", en: "Request failed" },
        "duplicate attendee: ": { ar: "المخدوم مسجل بالفعل: ", en: "Attendee already exists: " },
        "card generation failed": { ar: "تم تسجيل المخدوم، لكن تعذر إنشاء البطاقة.", en: "Attendee was saved, but card generation failed." },
        "Application is not configured.": { ar: "لم يتم إعداد إعدادات التطبيق المحلية.", en: "Local app configuration is missing." },
        "Google sign-in could not be loaded.": { ar: "تعذر تحميل تسجيل الدخول عبر Google.", en: "Google sign-in could not be loaded." },
      };

      function translateText(text) {
        if (!text) return "";
        const delayMatch = text.match(/^مقدار التأخير: (.+)$/);
        if (delayMatch && currentLang === "en") {
          const durationMatch = delayMatch[1].match(/(?:(\d+)\s*ساعة(?:\s*و\s*(\d+)\s*دقيقة)?|(\d+)\s*دقيقة)/);
          if (durationMatch) {
            const hours = Number(durationMatch[1] || 0);
            const minutes = Number(durationMatch[2] || durationMatch[3] || 0);
            const duration = [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "", minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : ""].filter(Boolean).join(" and ");
            return `Delay: ${duration}`;
          }
        }
        if (backendMsgMap[text]) return backendMsgMap[text][currentLang] || text;
        if (uiMessages[text]) return uiMessages[text][currentLang] || text;
        if (translations[currentLang][text]) return translations[currentLang][text];
        for (const [source, translationsForMessage] of Object.entries(backendMsgMap)) {
          if (text.startsWith(source)) {
            return (translationsForMessage[currentLang] || source) + text.slice(source.length);
          }
        }
        return text;
      }

      function runAppearanceTransition(update) {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          update();
          return;
        }
        if (document.startViewTransition) {
          document.startViewTransition(update);
          return;
        }

        document.body.classList.add("appearance-transitioning");
        document.body.offsetWidth;
        update();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.body.classList.remove("appearance-transitioning");
          });
        });
      }

      function setLanguage(lang) {
        lang = translations[lang] ? lang : "ar";
        const languageChanged = currentLang !== lang;
        const changeLanguage = () => {
          currentLang = lang;
          localStorage.setItem("app_lang", lang);
          const root = document.getElementById("htmlRoot");
          root.setAttribute("lang", lang);
          root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
          const languageLabel = document.getElementById("langLabel");
          languageLabel.innerText = lang === "ar" ? "EN" : "AR";
          if (languageChanged) {
            languageLabel.classList.remove("language-label-change");
            languageLabel.offsetWidth;
            languageLabel.classList.add("language-label-change");
            window.setTimeout(
              () => languageLabel.classList.remove("language-label-change"),
              360,
            );
          }
          updateOfflineStatus();

          document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            if (translations[lang][key]) el.innerText = translations[lang][key];
          });
          document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
            const key = el.getAttribute("data-i18n-placeholder");
            if (translations[lang][key])
              el.setAttribute("placeholder", translations[lang][key]);
          });
          document.querySelectorAll("[data-i18n-title]").forEach((el) => {
            const key = el.getAttribute("data-i18n-title");
            if (translations[lang][key]) el.setAttribute("title", translations[lang][key]);
          });
          document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
            const key = el.getAttribute("data-i18n-alt");
            if (translations[lang][key]) el.setAttribute("alt", translations[lang][key]);
          });
          document.querySelectorAll(".toast[data-message]").forEach((el) => {
            el.textContent = translateText(el.dataset.message);
          });
          const resultTitle = document.getElementById("rTitle");
          const resultMessage = document.getElementById("rMsg");
          if (resultTitle.dataset.message) resultTitle.textContent = translateText(resultTitle.dataset.message);
          if (resultMessage.dataset.message) resultMessage.textContent = translateText(resultMessage.dataset.message);
          document.querySelectorAll(".search-suggestions-heading[data-translation-key]").forEach((el) => {
            const prefix = el.dataset.translationKey === "searchSuggestions" ? "💡 " : "";
            el.textContent = prefix + translateText(el.dataset.translationKey);
          });
          document.querySelectorAll(".card-result-status[data-i18n-key]").forEach((el) => {
            el.textContent = translations[lang][el.dataset.i18nKey];
          });
          document.querySelectorAll(".admin-del-btn[data-i18n-key]").forEach((el) => {
            el.textContent = translateText("Delete");
          });
          document.querySelectorAll(".admin-owner-tag[data-i18n-key]").forEach((el) => {
            el.textContent = translateText("Owner");
          });
          document.querySelectorAll(".search-empty[data-i18n-key]").forEach((el) => {
            el.textContent = "❌ " + translations[lang][el.dataset.i18nKey];
          });
          const addStatus = document.querySelector("#addResult [data-message]");
          if (addStatus) addStatus.textContent = translateText(addStatus.dataset.message);
          const addLink = document.querySelector("#addResult a[data-message]");
          if (addLink) addLink.lastChild.textContent = translateText(addLink.dataset.message);
          if (currentLoaderText && document.getElementById("loader").style.display === "flex") {
            document.getElementById("loaderText").innerText = translateText(currentLoaderText);
          }
          const loginError = document.getElementById("loginError");
          if (loginError.dataset.message) loginError.innerText = translateText(loginError.dataset.message);
          if (currentActiveViewId === "offlineQueueView") renderOfflineQueue();
          if (currentActiveViewId === "followupView") loadFollowups();
        };
        if (currentLang === lang) changeLanguage();
        else runAppearanceTransition(changeLanguage);
      }

      function toggleLanguage() {
        setLanguage(currentLang === "ar" ? "en" : "ar");
      }

      function applyTheme(mode) {
        mode = mode === "light" ? "light" : "dark";
        const themeChanged = currentThemeMode !== mode;
        const changeTheme = () => {
          currentThemeMode = mode;
          localStorage.setItem("app_theme", mode);
          const body = document.body;
          const btn = document.getElementById("themeToggleBtn");
          body.setAttribute("data-theme", mode);
          btn.classList.remove("theme-icon-change");
          btn.offsetWidth;
          if (mode === "dark") btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
          else btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
          if (themeChanged) {
            btn.classList.add("theme-icon-change");
            window.setTimeout(
              () => btn.classList.remove("theme-icon-change"),
              360,
            );
          }
        };
        if (!themeChanged) changeTheme();
        else runAppearanceTransition(changeTheme);
      }

      function toggleTheme() {
        if (currentThemeMode === "dark") applyTheme("light");
        else applyTheme("dark");
      }

      async function apiCall(action, payload = {}) {
        if (!API_URL) throw new Error("Application is not configured.");
        const requestBody = {
          ...payload,
          action: action,
          idToken: googleIdToken,
          requestId: "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        };
        const controller = new AbortController();
        const timeoutMs = ["add_student", "sync_offline_events"].includes(action) ? 180000 : 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(API_URL, {
            method: "POST",
            redirect: "follow",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const result = await response.json();
          if (result.code === "AUTH_INVALID" && action !== "check_auth") {
            googleIdToken = "";
            sessionStorage.removeItem("google_id_token");
            if (currentUser) beginSessionRestore(currentUser.email);
            else logoutUser(result.message || "❌ Unauthorized account.");
          } else if (result.code === "AUTH_DENIED") {
            logoutUser(result.message || "❌ Unauthorized account.");
          }
          return result;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      function openOfflineDatabase() {
        if (!window.indexedDB) return Promise.reject(new Error("IndexedDB unavailable"));
        if (!offlineDatabasePromise) {
          offlineDatabasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open("lambas-attendance-offline", 2);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("events")) {
                request.result.createObjectStore("events", { keyPath: "eventId" });
              }
              if (!request.result.objectStoreNames.contains("roster")) {
                request.result.createObjectStore("roster", { keyPath: "id" });
              }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Could not open offline queue"));
          });
        }
        return offlineDatabasePromise;
      }

      async function getCachedRoster() {
        const database = await openOfflineDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction("roster", "readonly").objectStore("roster").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Could not read saved roster"));
        });
      }

      async function saveCachedRoster(roster) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("roster", "readwrite");
          const store = transaction.objectStore("roster");
          store.clear();
          roster.forEach((person) => store.put(person));
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not save roster"));
          transaction.onabort = () => reject(transaction.error || new Error("Roster cache update was cancelled"));
        });
      }

      async function refreshRosterCache() {
        if (!navigator.onLine || !currentUser || !googleIdToken) return false;
        try {
          const response = await apiCall("get_roster");
          if (!response || !response.success || !Array.isArray(response.roster)) {
            throw new Error(response && response.message ? response.message : "Invalid roster response");
          }
          const roster = response.roster.filter(
            (person) => person && person.id != null && person.name,
          ).map((person) => ({
            id: String(person.id),
            name: String(person.name),
          }));
          await saveCachedRoster(roster);
          return true;
        } catch (error) {
          showToast(translations[currentLang].offlineSearchCacheFailed, "info");
          return false;
        }
      }

      function normalizeSearchName(name) {
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

      function editDistanceAtMostOne(left, right) {
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

      function scoreCachedName(cleanName, queryTokens) {
        const nameTokens = cleanName.split(" ");
        let score = 0;
        for (const queryToken of queryTokens) {
          let bestScore = 0;
          for (const nameToken of nameTokens) {
            if (nameToken === queryToken) bestScore = Math.max(bestScore, 100);
            else if (nameToken.startsWith(queryToken)) bestScore = Math.max(bestScore, 80);
            else if (nameToken.includes(queryToken)) bestScore = Math.max(bestScore, 60);
            else if (queryToken.length >= 4 && editDistanceAtMostOne(nameToken, queryToken)) {
              bestScore = Math.max(bestScore, 40);
            }
          }
          if (!bestScore) return -1;
          score += bestScore;
        }
        return score;
      }

      function searchCachedRoster(roster, inputName) {
        const query = normalizeSearchName(inputName);
        if (!query) return { status: "error" };
        const exactMatch = roster.find((person) => normalizeSearchName(person.name) === query);
        if (exactMatch) {
          return { status: "exact_match", id: exactMatch.id, name: exactMatch.name };
        }
        const queryTokens = query.split(" ");
        const matches = roster
          .map((person) => ({
            id: person.id,
            name: person.name,
            score: scoreCachedName(normalizeSearchName(person.name), queryTokens),
          }))
          .filter((person) => person.score >= 0)
          .sort((left, right) =>
            right.score - left.score ||
            left.name.length - right.name.length ||
            left.name.localeCompare(right.name),
          )
          .slice(0, 8)
          .map(({ id, name }) => ({ id, name }));
        return matches.length
          ? { status: "suggestions", matches }
          : { status: "no_match" };
      }

      async function saveOfflineEvent(event) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("events", "readwrite");
          transaction.objectStore("events").put(event);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not save offline event"));
          transaction.onabort = () => reject(transaction.error || new Error("Offline save was cancelled"));
        });
        await updateOfflineStatus();
      }

      async function getOfflineEvents() {
        const database = await openOfflineDatabase();
        return new Promise((resolve, reject) => {
          const request = database.transaction("events", "readonly").objectStore("events").getAll();
          request.onsuccess = () => resolve(request.result.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
          request.onerror = () => reject(request.error || new Error("Could not read offline queue"));
        });
      }

      async function removeOfflineEvent(eventId) {
        const database = await openOfflineDatabase();
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("events", "readwrite");
          transaction.objectStore("events").delete(eventId);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not update offline queue"));
        });
      }

      async function queueOfflineEvent(event) {
        if (!currentUser || (navigator.onLine && !googleIdToken)) throw new Error("Offline actions require a previously authenticated session.");
        const queuedEvent = {
          ...event,
          eventId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          queuedBy: currentUser.email,
        };
        await saveOfflineEvent(queuedEvent);
        return queuedEvent;
      }

      async function updateOfflineStatus() {
        const status = document.getElementById("syncStatus");
        const offlineOverlay = document.getElementById("offlineOverlay");
        offlineOverlay.style.display = navigator.onLine ? "none" : "block";
        status.style.top = navigator.onLine
          ? "calc(72px + env(safe-area-inset-top, 0px))"
          : `${Math.ceil(offlineOverlay.getBoundingClientRect().bottom + 8)}px`;
        try {
          const events = await getOfflineEvents();
          const count = events.length;
          status.hidden = count === 0 && navigator.onLine;
          const hasOtherAccountEvents = currentUser && events.some((event) => event.queuedBy !== currentUser.email);
          status.textContent = isSyncingOfflineQueue && navigator.onLine
            ? translations[currentLang].offlineSyncing
            : count && (!currentUser || (navigator.onLine && !googleIdToken))
              ? translations[currentLang].offlineNeedsLogin + ` (${translations[currentLang].queuedEventsCount}${count})`
              : hasOtherAccountEvents
            ? translations[currentLang].offlineAccountMismatch
            : !navigator.onLine
              ? translations[currentLang].offlineQueueStatus + (count ? ` (${translations[currentLang].queuedEventsCount}${count})` : "")
              : count ? translations[currentLang].queuedEventsCount + count : "";
        } catch (error) {
          status.hidden = navigator.onLine;
          status.textContent = navigator.onLine ? "" : translations[currentLang].offlineQueueStatus;
        }
      }

      function createOfflineSyncProgress(events) {
        if (currentActiveViewId !== "offlineQueueView") return null;
        const section = document.getElementById("offlineSyncProgress");
        const progressBar = document.getElementById("offlineSyncProgressBar");
        const count = document.getElementById("offlineSyncProgressCount");
        const results = document.getElementById("offlineSyncProgressResults");
        if (!section || !progressBar || !count || !results) return null;

        section.hidden = false;
        progressBar.max = Math.max(events.length, 1);
        progressBar.value = 0;
        count.textContent = translations[currentLang].offlineSyncProgressCount
          .replace("{completed}", "0")
          .replace("{total}", String(events.length));
        results.replaceChildren();
        const entries = new Map();
        events.forEach((event) => {
          const item = document.createElement("div");
          item.className = "sync-progress-item";
          const heading = document.createElement("div");
          heading.className = "sync-progress-event";
          const title = document.createElement("strong");
          title.textContent = event.type === "add_student"
            ? translations[currentLang].offlineEventAdd + ": " + event.name
            : translations[currentLang].offlineEventScan;
          const status = document.createElement("span");
          status.className = "sync-progress-status";
          status.dataset.i18n = "offlineSyncProgressWaiting";
          status.textContent = translations[currentLang].offlineSyncProgressWaiting;
          const message = document.createElement("p");
          message.className = "sync-progress-message";
          message.hidden = true;
          heading.append(title, status);
          item.append(heading, message);
          results.appendChild(item);
          entries.set(event.eventId, { item, status, message, finished: false });
        });
        if (!events.length) {
          const empty = document.createElement("p");
          empty.className = "report-note";
          empty.textContent = translations[currentLang].noOfflineEvents;
          results.appendChild(empty);
        }
        return { entries, progressBar, count, total: events.length, completed: 0 };
      }

      function updateOfflineSyncProgress(progress, eventId, state, message = "") {
        if (!progress) return;
        const entry = progress.entries.get(eventId);
        if (!entry) return;
        const translationKey = `offlineSyncProgress${state}`;
        entry.status.dataset.i18n = translationKey;
        entry.status.textContent = translations[currentLang][translationKey];
        entry.item.classList.remove("is-complete", "is-failed", "is-not-synced", "is-syncing");
        if (state === "Complete") entry.item.classList.add("is-complete");
        else if (state === "Failed") entry.item.classList.add("is-failed");
        else if (state === "NotSynced") entry.item.classList.add("is-not-synced");
        else if (state === "Syncing") entry.item.classList.add("is-syncing");
        entry.message.textContent = message;
        entry.message.hidden = !message;
        if (state !== "Waiting" && state !== "Syncing" && !entry.finished) {
          entry.finished = true;
          progress.completed++;
          progress.progressBar.value = progress.completed;
          progress.count.textContent = translations[currentLang].offlineSyncProgressCount
            .replace("{completed}", String(progress.completed))
            .replace("{total}", String(progress.total));
        }
      }

      async function syncOfflineQueue(targetEventId = "") {
        if (isSyncingOfflineQueue || !navigator.onLine || !currentUser || !googleIdToken) return null;
        isSyncingOfflineQueue = true;
        let targetResult = null;
        let progress = null;
        await updateOfflineStatus();
        try {
          let events = await getOfflineEvents();
          progress = createOfflineSyncProgress(events);
          while (events.length && navigator.onLine && currentUser && googleIdToken) {
            const event = events[0];
            if (event.queuedBy !== currentUser.email) break;
            const batch = [];
            for (const candidate of events) {
              if (
                batch.length >= 20 ||
                candidate.queuedBy !== currentUser.email ||
                candidate.type !== event.type ||
                (event.type !== "scan" && batch.length > 0)
              ) break;
              batch.push(candidate);
            }
            batch.forEach((candidate) => updateOfflineSyncProgress(progress, candidate.eventId, "Syncing"));
            let response = null;
            for (const delay of [0, 750, 2000, 4000]) {
              if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
              if (!navigator.onLine || !currentUser || !googleIdToken) break;
              response = await apiCall("sync_offline_events", { events: batch });
              if (!response || !response.success || !Array.isArray(response.results)) break;
              if (!response.results.some((item) => item && item.status === "pending")) break;
            }
            if (!response || !response.success || !Array.isArray(response.results)) {
              batch.forEach((candidate) => updateOfflineSyncProgress(
                progress,
                candidate.eventId,
                "NotSynced",
                translations[currentLang].offlineSyncProgressNoResult,
              ));
              break;
            }
            let shouldStop = response.results.length !== batch.length;
            for (let index = 0; index < batch.length; index++) {
              const eventResult = response.results[index];
              if (!eventResult || eventResult.status !== "complete") {
                updateOfflineSyncProgress(
                  progress,
                  batch[index].eventId,
                  "NotSynced",
                  translations[currentLang].offlineSyncProgressNoResult,
                );
                shouldStop = true;
                break;
              }
              const completedEvent = batch[index];
              await removeOfflineEvent(completedEvent.eventId);
              const result = eventResult.result || {};
              const failed = result.success === false || result.kind === "error";
              updateOfflineSyncProgress(
                progress,
                completedEvent.eventId,
                failed ? "Failed" : "Complete",
                typeof result.message === "string" ? result.message : "",
              );
              if (completedEvent.eventId === targetEventId) targetResult = result;
              if (completedEvent.type === "add_student" && result.success) {
                await refreshRosterCache();
              }
              if (result.cardGenerationFailed) showToast(translateText("card generation failed"), "info");
              else if (result.success === false || result.kind === "error") showToast(result.message || translations[currentLang].offlineSyncFailed, "error");
            }
            if (shouldStop) {
              batch.forEach((candidate) => updateOfflineSyncProgress(
                progress,
                candidate.eventId,
                "NotSynced",
                translations[currentLang].offlineSyncProgressNoResult,
              ));
            }
            if (shouldStop) break;
            events = await getOfflineEvents();
          }
          if (progress) {
            progress.entries.forEach((entry, eventId) => {
              if (!entry.finished) {
                updateOfflineSyncProgress(
                  progress,
                  eventId,
                  "NotSynced",
                  translations[currentLang].offlineSyncProgressNoResult,
                );
              }
            });
          }
        } catch (error) {
          if (progress) {
            progress.entries.forEach((entry, eventId) => {
              if (!entry.finished) {
                updateOfflineSyncProgress(
                  progress,
                  eventId,
                  "NotSynced",
                  translations[currentLang].offlineSyncProgressNoResult,
                );
              }
            });
          }
          if (currentUser && googleIdToken) showToast(translations[currentLang].offlineSyncFailed, "error");
        } finally {
          isSyncingOfflineQueue = false;
          await updateOfflineStatus();
          if (currentActiveViewId === "offlineQueueView") await renderOfflineQueue();
        }
        return targetResult;
      }

      async function openOfflineQueueView() {
        showView("offlineQueueView");
        await renderOfflineQueue();
      }

      async function renderOfflineQueue() {
        const container = document.getElementById("offlineQueueResults");
        const syncButton = document.getElementById("syncOfflineEventsButton");
        if (!container || !syncButton) return;
        try {
          const events = await getOfflineEvents();
          container.replaceChildren();
          if (!events.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].noOfflineEvents;
            container.appendChild(empty);
          }
          events.forEach((event) => {
            const item = document.createElement("div");
            item.className = "admin-item";
            const details = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = event.type === "add_student"
              ? translations[currentLang].offlineEventAdd + ": " + event.name
              : translations[currentLang].offlineEventScan;
            const metadata = document.createElement("small");
            metadata.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
            metadata.textContent = `${new Date(event.timestamp).toLocaleString(currentLang === "ar" ? "ar" : "en")} · ${event.queuedBy || ""}`;
            details.append(title, metadata);
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "admin-del-btn";
            deleteButton.textContent = translations[currentLang].deleteOfflineEventBtn;
            deleteButton.addEventListener("click", () => deleteQueuedOfflineEvent(event.eventId));
            item.append(details, deleteButton);
            container.appendChild(item);
          });
          syncButton.disabled = !events.length || !navigator.onLine || !currentUser || !googleIdToken || isSyncingOfflineQueue;
        } catch (error) {
          container.replaceChildren();
          const message = document.createElement("p");
          message.className = "search-empty";
          message.textContent = translations[currentLang].offlineStorageError;
          container.appendChild(message);
          syncButton.disabled = true;
        }
      }

      async function deleteQueuedOfflineEvent(eventId) {
        if (!window.confirm(translations[currentLang].confirmDeleteOfflineEvent)) return;
        try {
          await removeOfflineEvent(eventId);
          await updateOfflineStatus();
          await renderOfflineQueue();
        } catch (error) {
          showToast(translations[currentLang].offlineStorageError, "error");
        }
      }

      function extractId(text) {
        if (!text) return "";
        text = String(text).trim();
        if (
          /^[A-Za-z0-9_-]+$/.test(text) &&
          !text.includes("http") &&
          !text.includes("{")
        )
          return text;
        var m = text.match(/[?&]id=([^&#]+)/);
        if (m && m[1]) return decodeURIComponent(m[1]).trim();
        try {
          var parsed = JSON.parse(text);
          if (parsed && parsed.id) return String(parsed.id).trim();
        } catch (e) {}
        return text;
      }

      function showToast(message, type = "error") {
        const container = document.getElementById("toastContainer");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.dataset.message = message;
        toast.innerText = translateText(message);
        container.appendChild(toast);
        setTimeout(() => {
          toast.remove();
        }, 3000);
      }

      function showSearchLoader(container) {
        const wrapper = document.createElement("div");
        wrapper.className = "search-loading";
        const spinner = document.createElement("div");
        spinner.className = "tech-loader";
        spinner.append(document.createElement("div"), document.createElement("div"));
        const label = document.createElement("div");
        label.className = "search-loading-label";
        label.setAttribute("data-i18n", "searching");
        label.textContent = translations[currentLang].searching;
        wrapper.append(spinner, label);
        container.replaceChildren(wrapper);
      }

      function showView(viewId, pushHistory = true) {
        hideLoader();
        if (currentActiveViewId && currentActiveViewId !== viewId)
          resetView(currentActiveViewId);

        if (viewId !== "adminSettingsView") {
          const lockEl = document.getElementById("adminSettingsLock");
          const formEl = document.getElementById("adminSettingsForm");
          if (lockEl) lockEl.style.display = "block";
          if (formEl) formEl.style.display = "none";
          const pw = document.getElementById("adminGatePassword");
          if (pw) pw.value = "";
        }
        if (viewId !== "scheduleSettingsView") {
          const lockEl = document.getElementById("scheduleSettingsLock");
          const formEl = document.getElementById("scheduleSettingsForm");
          if (lockEl) lockEl.style.display = "block";
          if (formEl) formEl.style.display = "none";
          const pw = document.getElementById("scheduleGatePassword");
          if (pw) pw.value = "";
        }

        [
          "loginView",
          "dashboardView",
          "scanView",
          "searchView",
          "cardShareView",
          "cardPreviewView",
          "addView",
          "adminSettingsView",
          "scheduleSettingsView",
          "resultView",
          "attendanceReportView",
          "followupView",
          "offlineQueueView",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = id === viewId ? "block" : "none";
        });
        const activeView = document.getElementById(viewId);
        if (activeView && currentActiveViewId !== viewId) {
          activeView.classList.remove("view-enter-forward", "view-enter-back");
          activeView.offsetWidth;
          activeView.classList.add(
            pushHistory ? "view-enter-forward" : "view-enter-back",
          );
          window.setTimeout(() => {
            activeView.classList.remove("view-enter-forward", "view-enter-back");
          }, 420);
        }

        const homeBtn = document.getElementById("homeBtn");
        const adminToolbarButton = document.getElementById("adminToolbarButton");
        if (adminToolbarButton) {
          adminToolbarButton.hidden = !currentUser || viewId === "loginView";
        }
        if (viewId === "dashboardView" || viewId === "loginView") {
          homeBtn.style.display = "none";
        } else {
          homeBtn.style.display = "flex";
        }

        if (
          pushHistory &&
          currentActiveViewId !== viewId &&
          viewId !== "loginView"
        ) {
          history.pushState({ view: viewId }, "", "");
        }

        currentActiveViewId = viewId;
        window.scrollTo({ top: 0, behavior: "smooth" });

        if (viewId === "scanView") {
          isProcessingScan = false;
          setTimeout(startLiveScanner, 150);
        }
      }

      function localDateInputValue(date) {
        return [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
      }

      function openFollowupView() {
        showView("followupView");
        loadFollowups();
      }

      async function loadFollowups() {
        const container = document.getElementById("followupResults");
        container.replaceChildren();
        showLoader();
        try {
          const result = await apiCall("get_followups");
          hideLoader();
          if (!result || !result.success) throw new Error(result && result.message);
          if (!result.followups.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].noFollowups;
            container.appendChild(empty);
            return;
          }
          result.followups.forEach((person) => {
            const item = document.createElement("div");
            item.className = "admin-item";
            const details = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = person.name;
            const note = document.createElement("small");
            note.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
            note.textContent = `${person.missedMeetings} · ${person.lastMissed}`;
            details.append(name, note);
            const completeButton = document.createElement("button");
            completeButton.type = "button";
            completeButton.className = "btn secondary";
            completeButton.style.cssText = "width:auto;margin:0;padding:8px 10px;";
            completeButton.textContent = translations[currentLang].markFollowupComplete;
            completeButton.addEventListener("click", () => completeAttendanceFollowup(person.id));
            item.append(details, completeButton);
            container.appendChild(item);
          });
        } catch (error) {
          hideLoader();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      async function completeAttendanceFollowup(id) {
        try {
          const result = await apiCall("complete_followup", { id: id });
          if (!result || !result.success) throw new Error(result && result.message);
          showToast(translations[currentLang].followupCompleted, "success");
          await loadFollowups();
        } catch (error) {
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function renderAttendanceReport(report, query, created) {
        const list = document.getElementById("attendanceReportResults");
        const searchResult = document.getElementById("attendanceSearchResult");
        list.replaceChildren();
        searchResult.replaceChildren();

        const summary = document.createElement("p");
        summary.className = "report-note";
        summary.textContent = `${report.date} · ${report.count}`;
        list.appendChild(summary);
        report.people.forEach((person) => {
          const item = document.createElement("div");
          item.className = "admin-item";
          const name = document.createElement("strong");
          name.textContent = person.name;
          const details = document.createElement("small");
          details.style.cssText = "display:block;color:var(--text-sub);margin-top:4px;";
          const checkinTime = person.checkinTime
            ? new Date(person.checkinTime).toLocaleTimeString(currentLang === "ar" ? "ar" : "en", { hour: "2-digit", minute: "2-digit" })
            : "";
          details.textContent = [person.mark, checkinTime, person.delay].filter(Boolean).join(" · ");
          item.append(name, details);
          list.appendChild(item);
        });

        if (query) {
          if (!report.matches.length) {
            const empty = document.createElement("p");
            empty.className = "search-empty";
            empty.textContent = translations[currentLang].attendanceNoMatches;
            searchResult.appendChild(empty);
          }
          report.matches.forEach((person) => {
            const item = document.createElement("div");
            item.className = "status-tag";
            item.textContent = `${person.name} · ${person.attended ? translations[currentLang].attended : translations[currentLang].absent}`;
            if (person.attended && person.activeCheckin && currentUser && currentUser.isOwner && report.date === localDateInputValue(new Date())) {
              const cancelButton = document.createElement("button");
              cancelButton.type = "button";
              cancelButton.className = "btn secondary";
              cancelButton.textContent = translations[currentLang].attendanceCancelCheckin;
              cancelButton.addEventListener("click", () => cancelAttendanceCheckin(person.id));
              item.appendChild(document.createElement("br"));
              item.appendChild(cancelButton);
            }
            searchResult.appendChild(item);
          });
        }
        if (created && report.report) {
          const link = document.createElement("a");
          link.className = "btn secondary";
          link.href = `${GOOGLE_SHEET_URL}#gid=${report.report.sheetId}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = translations[currentLang].dailySheetCreated;
          searchResult.appendChild(link);
        }
      }

      async function loadAttendanceReport(createSheet = false) {
        const date = document.getElementById("attendanceReportDate").value;
        const query = document.getElementById("attendancePersonQuery").value.trim();
        if (!date) {
          showToast(translations[currentLang].attendancePersonPlaceholder, "info");
          return;
        }
        showLoader();
        try {
          const result = await apiCall(
            createSheet ? "create_daily_attendance_report" : "get_attendance_day",
            { date: date, name: query },
          );
          hideLoader();
          if (!result || !result.success) throw new Error(result && result.message);
          renderAttendanceReport(result, query, createSheet);
        } catch (error) {
          hideLoader();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      function createAttendanceReportSheet() {
        loadAttendanceReport(true);
      }

      async function cancelAttendanceCheckin(id) {
        if (!currentUser || !currentUser.isOwner) {
          showToast(translations[currentLang].ownerOnlyCancel, "error");
          return;
        }
        if (!window.confirm(translations[currentLang].confirmCancelCheckin)) return;
        showLoader();
        try {
          const result = await apiCall("cancel_checkin", { id: id });
          hideLoader();
          if (!result || !result.success) {
            if (result && result.code === "CHECKOUT_ALREADY_RECORDED") {
              throw new Error(translations[currentLang].checkoutAlreadyRecorded);
            }
            throw new Error(result && result.message);
          }
          showToast(translations[currentLang].followupCompleted, "success");
          await loadAttendanceReport();
        } catch (error) {
          hideLoader();
          showToast(error.message || translations[currentLang].offlineSyncFailed, "error");
        }
      }

      window.addEventListener("popstate", function (e) {
        if (e.state && e.state.view) showView(e.state.view, false);
        else showView(currentUser ? "dashboardView" : "loginView", false);
      });

      function resetView(viewId) {
        if (viewId === "searchView") {
          document.getElementById("searchNameInput").value = "";
          document.getElementById("searchResults").innerHTML = "";
        } else if (viewId === "scanView") {
          stopLiveScanner();
        } else if (viewId === "addView") {
          document.getElementById("newStudentName").value = "";
          document.getElementById("addResult").innerHTML = "";
        } else if (viewId === "cardShareView") {
          document.getElementById("shareNameInput").value = "";
          document.getElementById("shareResults").innerHTML = "";
        }
      }

      function openAdminSettings() {
        showView("adminSettingsView");
      }
      function openScheduleSettings() {
        showView("scheduleSettingsView");
      }

      window.addEventListener("online", async () => {
        await updateOfflineStatus();
        initializeGoogleSignIn();
        if (currentUser && !googleIdToken) {
          beginSessionRestore(currentUser.email);
          return;
        }
        await refreshRosterCache();
      });
      window.addEventListener("offline", updateOfflineStatus);

      window.addEventListener("DOMContentLoaded", async function () {
        const attendanceDateInput = document.getElementById("attendanceReportDate");
        if (attendanceDateInput) attendanceDateInput.value = localDateInputValue(new Date());
        setLanguage(currentLang);
        applyTheme(currentThemeMode);
        const enterActions = {
          searchNameInput: executeSearch,
          shareNameInput: executeCardSearch,
          newStudentName: submitNewStudent,
          adminGatePassword: unlockAdminSettings,
          cfgAdminName: updateMyName,
          cfgNewPassword: saveAdminSettings,
          newAdminEmail: () => document.getElementById("newAdminNameInput").focus(),
          newAdminNameInput: addNewAdmin,
          scheduleGatePassword: unlockScheduleSettings,
          cfgStartTime: saveScheduleSettings,
          cfgEndTime: saveScheduleSettings,
          cfgAcceptedDelay: saveScheduleSettings,
        };
        Object.entries(enterActions).forEach(([fieldId, action]) => {
          const field = document.getElementById(fieldId);
          if (!field) return;
          field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.isComposing) return;
            event.preventDefault();
            action();
          });
        });
        const signInReady = navigator.onLine ? initializeGoogleSignIn() : false;
        await updateOfflineStatus();

        const savedUser = localStorage.getItem("app_user");
        if (savedUser) {
          try {
            currentUser = JSON.parse(savedUser);
            if (!currentUser || !currentUser.email) throw new Error("Saved user is invalid.");
            const rememberedEmail = (localStorage.getItem(OFFLINE_SESSION_KEY) || "").toLowerCase().trim();
            if (!navigator.onLine && rememberedEmail === currentUser.email.toLowerCase().trim()) {
              setupUserProfileUI();
              checkDirectUrlScan();
              await updateOfflineStatus();
              return;
            }
            if (!navigator.onLine) {
              currentUser = null;
              showView("loginView", false);
              await updateOfflineStatus();
              return;
            }
            if (!googleIdToken) {
              if (signInReady) beginSessionRestore(currentUser.email);
              else currentUser = null;
              return;
            }
            showLoader();
            const authRes = await apiCall("check_auth", {
              email: currentUser.email,
            });
            hideLoader();
            if (
              authRes &&
              authRes.authorized &&
              String(authRes.email || "").toLowerCase().trim() === currentUser.email.toLowerCase().trim()
            ) {
              if (authRes.adminName) currentUser.name = authRes.adminName;
              currentUser.isOwner = authRes.isOwner === true;
              localStorage.setItem(OFFLINE_SESSION_KEY, currentUser.email.toLowerCase().trim());
              localStorage.setItem("app_user", JSON.stringify(currentUser));
              setupUserProfileUI();
              checkDirectUrlScan();
              await refreshRosterCache();
            } else if (authRes && authRes.code === "AUTH_INVALID" && signInReady) {
              googleIdToken = "";
              sessionStorage.removeItem("google_id_token");
              beginSessionRestore(currentUser.email);
            } else if (authRes && authRes.authorized) {
              logoutUser("Please sign in again.");
            } else if (authRes && authRes.success && !authRes.authorized) {
              logoutUser("❌ Unauthorized account.");
            } else {
              currentUser = null;
              showLoginError("Sign-in check failed on the server. Verify the latest Apps Script deployment.");
            }
          } catch (e) {
            hideLoader();
            currentUser = null;
            showLoginError("Connection error.");
          }
        } else {
          showView("loginView", false);
        }
      });

      function initializeGoogleSignIn() {
        if (googleSignInInitialized) return true;
        const clientId = APP_CONFIG.googleClientId;
        const button = document.getElementById("g_id_signin");
        if (!clientId || !button) {
          showLoginError("Application is not configured.");
          return false;
        }
        if (!window.google || !google.accounts || !google.accounts.id) {
          showLoginError("Google sign-in could not be loaded.");
          return false;
        }
        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: true,
        });
        google.accounts.id.renderButton(button, {
          type: "standard",
          size: "large",
          theme: "outline",
          text: "sign_in_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
        googleSignInInitialized = true;
        return true;
      }

      function beginSessionRestore(email) {
        if (!navigator.onLine || !window.google || !google.accounts || !google.accounts.id) {
          currentUser = null;
          hideLoader();
          showView("loginView", false);
          return;
        }
        pendingSessionRestoreEmail = String(email || "").toLowerCase().trim();
        showLoader();
        google.accounts.id.prompt((notification) => {
          const unavailable =
            (notification.isNotDisplayed && notification.isNotDisplayed()) ||
            (notification.isSkippedMoment && notification.isSkippedMoment()) ||
            (notification.isDismissedMoment && notification.isDismissedMoment());
          if (unavailable && pendingSessionRestoreEmail) {
            pendingSessionRestoreEmail = "";
            currentUser = null;
            hideLoader();
            showView("loginView", false);
          }
        });
      }

      async function handleCredentialResponse(response) {
        const payload = parseJwt(response.credential);
        if (!payload || !payload.email) {
          showLoginError("Could not read Google account data");
          return;
        }
        const expectedEmail = pendingSessionRestoreEmail;
        pendingSessionRestoreEmail = "";
        if (expectedEmail && payload.email.toLowerCase().trim() !== expectedEmail) {
          currentUser = null;
          showView("loginView", false);
          return;
        }

        googleIdToken = response.credential;
        showLoader();
        try {
          const authRes = await apiCall("check_auth", { email: payload.email });
          hideLoader();
          if (
            authRes &&
            authRes.authorized &&
            String(authRes.email || "").toLowerCase().trim() === payload.email.toLowerCase().trim()
          ) {
            currentUser = {
              email: payload.email.toLowerCase().trim(),
              name: authRes.adminName || payload.name || payload.email,
              picture:
                payload.picture ||
                "https://lh3.googleusercontent.com/a/default-user",
              isOwner: authRes.isOwner === true,
            };
            sessionStorage.setItem("google_id_token", googleIdToken);
            localStorage.setItem("app_user", JSON.stringify(currentUser));
            localStorage.setItem(OFFLINE_SESSION_KEY, currentUser.email);
            setupUserProfileUI();
            checkDirectUrlScan();
            await refreshRosterCache();
          } else if (authRes && authRes.code === "AUTH_INVALID") {
            googleIdToken = "";
            sessionStorage.removeItem("google_id_token");
            showLoginError("Sign-in token could not be verified. Check the Apps Script GOOGLE_CLIENT_ID property and redeploy the backend.");
          } else if (authRes && authRes.code === "AUTH_REQUIRED") {
            googleIdToken = "";
            sessionStorage.removeItem("google_id_token");
            showLoginError("Please sign in again.");
          } else if (authRes && authRes.authorized) {
            logoutUser("Please sign in again.");
          } else if (authRes && authRes.success === false) {
            showLoginError("Sign-in check failed on the server. Verify the latest Apps Script deployment.");
          } else {
            googleIdToken = "";
            sessionStorage.removeItem("google_id_token");
            const checkedEmail = authRes && authRes.email ? authRes.email : payload.email;
            showLoginError("❌ Sorry, email is not authorized.\n" + translateText("Email not listed in Admins: ") + checkedEmail);
          }
        } catch (e) {
          googleIdToken = "";
          sessionStorage.removeItem("google_id_token");
          hideLoader();
          currentUser = null;
          showLoginError("Connection error.");
        }
      }

      function setupUserProfileUI() {
        if (!currentUser) return;
        document.getElementById("uName").innerText = currentUser.name;
        document.getElementById("uEmail").innerText = currentUser.email;
        document.getElementById("uAvatar").src = currentUser.picture;
        showView("dashboardView");
      }

      function logoutUser(msg) {
        localStorage.removeItem("app_user");
        localStorage.removeItem(OFFLINE_SESSION_KEY);
        sessionStorage.removeItem("google_id_token");
        pendingSessionRestoreEmail = "";
        googleIdToken = "";
        currentUser = null;
        verifiedPassword = "";
        stopLiveScanner();
        if (msg) showLoginError(msg);
        showView("loginView", false);
      }

      function showLoginError(msg) {
        var errDiv = document.getElementById("loginError");
        errDiv.dataset.message = msg;
        errDiv.innerText = translateText(msg);
        errDiv.style.display = "block";
        showView("loginView", false);
      }

      function checkDirectUrlScan() {
        var urlParams = new URLSearchParams(window.location.search);
        var scannedId = urlParams.get("id");
        if (scannedId) processScannedText(scannedId);
      }

      function openSheet() {
        window.open(GOOGLE_SHEET_URL, "_blank");
      }
      function showLoader(text) {
        currentLoaderText = text || translations[currentLang].loading;
        document.getElementById("loaderText").innerText = translateText(
          currentLoaderText,
        );
        document.getElementById("mainContainer").classList.add("is-loading");
        document.getElementById("loader").style.display = "flex";
      }
      function hideLoader() {
        document.getElementById("loader").style.display = "none";
        document.getElementById("mainContainer").classList.remove("is-loading");
        currentLoaderText = "";
      }

      function parseJwt(token) {
        try {
          var base64Url = token.split(".")[1];
          var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
          var jsonPayload = decodeURIComponent(
            atob(base64)
              .split("")
              .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
              .join(""),
          );
          return JSON.parse(jsonPayload);
        } catch (e) {
          return null;
        }
      }

      function renderResult(r) {
        r = r || {};
        var COLORS = {
          success: "#16a34a",
          late: "#d97706",
          out: "#2563eb",
          warn: "#d97706",
          error: "#ef4444",
          closed: "#d97706",
          queued: "#0284c7",
        };
        var color = COLORS[r.kind] || "#d97706";
        document.getElementById("rIcon").innerHTML =
          `<i class="fa-solid ${r.kind === "success" ? "fa-check" : "fa-info"}"></i>`;
        document.getElementById("rIcon").style.color = color;
        const titleText = r.title || (r.code ? "Request failed" : "");
        const titleEl = document.getElementById("rTitle");
        titleEl.dataset.message = titleText;
        titleEl.innerText = translateText(titleText);
        var nameEl = document.getElementById("rName");
        nameEl.innerText = r.name || "";
        nameEl.style.display = r.name ? "block" : "none";
        var msgEl = document.getElementById("rMsg");
        msgEl.dataset.message = r.message || "";
        msgEl.innerText = translateText(r.message || "");
        msgEl.style.display = r.message ? "block" : "none";
        showView("resultView");
      }

      function setCameraStatus(translationKey) {
        const status = document.getElementById("cameraStatus");
        status.setAttribute("data-i18n", translationKey);
        status.textContent = translations[currentLang][translationKey];
      }

      function loadQrLibrary() {
        if (window.Html5Qrcode) return Promise.resolve();
        if (!qrLibraryPromise) {
          qrLibraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "./vendor/html5-qrcode.min.js";
            script.async = true;
            script.onload = () => {
              if (window.Html5Qrcode) resolve();
              else reject(new Error("QR scanner library did not initialize."));
            };
            script.onerror = () => reject(new Error("QR scanner library could not be loaded."));
            document.head.appendChild(script);
          }).catch((error) => {
            qrLibraryPromise = null;
            throw error;
          });
        }
        return qrLibraryPromise;
      }

      async function startLiveScanner() {
        if (isScannerRunning || isScannerStarting) return;
        const generation = ++scannerStartGeneration;
        isScannerStarting = true;
        setCameraStatus("cameraStarting");
        const config = { fps: 10, qrbox: { width: 220, height: 220 } };

        try {
          await loadQrLibrary();
          if (generation !== scannerStartGeneration || currentActiveViewId !== "scanView") return;
          if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");
          try {
            await html5QrCode.start(
              { facingMode: "environment" },
              config,
              onScanSuccess,
              onScanError,
            );
          } catch (environmentCameraError) {
            await html5QrCode.start(
              { facingMode: "user" },
              config,
              onScanSuccess,
              onScanError,
            );
          }
          isScannerRunning = true;
          setCameraStatus("cameraActive");
        } catch (err) {
          isScannerRunning = false;
          setCameraStatus(window.Html5Qrcode ? "cameraUnavailable" : "cameraError");
        } finally {
          isScannerStarting = false;
          if (
            generation !== scannerStartGeneration &&
            currentActiveViewId === "scanView"
          ) {
            window.setTimeout(startLiveScanner, 0);
          }
        }
      }

      function stopLiveScanner() {
        scannerStartGeneration++;
        if (html5QrCode && isScannerRunning) {
          return html5QrCode
            .stop()
            .then(() => {
              isScannerRunning = false;
            })
            .catch(() => {
              isScannerRunning = false;
            })
            .finally(() => {
              if (currentActiveViewId === "scanView") {
                window.setTimeout(startLiveScanner, 150);
              }
            });
        }
        return Promise.resolve();
      }

      function restartScanner() {
        isProcessingScan = false;
        stopLiveScanner().then(() => {
          setTimeout(startLiveScanner, 200);
        });
      }

      function onScanSuccess(text) {
        if (isProcessingScan) return;
        isProcessingScan = true;
        stopLiveScanner().then(() => {
          processScannedText(text).finally(() => {
            isProcessingScan = false;
          });
        });
      }
      function onScanError(err) {}

      async function processScannedText(text) {
        var id = extractId(text);
        if (!id) {
          renderResult({
            kind: "error",
            title: "Invalid Code",
            message: "Make sure to scan a valid card",
          });
          return;
        }
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          renderResult({ kind: "error", title: "Sign-in required", message: "offlineNeedsLogin" });
          return;
        }
        try {
          if (!navigator.onLine) {
            await queueOfflineEvent({ type: "scan", qrText: id });
            renderResult({ kind: "queued", title: "offlineQueuedTitle", name: "", message: "offlineScanQueued" });
            return;
          }
          showLoader();
          const res = await apiCall("scan", { id: id });
          hideLoader();
          if (res) renderResult(res);
          else renderResult({ kind: "error", title: "Error", message: "offlineSyncFailed" });
        } catch (e) {
          hideLoader();
          renderResult({ kind: "error", title: "Error", message: "offlineStorageError" });
        }
      }

      async function processDirectAttendance(rawId) {
        if (!currentUser || (navigator.onLine && !googleIdToken)) {
          renderResult({
            kind: "error",
            title: "Sign-in required",
            message: "offlineNeedsLogin",
          });
          return;
        }
        try {
          if (!navigator.onLine) {
            await queueOfflineEvent({
              type: "scan",
              qrText: String(rawId),
            });
            renderResult({
              kind: "queued",
              title: "offlineQueuedTitle",
              name: "",
              message: "offlineScanQueued",
            });
            return;
          }
          showLoader();
          const result = await apiCall("scan", { id: String(rawId) });
          hideLoader();
          if (result) renderResult(result);
          else {
            renderResult({ kind: "error", title: "Error", message: "offlineSyncFailed" });
          }
        } catch (e) {
          hideLoader();
          renderResult({
            kind: "error",
            title: "Error",
            message: "offlineStorageError",
          });
        }
      }

      function renderNameSearchResults(result, isOffline) {
        const results = document.getElementById("searchResults");
        results.replaceChildren();
        if (!result || result.status === "no_match" || result.status === "error") {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = translateText("noSearchMatches");
          results.appendChild(empty);
          return;
        }
        if (isOffline) {
          const note = document.createElement("div");
          note.className = "search-suggestions-heading";
          note.dataset.translationKey = "offlineSearchResults";
          note.textContent = translateText("offlineSearchResults");
          results.appendChild(note);
        }
        if (result.status === "exact_match") {
          processDirectAttendance(result.id);
          return;
        }
        if (result.status === "suggestions" && Array.isArray(result.matches)) {
          const heading = document.createElement("div");
          heading.className = "search-suggestions-heading";
          heading.dataset.translationKey = "searchSuggestions";
          heading.textContent = "💡 " + translateText("searchSuggestions");
          results.appendChild(heading);
          result.matches.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "suggestion-btn";
            const icon = document.createElement("i");
            icon.className = "fa-solid fa-user";
            const label = document.createElement("span");
            label.textContent = item.name;
            button.append(icon, label);
            button.onclick = () => processDirectAttendance(item.id);
            results.appendChild(button);
          });
        }
      }

      async function executeSearch() {
        var name = document.getElementById("searchNameInput").value.trim();
        var resDiv = document.getElementById("searchResults");
        if (!name) {
          showToast("⚠️ Please enter a name", "error");
          return;
        }
        if (isNameSearchRunning) return;
        isNameSearchRunning = true;
        const searchButton = document.getElementById("btnSearch");
        searchButton.disabled = true;
        try {
          if (!navigator.onLine) {
            showSearchLoader(resDiv);
            const roster = await getCachedRoster();
            if (!roster.length) {
              resDiv.replaceChildren();
              const empty = document.createElement("div");
              empty.className = "search-empty";
              empty.textContent = translateText("offlineSearchNoCache");
              resDiv.appendChild(empty);
              return;
            }
            renderNameSearchResults(searchCachedRoster(roster, name), true);
          } else {
            showSearchLoader(resDiv);
            const response = await apiCall("search", { name: name });
            if (response && response.success === false) {
              resDiv.replaceChildren();
              showToast(response.message || "Error", "error");
              return;
            }
            renderNameSearchResults(response, false);
          }
        } catch (err) {
          if (navigator.onLine) {
            try {
              const roster = await getCachedRoster();
              if (roster.length) {
                renderNameSearchResults(searchCachedRoster(roster, name), true);
                return;
              }
            } catch (cacheError) {
              showToast(translations[currentLang].offlineSearchCacheFailed, "info");
            }
          }
          resDiv.replaceChildren();
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = navigator.onLine
            ? "❌ Error during search"
            : translateText("offlineSearchNoCache");
          resDiv.appendChild(empty);
          if (navigator.onLine) showToast("❌ Error during search", "error");
        } finally {
          isNameSearchRunning = false;
          searchButton.disabled = false;
        }
      }

      // Card Share Search with Visible Tech Loader -> Clicking opens Preview View
      async function executeCardSearch() {
        var name = document.getElementById("shareNameInput").value.trim();
        var resDiv = document.getElementById("shareResults");
        if (!name) {
          showToast("⚠️ Please enter a servant name", "error");
          return;
        }
        if (!navigator.onLine) {
          showToast(translateText("searchRequiresInternet"), "info");
          return;
        }

        if (isCardSearchRunning) return;
        isCardSearchRunning = true;
        const searchButton = document.querySelector("#cardShareView .btn");
        searchButton.disabled = true;
        showSearchLoader(resDiv);
        try {
          const res = await apiCall("search_card_share", { name: name });
          if (res && res.success === false) {
            resDiv.replaceChildren();
            showToast(res.message || "Error", "error");
            return;
          }
          resDiv.replaceChildren();
          if (res && res.status === "success" && Array.isArray(res.matches)) {
            res.matches.forEach((item) => {
              var cardBox = document.createElement("button");
              cardBox.type = "button";
              cardBox.className = "card-result";
              cardBox.style.cssText =
                "background:var(--chip-bg); backdrop-filter:blur(15px); border:1.5px solid var(--card-border); padding:14px; border-radius:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; transition: all 0.2s;";

              let statusText = item.isNew
                ? translations[currentLang].notShared
                : translations[currentLang].alreadyShared;
              let statusColor = item.isNew ? "#f59e0b" : "#16a34a";

              const nameLabel = document.createElement("div");
              nameLabel.className = "card-result-name";
              nameLabel.textContent = "👤 " + item.name;
              const statusLabel = document.createElement("div");
              statusLabel.className = "card-result-status";
              statusLabel.dataset.i18nKey = item.isNew ? "notShared" : "alreadyShared";
              statusLabel.style.color = statusColor;
              statusLabel.textContent = statusText;
              cardBox.append(nameLabel, statusLabel);

              cardBox.onclick = () => {
                openCardPreview(item.fileId, item.driveUrl, item.name);
              };

              resDiv.appendChild(cardBox);
            });
          } else {
            const empty = document.createElement("div");
            empty.className = "search-empty";
            empty.dataset.i18nKey = "noCardsFound";
            empty.textContent = "❌ " + translateText("No cards found");
            resDiv.appendChild(empty);
          }
        } catch (e) {
          resDiv.innerHTML = "";
          showToast("❌ Search error", "error");
        } finally {
          isCardSearchRunning = false;
          searchButton.disabled = false;
        }
      }

      function openCardPreview(fileId, driveUrl, studentName) {
        activePreviewCard = {
          fileId: fileId,
          driveUrl: driveUrl,
          name: studentName,
        };
        document.getElementById("previewStudentName").innerText = studentName;

        const fetchUrl = resolveHighQualityDriveImageUrl(driveUrl);

        document.getElementById("previewCardImg").src = fetchUrl;
        showView("cardPreviewView");
      }

      function resolveHighQualityDriveImageUrl(driveUrl) {
        if (!driveUrl) return driveUrl;
        const matchId =
          (driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
            driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/)) ||
          (driveUrl.match(/id=([a-zA-Z0-9_-]+)/) && driveUrl.match(/id=([a-zA-Z0-9_-]+)/));
        if (matchId && matchId[1]) {
          return "https://lh3.googleusercontent.com/d/" + matchId[1] + "?authuser=0&sz=w2000";
        }
        return driveUrl;
      }

      async function shareCurrentCardImage() {
        showLoader("Preparing image for sharing...");
        try {
          let fetchUrl = resolveHighQualityDriveImageUrl(activePreviewCard.driveUrl);

          const response = await fetch(fetchUrl, { mode: "cors" });
          if (!response.ok) throw new Error("Card image could not be loaded");
          const blob = await response.blob();
          const file = new File([blob], activePreviewCard.name + "_card.png", {
            type: "image/png",
          });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: "QR Card: " + activePreviewCard.name,
              text: "Church attendance card for " + activePreviewCard.name,
              files: [file],
            });
          } else {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = activePreviewCard.name + "_card.png";
            a.click();
            showToast("💾 Image downloaded successfully", "success");
          }

          if (activePreviewCard.fileId) {
            const moveResult = await apiCall("share_move_card", {
              fileId: activePreviewCard.fileId,
            });
            if (!moveResult || !moveResult.success) {
              throw new Error(moveResult && moveResult.message ? moveResult.message : "Card migration failed");
            }
          }
          hideLoader();
          showToast("✅ Shared successfully", "success");
        } catch (e) {
          hideLoader();
          if (e.name === "AbortError") return;
          if (e.message && e.message.includes("البطاقة")) showToast(e.message, "error");
          else window.open(resolveHighQualityDriveImageUrl(activePreviewCard.driveUrl), "_blank", "noopener");
        }
      }

      function openCurrentCardDrive() {
        if (activePreviewCard.driveUrl) {
          window.open(activePreviewCard.driveUrl, "_blank");
        } else {
          showToast("⚠️ Link unavailable", "error");
        }
      }

      async function submitNewStudent() {
        var name = document.getElementById("newStudentName").value.trim();
        const attendIfOpen = document.getElementById("attendNewStudent").checked;
        const submitButton = document.getElementById("btnAddStudent");
        if (submitButton.disabled) return;
        if (!name) {
          showToast("Please enter servant name", "error");
          return;
        }
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");
        const showQueuedResult = () => {
          const resultContainer = document.getElementById("addResult");
          resultContainer.replaceChildren();
          const status = document.createElement("p");
          status.dataset.message = "offlineAddQueued";
          status.textContent = translations[currentLang].offlineAddQueued;
          resultContainer.appendChild(status);
          document.getElementById("newStudentName").value = "";
          showToast(translations[currentLang].offlineAddQueued, "info");
        };
        try {
          if (!currentUser || (navigator.onLine && !googleIdToken)) throw new Error("Offline actions require a signed-in account.");
          if (!navigator.onLine) {
            await queueOfflineEvent({ type: "add_student", name: name, attendIfOpen: attendIfOpen });
            showQueuedResult();
            return;
          }

          showLoader("Registering & generating card...");
          const res = await apiCall("add_student", { name: name, attendIfOpen: attendIfOpen });
          hideLoader();
          if (res && res.success) {
            const resultContainer = document.getElementById("addResult");
            resultContainer.replaceChildren();
            const status = document.createElement("p");
            status.style.color = res.cardGenerationFailed ? "#d97706" : "#16a34a";
            status.style.fontWeight = "bold";
            status.dataset.message = res.cardGenerationFailed ? "card generation failed" : "Servant created successfully!";
            status.textContent = res.cardGenerationFailed
              ? translateText("card generation failed")
              : translateText("Servant created successfully!");
            resultContainer.appendChild(status);
            if (res.driveUrl) {
              const link = document.createElement("a");
              link.href = res.driveUrl;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.className = "btn";
              link.style.marginTop = "10px";
              link.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i> ';
              link.dataset.message = "Open Card in Drive";
              link.append(document.createTextNode(translateText(link.dataset.message)));
              resultContainer.appendChild(link);
            }
            showToast(res.cardGenerationFailed ? translateText("card generation failed") : "🎉 Servant created successfully!", res.cardGenerationFailed ? "info" : "success");
            document.getElementById("newStudentName").value = "";
          } else {
            const message = res && res.code === "DUPLICATE_NAME"
              ? translateText("duplicate attendee: ") + `${res.name} (#${res.id})`
              : (res && res.message) || "Failed";
            showToast(message, "error");
          }
        } catch (e) {
          hideLoader();
          showToast(navigator.onLine ? "Server connection error" : translations[currentLang].offlineStorageError, "error");
        } finally {
          hideLoader();
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
      }

      async function unlockAdminSettings() {
        var pw = document.getElementById("adminGatePassword").value.trim();
        if (!pw) {
          showToast("Please enter password", "error");
          return;
        }
        showLoader("Verifying...");
        try {
          const res = await apiCall("verify_settings_password", {
            password: pw,
          });
          hideLoader();
          if (res && res.valid) {
            verifiedPassword = pw;
            document.getElementById("adminSettingsLock").style.display = "none";
            document.getElementById("adminSettingsForm").style.display =
              "block";
            document.getElementById("cfgAdminName").value =
              currentUser.name || "";
            loadAdminsData();
          } else {
            showToast("❌ Incorrect password", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Verification error", "error");
        }
      }

      async function loadAdminsData() {
        try {
          const res = await apiCall("get_admins");
          if (res && res.success) {
            const container = document.getElementById("adminsListContainer");
            container.innerHTML = "";
            res.admins.forEach((admin) => {
              var div = document.createElement("div");
              div.className = "admin-item";
              const details = document.createElement("div");
              const adminName = document.createElement("strong");
              adminName.textContent = admin.name;
              const email = document.createElement("span");
              email.style.cssText = "font-size:11px;color:var(--text-sub);";
              email.textContent = admin.email;
              details.append(adminName, document.createElement("br"), email);
              div.appendChild(details);
              if (!admin.isOwner) {
                var delBtn = document.createElement("button");
                delBtn.className = "admin-del-btn";
                delBtn.dataset.i18nKey = "Delete";
                delBtn.innerText = translateText("Delete");
                delBtn.onclick = () => deleteAdmin(admin.email);
                div.appendChild(delBtn);
              } else {
                var tag = document.createElement("span");
                tag.style.cssText =
                  "font-size:11px; color:var(--accent-gold); font-weight:bold;";
                tag.className = "admin-owner-tag";
                tag.dataset.i18nKey = "Owner";
                tag.innerText = translateText("Owner");
                div.appendChild(tag);
              }
              container.appendChild(div);
            });
          }
        } catch (e) {}
      }

      async function updateMyName() {
        var newName = document.getElementById("cfgAdminName").value.trim();
        if (!newName) {
          showToast("Please enter name", "error");
          return;
        }
        showLoader("Updating...");
        try {
          const res = await apiCall("update_admin_profile", {
            email: currentUser.email,
            name: newName,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            currentUser.name = newName;
            localStorage.setItem("app_user", JSON.stringify(currentUser));
            document.getElementById("uName").innerText = newName;
            showToast(res.message, "success");
          } else {
            showToast(res.message || "Update failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Connection error", "error");
        }
      }

      async function addNewAdmin() {
        var email = document.getElementById("newAdminEmail").value.trim();
        var name = document.getElementById("newAdminNameInput").value.trim();
        if (!email) {
          showToast("Please enter email", "error");
          return;
        }
        showLoader("Adding...");
        try {
          const res = await apiCall("add_admin", {
            email: email,
            name: name,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
            document.getElementById("newAdminEmail").value = "";
            document.getElementById("newAdminNameInput").value = "";
            loadAdminsData();
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function deleteAdmin(email) {
        if (!confirm(translateText("Are you sure you want to delete this admin?"))) return;
        showLoader("Deleting...");
        try {
          const res = await apiCall("delete_admin", {
            email: email,
            password: verifiedPassword,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
            loadAdminsData();
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function saveAdminSettings() {
        var newPw = document.getElementById("cfgNewPassword").value.trim();
        if (!newPw) {
          showToast("⚠️ No new password entered", "info");
          return;
        }
        showLoader("Saving...");
        try {
          const currentSet = await apiCall("get_settings");
          if (currentSet && currentSet.success) {
            var s = currentSet.settings;
            const res = await apiCall("save_settings", {
              password: verifiedPassword,
              startTime: s.startTime,
              endTime: s.endTime,
              acceptedDelay: s.acceptedDelay,
              newPassword: newPw,
              allowedDays: s.allowedDays,
            });
            hideLoader();
            if (res && res.success) {
              showToast("✅ Password changed successfully", "success");
              verifiedPassword = newPw;
              document.getElementById("cfgNewPassword").value = "";
            } else {
              showToast(res.message || "Failed", "error");
            }
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      async function unlockScheduleSettings() {
        var pw = document.getElementById("scheduleGatePassword").value.trim();
        if (!pw) {
          showToast("Please enter password", "error");
          return;
        }
        showLoader("Verifying...");
        try {
          const res = await apiCall("verify_settings_password", {
            password: pw,
          });
          hideLoader();
          if (res && res.valid) {
            verifiedPassword = pw;
            document.getElementById("scheduleSettingsLock").style.display =
              "none";
            document.getElementById("scheduleSettingsForm").style.display =
              "block";
            loadScheduleSettingsData();
          } else {
            showToast("❌ Incorrect password", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Verification error", "error");
        }
      }

      async function loadScheduleSettingsData() {
        try {
          const res = await apiCall("get_settings");
          if (res && res.success) {
            var s = res.settings;
            document.getElementById("cfgStartTime").value = s.startTime;
            document.getElementById("cfgEndTime").value = s.endTime;
            document.getElementById("cfgAcceptedDelay").value = s.acceptedDelay;
            var days = s.allowedDays || [0, 1, 2, 3, 4, 5, 6];
            for (let d = 0; d <= 6; d++) {
              document.getElementById("day" + d).checked = days.includes(d);
            }
          }
        } catch (e) {}
      }

      async function saveScheduleSettings() {
        var allowedDays = [];
        for (let d = 0; d <= 6; d++) {
          if (document.getElementById("day" + d).checked) allowedDays.push(d);
        }
        showLoader("Saving schedule...");
        try {
          const res = await apiCall("save_settings", {
            password: verifiedPassword,
            startTime: document.getElementById("cfgStartTime").value,
            endTime: document.getElementById("cfgEndTime").value,
            acceptedDelay: document.getElementById("cfgAcceptedDelay").value,
            newPassword: "",
            allowedDays: allowedDays,
          });
          hideLoader();
          if (res && res.success) {
            showToast(res.message, "success");
          } else {
            showToast(res.message || "Failed", "error");
          }
        } catch (e) {
          hideLoader();
          showToast("Error", "error");
        }
      }

      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.error("Service worker registration failed:", error);
          });
        });
      }
