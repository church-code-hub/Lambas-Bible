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
   - `TEST_MODE_PASSWORD` (a unique random password of at least 12
     characters; the client never receives it), `TEST_QR_SECRET_KEY`,
     `TEST_INITIAL_SETTINGS_PASSWORD`,
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

## Test Mode password gate

After Google sign-in and the server-side tester allowlist check, each fresh
app entry asks for the password stored only in the separate GAS project's
`TEST_MODE_PASSWORD` Script Property. Set a unique random value of at least
12 characters through the Apps Script project settings; never put it in
`config.js`, HTML, source control, URL parameters, or a frontend variable.
The backend checks it for every new page session and does not issue or cache a
password credential. Test Mode API requests remain protected by the Google ID
token and backend allowlist; the password does not replace either check.

## WhatsApp Business automation scaffold

The Test Mode UI contains planning controls for unsent QR messages,
checkout-all, and birthday greetings, but all campaign buttons are disabled.
The separate backend only reports non-secret configuration state and has no
message-dispatch implementation or installed time trigger. It cannot send
WhatsApp messages even if configuration properties are present. Do not enable
or schedule automatic sends from this scaffold.

For future isolated integration work, use only a WhatsApp Business test
account and server-side Script Properties in the Test Mode GAS project:
`TEST_WHATSAPP_BUSINESS_ACCOUNT_ID`, `TEST_WHATSAPP_PHONE_NUMBER_ID`,
`TEST_WHATSAPP_ACCESS_TOKEN`, `TEST_WHATSAPP_APPROVED_TEMPLATE_NAMES` (JSON
object mapping `qr_unsent`, `checkout_all`, and `birthday` to exact approved
template names), and `TEST_WHATSAPP_AUTOMATION_ENABLED` (must remain `false`
until a separate approved implementation). Never add tokens to frontend
configuration.

Consent is not inferred from having a phone number. Any future intent
validation requires an active test roster entry with a valid phone number and
a test-only `WhatsApp Consent` sheet with a header row containing `Person ID`
and `Opted In`, plus an explicit `true` value for that person. The server
intent validator also requires the campaign's exact
approved template and an idempotency key, but it deliberately returns
`WHATSAPP_PROVIDER_NOT_IMPLEMENTED` and never enqueues or sends. A real
integration still requires a reviewed consent capture/revocation flow,
idempotent queue storage, template-language/locale handling, safe scheduling,
rate limits, opt-out processing, and provider error handling.

The attendee profile in Test Mode also shows an attendance percentage chart
with folded detailed records. Its exports use the existing server-side XLSX
report path and a local PNG chart export.

## Branding and dashboard customization

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

The dashboard keeps the existing one-, two-, and three-column layouts and
provides a **Customize Dashboard** editor. A signed-in Test Mode account can
reorder its existing action shortcuts using pointer dragging or the move
buttons, show or hide shortcuts, choose compact, standard, or wide tiles, and
toggle visible labels. Saving stores preferences in Test Mode's namespaced
browser storage under the account email; the previous shared layout setting is
migrated when an account has no saved dashboard preferences. Cancel discards
the current edit session, and reset requires confirmation.

## Laptop attendance scanner

Laptop Scan Mode upgrades the existing QR scanner rather than adding a second
scanner. It provides fullscreen controls, camera selection, sound settings,
and resolution preferences (1920×1080 ideal, with 1280×720 and 640×480
fallback options). The scanner processes the full camera frame in Laptop Mode;
Regular Scan Mode retains its smaller QR region. Focus and zoom controls are
shown only when the active camera reports the corresponding capability.

Camera resolution, focus, zoom, and practical QR scanning distance depend on
the connected camera, QR print quality, lighting, and browser support. Zoom is
only applied when the camera exposes a zoom capability; the app does not
promise optical zoom. The scanner suppresses repeat decodes of the same QR
while it remains detectable and rearms after 1.5 seconds without a successful
decode. That absence interval is a heuristic, not proof that the card has
physically left the camera frame; a visible but temporarily unreadable QR may
be accepted again. No physical camera or QR-distance testing has been
performed. Test Mode's service-worker shell includes the bundled QR scanner
library for offline startup.

These are Test Mode frontend experiments only. No production frontend,
backend, or data is used by these controls, and this documentation does not
deploy or publish either application.
