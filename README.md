# Lambas Bible

QR attendance Progressive Web App for a church community. The frontend is static HTML, CSS, and JavaScript. Attendance data and card operations are handled by a separately deployed Google Apps Script backend.

**Open the app:** [Lambas Bible on GitHub Pages](https://church-code-hub.github.io/Lambas-Bible/)

## Repository Layout

```text
Backend/Code.js                 Apps Script API and business logic
Frontend/index.html             PWA entry point
Frontend/css/styles.css         Application styles
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

After one successful online load, a previously authenticated user can scan QR cards, search the saved roster by name, and queue new attendees while offline. The roster is downloaded to that device after an authorized online sign-in; offline search uses that saved snapshot and may not include recent roster changes. Name matching ranks exact and word matches first, then supports partial names and one-character typos. Selecting a name queues the same attendance scan used by QR check-in/check-out. Scans are synced in timestamp order when connectivity returns and the same authorized account is available. Events and the roster snapshot are stored in IndexedDB on that device; the backend uses Script Properties for retry protection and prunes records older than seven days during a subsequent sync. A fresh login, card operations, and management actions still require a connection. Offline device clocks are not a tamper-proof time source; the backend rejects events more than seven days old or more than five minutes in the future. Keep devices physically controlled and review synced timestamps.

Multiple online devices can use the app at once. Attendance, roster ID allocation, and administrative writes are serialized by the Apps Script project lock; transient lock contention returns a retryable response, and queued sync retries it automatically. Offline queues are device-local and sync when that device reconnects, so actions created on separate devices cannot be globally ordered until each device reconnects. Use online attendance when the order of check-in/check-out matters across devices.

## Attendance Management

The dashboard's **Current Attendees** view is available for the configured meeting window, from meeting start until one hour after the scheduled end. It refreshes while open, offers regular check-out only during the configured checkout window, and allows any authorized user to cancel an active check-in. Authorized users can record an emergency check-out during the management window by entering a reason; the check-out follows the same attendance update path and its reason is retained in the `Emergency Check-out` audit sheet. Follow-up is available as a tab in Attendance Reports and lists only people with at least one recorded attendance who missed three or more consecutive meeting dates. Language and theme preferences are available in the password-free App Settings view after sign-in.

The saved-actions view groups queued events by action type and shows attendee names from the device's saved roster when available. Review the new-attendee check-in choice, then sync an individual event or the next consecutive group of the same type. To preserve attendance order, an event cannot skip earlier queued events. The progress bar appears only while a user-triggered sync is running; each processed event also produces a timed toast.

The QR decoder is bundled locally for offline camera scanning. Google sign-in and Font Awesome still load externally. Offline sync does not create or use an `Offline Events` spreadsheet tab.

## Open From GitHub

The `Deploy GitHub Pages` workflow publishes the app whenever a commit reaches `main`. In the repository's **Settings > Pages**, set the build and deployment source to **GitHub Actions**. Add these repository variables under **Settings > Secrets and variables > Actions > Variables**:

| Variable                  | Value                             |
| ------------------------- | --------------------------------- |
| `LAMBAS_API_URL`          | Deployed Apps Script `/exec` URL  |
| `LAMBAS_GOOGLE_CLIENT_ID` | Google OAuth web client ID        |
| `LAMBAS_GOOGLE_SHEET_URL` | Spreadsheet URL opened by the app |

After the first successful workflow run, GitHub Pages provides the app URL, normally `https://<owner>.github.io/<repository>/`. Add that exact origin to the OAuth client's Authorized JavaScript origins. These values are embedded in the public browser app at deployment time; they are configuration, not secrets. Never put private credentials or Script Property values in these variables.

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

The bound spreadsheet also requires the expected `Roster`, `Check-in & Check-out`, and `Attendance` sheets. `Settings`, `Admins`, `New`, and `Delays` are created by the backend when needed.

## GitHub Safety

- Do not commit `Frontend/js/config.js`, `.clasp.json`, OAuth credentials, Script Property values, or real attendee data.
- The production Apps Script deployment and Google OAuth client must remain under the project owner's control.
- The repository's existing first commit contains deployment IDs and the old `QR_SECRET_KEY`. Do not publish the existing Git history as-is. Create a clean public history or carefully scrub the old commit, and rotate/migrate the exposed QR key; rotation invalidates existing cards unless they are regenerated or the backend temporarily supports a controlled migration.
- Review Apps Script deployment access and Drive sharing permissions before production use.

GitHub Actions runs the Node.js smoke tests and JavaScript syntax checks for pushes and pull requests. Live Apps Script, Google sign-in, Sheets, and Drive integrations still need verification in a non-production Google project.
