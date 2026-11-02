# Lambas Bible

QR attendance Progressive Web App for a church community. The frontend is static HTML, CSS, and JavaScript. Attendance data and card operations are handled by a separately deployed Google Apps Script backend.

**Open the app:** [Lambas Bible on GitHub Pages](https://church-code-hub.github.io/Lambas-Bible/)

## Repository Layout

```text
Backend/Code.js                 Apps Script API and business logic
Frontend/index.html             PWA entry point
Frontend/css/styles.css         Ordered stylesheet entry point
Frontend/css/01-foundation.css  Theme tokens, startup screen, and page background
Frontend/css/02-app-chrome.css  App bar, account menu, preferences, and shared chrome
Frontend/css/03-feedback.css    Toasts, loaders, and search feedback
Frontend/css/04-people-attendance.css Roster and attendee components
Frontend/css/05-dialogs-reports.css Attendance dialogs, reports, and filters
Frontend/css/06-app-layout.css  Full-screen app surface and view transitions
Frontend/css/07-dashboard.css   Dashboard layout, action tiles, and welcome area
Frontend/css/08-scanner-controls.css Shared controls, forms, and QR scanner
Frontend/css/09-sync-progress.css Sync queue progress and related responsive rules
Frontend/js/app-state.js        Shared browser state and configuration
Frontend/js/app-i18n.js         Translations and text mapping
Frontend/js/app-core.js         Theme, API, and appearance helpers
Frontend/js/app-offline.js      Offline database, queue, and synchronization
Frontend/js/app-views.js        Navigation, attendance views, and reports
Frontend/js/app-auth.js         Sign-in and session restoration
Frontend/js/app-scanner-search.js QR scanner and attendee search
Frontend/js/app-cards-admin.js  Card sharing and administrative settings
Frontend/js/config.example.js   Safe template for local frontend configuration
Frontend/manifest.json          PWA metadata
Frontend/sw.js                  Service worker
Frontend/Assets/icons/          App icons
tests/backend-smoke.test.js     Backend rule tests with Apps Script mocks
```

## Local Setup

1. Copy `Frontend/js/config.example.js` to `Frontend/js/config.js` and enter the deployment's Apps Script `/exec` URL, Google OAuth client ID, and spreadsheet URL. `config.js` is ignored by Git.
2. Host the contents of `Frontend/` over HTTPS, or use localhost for development. Camera access, service workers, and PWA installation require a secure context.
3. The frontend JavaScript is loaded as ordered classic scripts so existing inline UI handlers and shared application state continue to work.
4. Add the development and production origins to the OAuth client's Authorized JavaScript origins.
5. Run the checks with `node --test tests/*.test.js`.

The CSS entry point imports the numbered modules in cascade order. Add styles to the module that owns the component or view, and keep view-specific responsive rules beside those styles so the existing override order remains predictable. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the frontend architecture and change workflow.

After one successful online load, a previously authenticated user can scan QR cards, search the saved roster by name, and queue new attendees while offline. Each attendance scan is first committed to the IndexedDB queue with `pending` status and its scan-time timestamp, then sent immediately to the GAS sync endpoint. Existing scan feedback appears after a randomized 1–2 second delay without waiting for the network. If the request cannot complete, the event remains pending for the existing manual queue sync or the public `triggerManualSync()` function; supported browsers also register the `sync-pending-events` Background Sync tag so the service worker can retry after the page is closed. Background sync needs the saved ID token to authorize its GAS request, so that credential is stored in the device's IndexedDB while queued events remain. Keep devices physically controlled and sign out only on trusted devices.

Read actions use IndexedDB stale-while-revalidate: a saved response is returned for the existing view to render immediately, while the network response refreshes the cache and updates that view through its callback. The roster, including each attendee's existing QR token for local name lookup, is downloaded to that device after an authorized online sign-in; offline search uses that saved snapshot and may not include recent roster changes. App Settings shows the saved roster's freshness and provides a manual refresh. A scanned QR token is kept unchanged in the queued event sent to the backend. Name matching ranks exact and word matches first, then supports partial names and one-character typos. Selecting a name queues the same attendance scan used by QR check-in/check-out. The saved-actions view is available offline so queued events can be reviewed or deleted. When online, users can sync an individual event or group in any order; each event retains its original recorded timestamp for attendance processing. Syncing the whole queue defaults to timestamp order. Events and the roster snapshot are stored in IndexedDB on that device; the backend uses Script Properties for retry protection and prunes records older than seven days during a subsequent sync. A fresh login, card operations, and management actions still require a connection. Offline device clocks are not a tamper-proof time source; the backend rejects events more than seven days old or more than five minutes in the future. Review synced timestamps.

Multiple online devices can use the app at once. Attendance, roster ID allocation, and administrative writes are serialized by the Apps Script project lock; transient lock contention returns a retryable response, and queued sync retries it automatically. Offline queues are device-local and sync when that device reconnects, so actions created on separate devices cannot be globally ordered until each device reconnects. Use online attendance when the order of check-in/check-out matters across devices.

Online scans show a locally predicted check-in, check-out, duplicate, or delay result immediately. The prediction uses an attendance snapshot and schedule/time-zone settings preloaded from the backend; the saved scan is still processed by the backend, which remains authoritative if another device changed attendance after the snapshot was loaded. Deploy the updated Apps Script backend together with the frontend for immediate detailed results.

After a first successful sign-in, a one-time setup lets each device choose its language and theme, then continue to or skip the tutorial. These preferences are stored locally for that device. The profile is cached so the app can show the saved account immediately on later visits; Google Identity Services silently attempts to refresh the short-lived API token with account auto-selection. Browser privacy settings, revoked Google access, or an expired/revoked account may still require the user to sign in again before server actions can run. The tutorial can be replayed from App Settings. During it, scrolling and unrelated actions are blocked; previews and sample searches do not write to Sheets, alter attendance, or enter the offline sync queue.

## Attendance Management

The dashboard's **Current Attendees** view is available for the configured meeting window, from meeting start until one hour after the scheduled end, using the spreadsheet timezone. Outside that window, its tile appears dimmed and marked **Closed**; clicking it shows a toast explaining why it cannot open. The view opens only after confirming the meeting window is currently active. It refreshes while open, and each row shows one action: regular check-out during the configured checkout window, or emergency check-out otherwise. Emergency check-out requires a reason. Any authorized user can cancel an active check-in. Cancelling deletes the active row from `Check-in & Check-out`, clears that date's attendance mark, and retains an audit entry. If checking the meeting window temporarily fails, the app preserves the last known state and retries rather than incorrectly closing the view. Emergency check-outs follow the same attendance update path and their reasons are retained in the `Emergency Check-out` audit sheet.

The **People & Cards** section includes roster management and attendee profiles. Selecting a name opens its profile, where the name, phone number, and birthday month/day can be edited. Renaming creates a replacement card before updating the roster link and removing the previous Drive card. The roster uses columns A-D for ID, name, birthday, and Drive link, with phone and active status in E-F. Its first schema migration creates a `Roster Backup` sheet. The offline roster refreshes after edits and periodically while the app is open. The Birthdays view lists the next birthdays. Attendance Reports has Attendance and Trends tabs; Trends shows recent attendance counts and percentages. Follow-up has its own view and lists people with at least three consecutive missed meetings.

The edge-to-edge dashboard presents every action together and offers one-, two-, and three-column layouts; the selected layout is saved on the device. The top-bar account menu contains settings, notifications, logout, and pending-sync actions. Notifications are stored locally; browser/system notifications require the user's permission. Birthday and app-open notifications are generated while the app is active. Attendance-open push messages are sent by the Apps Script time trigger to registered devices. Background sync can show system success/failure notifications where Background Sync is supported. Roster deletion asks for confirmation and marks the person inactive, retaining historical attendance and the roster audit record.

The QR scan view offers regular and laptop modes selected in App Settings. Both modes use the same backend check-in flow and show a processing state until the server responds; laptop mode presents the result in the camera area for two seconds before scanning resumes. Scan results play quiet success/failure sounds. Online feedback is confirmed by the backend; local checks do not replace backend validation.

The saved-actions view groups queued events by action type and shows attendee names from the device's saved roster when available. Review the new-attendee check-in choice, then sync an individual event or all queued events of a selected type. Events can be selected regardless of queue position; their stored timestamps are passed unchanged to the backend. Sync progress is animated and failed events remain available for retry or deletion.

Attendance Reports provide one export action for Google Sheets, Excel (`.xlsx`), PDF, and PNG. Absentee-only exports contain names without attendance marks or delay columns. PDF and PNG tables use centered text, wider columns, and visible borders. Follow-up lists people with at least three consecutive missed meeting dates, ordered by missed meetings descending. Marking a follow-up done removes the row from the list; it can return after the person attends again and then misses three more meetings.

Birthdays show the current Sunday-to-Saturday week by default; a date range replaces that view until reset. Card sharing sends the actual PNG image through the browser's file-share sheet, where the sender chooses WhatsApp and the recipient. If file sharing is unsupported, the PNG is downloaded and WhatsApp opens with the recipient number and caption so the image can be attached manually. Egyptian local numbers are normalized to the +20 country code. The roster's Active status is an archive control: deactivating a person removes them from active lists while retaining attendance history.

Attendance matrix cells use `++` for on-time attendance and `+` for delayed attendance; delay minutes are not appended to the matrix mark. A generated daily attendance sheet can include attendees, absentees, or both (both by default). It uses `++` with a green fill for on-time attendance, `+` with the delay in the next column for delayed attendance, and leaves absentees blank. Delay details are retained in `Delay Details` and aggregate totals in `Delays`.

The QR decoder is bundled locally for offline camera scanning. Google sign-in and Font Awesome still load externally. Offline sync does not create or use an `Offline Events` spreadsheet tab.

## Open From GitHub

The `Deploy GitHub Pages` workflow publishes the app whenever a commit reaches `main`. In the repository's **Settings > Pages**, set the build and deployment source to **GitHub Actions**. Add these repository variables under **Settings > Secrets and variables > Actions > Variables**:

| Variable                  | Value                             |
| ------------------------- | --------------------------------- |
| `LAMBAS_API_URL`          | Deployed Apps Script `/exec` URL  |
| `LAMBAS_GOOGLE_CLIENT_ID` | Google OAuth web client ID        |
| `LAMBAS_GOOGLE_SHEET_URL` | Spreadsheet URL opened by the app |
| `LAMBAS_FIREBASE_API_KEY` | Firebase web-app API key (public configuration) |
| `LAMBAS_FIREBASE_AUTH_DOMAIN` | Firebase web-app auth domain |
| `LAMBAS_FIREBASE_PROJECT_ID` | Firebase project ID |
| `LAMBAS_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket (optional) |
| `LAMBAS_FIREBASE_MESSAGING_SENDER_ID` | Firebase sender ID |
| `LAMBAS_FIREBASE_APP_ID` | Firebase web-app ID |
| `LAMBAS_FIREBASE_VAPID_KEY` | Web Push certificate's public VAPID key |

Configure all Firebase values together to enable push; the Pages workflow accepts them as repository/environment Actions variables or secrets (variables are preferred). Leave them all unset to disable push. These values are embedded in the public browser app at deployment time; they are configuration, not secrets. Never put private credentials or Script Property values in these values. The ignored local `Frontend/js/config.js` is not uploaded by GitHub Actions and does not configure the hosted site. After changing Actions values, rerun the Pages deployment workflow.

To enable global push messages, create a Firebase project, enable the Firebase Cloud Messaging API, register a web app, and configure its Web Push certificate. Add the public web-app values and VAPID key above, matching the same Firebase project used by the backend service account. Users must opt in on each device from Notifications. Only the spreadsheet owner can send a global message; it is queued by FCM for up to seven days while a device is offline. Devices without an active push subscription are not recipients.

## Apps Script Setup

Deploy `Backend/Code.js` as a Google Apps Script web app. In the Apps Script project, add these Script Properties before enabling the deployment:

| Property                    | Purpose                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`          | Must match the OAuth client ID in local `Frontend/js/config.js`                                              |
| `QR_SECRET_KEY`             | Private QR obfuscation key; preserve the existing value to keep already-issued QR cards readable             |
| `INITIAL_SETTINGS_PASSWORD` | Strong initial settings password, at least 12 digits; used only when the Settings sheet is first created |
| `ACTIVE_CARDS_FOLDER_ID`    | Drive folder for shared/active cards                                                                         |
| `NEW_CARDS_FOLDER_ID`       | Drive folder for new/unshared cards                                                                          |
| `CARD_TEMPLATE_IMAGE_ID`    | Drive image used as the card background                                                                      |
| `CARD_SLIDES_TEMPLATE_ID`   | Google Slides template used to generate cards                                                                |
| `FCM_SERVICE_ACCOUNT_JSON`  | Private JSON for a Firebase service account permitted to send FCM messages; store only in Script Properties |

The bound spreadsheet also requires the expected `Roster`, `Check-in & Check-out`, and `Attendance` sheets. `Settings`, `Admins`, `New`, `Delays`, and (after a device registers for push) `Push Subscriptions` are created by the backend when needed. Protect the subscription sheet with the same access restrictions as other attendee data. Deploy and authorize the updated Apps Script before enabling push or using new API actions. To send a push message automatically when attendance opens, run `installAttendanceOpenNotificationTrigger` once from the Apps Script editor and authorize the time-driven trigger. It checks every minute and sends at most one attendance-open message per meeting session to registered devices.

## GitHub Safety

- Do not commit `Frontend/js/config.js`, `.clasp.json`, OAuth credentials, Script Property values, or real attendee data.
- The production Apps Script deployment and Google OAuth client must remain under the project owner's control.
- The repository's existing first commit contains deployment IDs and the old `QR_SECRET_KEY`. Do not publish the existing Git history as-is. Create a clean public history or carefully scrub the old commit, and rotate/migrate the exposed QR key; rotation invalidates existing cards unless they are regenerated or the backend temporarily supports a controlled migration.
- Review Apps Script deployment access and Drive sharing permissions before production use.

GitHub Actions runs the Node.js smoke tests and JavaScript syntax checks for pushes and pull requests. Live Apps Script, Google sign-in, Sheets, and Drive integrations still need verification in a non-production Google project.
