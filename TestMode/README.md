# Isolated Test Mode

`TestMode/` is a source clone for experiments. The Pages workflow stages its
frontend at the same-origin `/test-mode/` path, but it does not deploy the GAS
backend. The root production app remains the default. Do not copy this backend
into `Backend/Code.js`, use the production GAS project, or deploy from this
checkout without a separately approved release.

## Required isolation before provisioning

Create a dedicated Google account or execution identity and a separate GAS
project whose account has **no access to production spreadsheets, Drive,
Slides, Firebase, or other production resources**. Create a test-only
spreadsheet, Drive folders, Slides templates, OAuth client, and (if needed)
Firebase project. Grant the test GAS project access only to those test
resources. The `PRODUCTION_SPREADSHEET_ID` property below is only a comparison
value: test code must never open it.

## Backend setup

1. Copy `Backend/Code.js`, `Backend/TestModeConfig.gs`, and
   `Backend/appsscript.json` into the dedicated test GAS project.
2. Leave `TestModeConfig.gs` as `const TEST_MODE_ALLOWED_EMAILS = [];` until
   explicitly approving testers. Add only exact tester email strings to this
   server-side list; matching trims whitespace and ignores case.
3. Create a new, empty test spreadsheet with a sheet named `_TEST_MODE` and
   exactly `LAMBAS_TEST_ONLY` in cell `A1`.
4. Configure the following Script Properties in the test project:
   - `TEST_MODE_ENABLED` = `true`
   - `TEST_SPREADSHEET_ID` = the marked test spreadsheet ID
   - `PRODUCTION_SPREADSHEET_ID` = the production spreadsheet ID solely for
     same-ID rejection; never grant this test identity access to it
   - `TEST_GOOGLE_CLIENT_ID` = the separate test OAuth client ID
   - `TEST_QR_SECRET_KEY`, `TEST_INITIAL_SETTINGS_PASSWORD`,
     `TEST_NEW_CARDS_FOLDER_ID`, and `TEST_ACTIVE_CARDS_FOLDER_ID`
   - `TEST_CARD_TEMPLATE_IMAGE_ID` and `TEST_CARD_SLIDES_TEMPLATE_ID`, using
     test-only Drive/Slides resources
   - `TEST_EXPORT_FOLDER_ID` = a test-only Drive folder whose description is
     exactly `LAMBAS_TEST_ONLY`
   - If push is used, configure Firebase only against the separate test
     project and use `TEST_FCM_SERVICE_ACCOUNT_JSON`, never a production
     property name.

   Internal Script Property state is also automatically namespaced with
   `TEST_`. The backend fails closed if Test Mode is not explicitly enabled,
   either spreadsheet ID is missing, the IDs match, the marker is absent, or
   the tester allowlist is empty. All APIs, including `check_auth`, enforce the
   tester allowlist after validating the Google ID token. Spreadsheet access
   uses `getTestSpreadsheet_()`; temporary report exports are moved into the
   marked test export folder and trashed after use. Export responses fail
   explicitly if that cleanup fails and include the temporary resource ID.
   Stale cleanup is available only as a manual operation: from the dedicated
   Test Mode GAS project, select and run `reconcileStaleTestExports` in the
   editor after setup. It requires the existing `TEST_EXPORT_FOLDER_ID` and
   `TEST_MODE_ENABLED=true`, and only trashes Google Sheets files directly in
   that marked folder whose names exactly match generated `TEST_TMP_EXPORT_`
   daily/individual patterns, contain valid date(s), and are at least 24 hours
   old by Drive creation time, with the filename timestamp within five minutes
   of that creation time. No trigger is installed; files that do not match
   every constraint are left untouched.
5. Deploy the GAS project separately as a web app. Use its test OAuth client
   and confirm the deployment executes as the dedicated test identity.

## Pages configuration

The Pages workflow always stages the production `Frontend/` at `/`. It stages
this clone at `/test-mode/`, but only sets production-side entry availability
when all three separate test variables are present:

- `LAMBAS_TEST_API_URL`
- `LAMBAS_TEST_GOOGLE_CLIENT_ID`
- `LAMBAS_TEST_GOOGLE_SHEET_URL`

These are independent of `LAMBAS_API_URL`, `LAMBAS_GOOGLE_CLIENT_ID`, and
`LAMBAS_GOOGLE_SHEET_URL`. The test API URL must be the test GAS `/exec` URL.
Optional push settings use the distinct `LAMBAS_TEST_FIREBASE_*` variables or
secrets. If the required test variables are absent, no entry is available and
the generated test frontend has an empty API configuration. Never populate
test variables with production endpoints or IDs.

## Browser and authorization behavior

The test frontend uses a separate service-worker cache, a distinct IndexedDB
name, and a `lambas_test_mode_` prefix for all local/session storage keys.
Direct navigation does not call application APIs until the test backend has
verified the signed-in ID token and allowlisted its email. Every subsequent
server action remains independently authorized server-side. Offline startup
does not treat a cached profile or data as authorized and clears the test
offline database before showing the sign-in screen. API calls remain
online-only until a fresh server verification succeeds.

The page displays a visible `TEST MODE` badge and a same-origin return link.
The top-bar icon is branding only, not a Test Mode entry control. No auth
tokens are included in navigation URLs or shared with the production app.

This is a code-only scaffold. No Pages or GAS deployment is performed by these
instructions or by the source tests.

## Pending branding and dashboard designs

The current app icon is referenced from `Frontend/Assets/icons/icon-192.png`,
`icon-512.png`, and `icon-maskable-512.png`; the startup mark, top bar,
notification UI, and PWA manifest use those existing files. Replace the
provided files only after the owner supplies approved replacement artwork,
preserving the current filenames and dimensions where possible.

The supplied Test Mode video is `Frontend/Assets/video.mp4` and plays muted,
inline, and on loop behind the sign-in view. A tinted overlay blends it with
the current design, and the full-screen login surface blocks interaction with
app controls beneath it. The video is not precached by the service worker, so
playback requires a network connection; it is hidden when reduced motion is
preferred.

App Settings already provides a responsive one-, two-, or three-column
dashboard layout switcher, and the existing light/dark theme remains separate.
The dashboard root has a `data-design="current"` hook. Final dashboard skins
are pending owner-provided design references; do not add speculative
alternatives. When approved references arrive, extend the design allowlist and
provide a design choice beside the layout switcher, scoping each supplied
design through the existing dashboard root and numbered CSS modules rather
than duplicating the dashboard markup.
