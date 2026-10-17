# Lambas Bible

QR attendance Progressive Web App for a church community. The frontend is static HTML, CSS, and JavaScript. Attendance data and card operations are handled by a separately deployed Google Apps Script backend.

**Open the app:** [Lambas Bible on GitHub Pages](https://church-code-hub.github.io/Lambas-Bible/)

## Repository Layout

```text
Backend/code.gs                 Apps Script API and business logic
Frontend/index.html             PWA entry point
Frontend/css/styles.css         Application styles
Frontend/js/app.js              Browser logic
Frontend/js/config.example.js   Safe template for local frontend configuration
Frontend/manifest.json          PWA metadata
Frontend/sw.js                  Service worker
Frontend/Assets/icons/          App icons
tests/backend-smoke.test.js     Backend rule tests with Apps Script mocks
```

## Local Setup

1. Copy `Frontend/js/config.example.js` to `Frontend/js/config.js` and enter the deployment's Apps Script `/exec` URL, Google OAuth client ID, and spreadsheet URL. `config.js` is ignored by Git.
2. Host the contents of `Frontend/` over HTTPS, or use localhost for development. Camera access, service workers, and PWA installation require a secure context.
3. Add the development and production origins to the OAuth client's Authorized JavaScript origins.
4. Run the checks with `node --test tests/*.test.js`.

After one successful online load, a previously authenticated user can scan QR cards and queue new attendees while offline. Events and device timestamps are stored in IndexedDB on that device and sync, in timestamp order, when connectivity returns and the same authorized account is available. A fresh login, name search, card operations, and management actions still require a connection. Offline device clocks are not a tamper-proof time source; the backend rejects events more than seven days old or more than five minutes in the future. Keep devices physically controlled and review synced timestamps.

The QR decoder is bundled locally for offline camera scanning. Google sign-in and Font Awesome still load externally. The sync ledger is stored in an `Offline Events` spreadsheet tab, created automatically on the first sync.

## Open From GitHub

The `Deploy GitHub Pages` workflow publishes the app whenever a commit reaches `main`. In the repository's **Settings > Pages**, set the build and deployment source to **GitHub Actions**. Add these repository variables under **Settings > Secrets and variables > Actions > Variables**:

| Variable                  | Value                             |
| ------------------------- | --------------------------------- |
| `LAMBAS_API_URL`          | Deployed Apps Script `/exec` URL  |
| `LAMBAS_GOOGLE_CLIENT_ID` | Google OAuth web client ID        |
| `LAMBAS_GOOGLE_SHEET_URL` | Spreadsheet URL opened by the app |

After the first successful workflow run, GitHub Pages provides the app URL, normally `https://<owner>.github.io/<repository>/`. Add that exact origin to the OAuth client's Authorized JavaScript origins. These values are embedded in the public browser app at deployment time; they are configuration, not secrets. Never put private credentials or Script Property values in these variables.

## Apps Script Setup

Deploy `Backend/code.gs` as a Google Apps Script web app. In the Apps Script project, add these Script Properties before enabling the deployment:

| Property                    | Purpose                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`          | Must match the OAuth client ID in local `Frontend/js/config.js`                                              |
| `QR_SECRET_KEY`             | Private QR obfuscation key; preserve the existing value to keep already-issued QR cards readable             |
| `INITIAL_SETTINGS_PASSWORD` | Strong initial settings password, at least 12 characters; used only when the Settings sheet is first created |
| `ACTIVE_CARDS_FOLDER_ID`    | Drive folder for shared/active cards                                                                         |
| `NEW_CARDS_FOLDER_ID`       | Drive folder for new/unshared cards                                                                          |
| `CARD_TEMPLATE_IMAGE_ID`    | Drive image used as the card background                                                                      |
| `CARD_SLIDES_TEMPLATE_ID`   | Google Slides template used to generate cards                                                                |

The bound spreadsheet also requires the expected `Roster`, `Check-in & Check-out`, and `Attendance` sheets. `Settings`, `Admins`, `New`, `Delays`, and `Offline Events` are created by the backend when needed.

## GitHub Safety

- Do not commit `Frontend/js/config.js`, `.clasp.json`, OAuth credentials, Script Property values, or real attendee data.
- The production Apps Script deployment and Google OAuth client must remain under the project owner's control.
- The repository's existing first commit contains deployment IDs and the old `QR_SECRET_KEY`. Do not publish the existing Git history as-is. Create a clean public history or carefully scrub the old commit, and rotate/migrate the exposed QR key; rotation invalidates existing cards unless they are regenerated or the backend temporarily supports a controlled migration.
- Review Apps Script deployment access and Drive sharing permissions before production use.

GitHub Actions runs the Node.js smoke tests and JavaScript syntax checks for pushes and pull requests. Live Apps Script, Google sign-in, Sheets, and Drive integrations still need verification in a non-production Google project.
