# Lambas Bible Comprehensive Application Audit and Improvement Roadmap

Audit status: planning only. No application source, database, deployment, production resource, or protected QR implementation was modified.

## A. Executive summary

Lambas Bible is a large, established PWA with substantial frontend, GAS, Sheets, offline, reporting, push, and Test Mode coverage. The implementation has mature patterns for session authorization, script locking, idempotent offline synchronization, and isolated Test Mode.

The initial baseline had a stale test/service-worker cache mismatch: 137 of 138 repository tests passed, while `tests/frontend-scripts.test.js:386` expected `lambas-bible-shell-v94` and `Frontend/sw.js:1` defined `lampas-bible-shell-v1`. P1-001 has now corrected the cache spelling and test; the suite passes 138/138. The manifest still has a separate "Lampas/Lambas" naming review if release consistency requires it.

No confirmed exploitability was found in the read-only security review. Potential shared-device PII retention and credential storage risks are worth reducing.

The strongest backlog opportunities are:
1. Restore a green test baseline and correct PWA cache identity/version cleanup.
2. Establish browser/PWA end-to-end coverage for authentication, offline sync, and service-worker updates.
3. Add account-aware logout cleanup for browser PII.
4. Consolidate or automate accessibility checks.
5. Move the existing Test Mode dashboard customization experiment into a production-ready design only if demand and rollout constraints justify it.

## B. Confirmed application architecture

- Frontend: static HTML/CSS/Vanilla JavaScript PWA in `Frontend/`.
- Entry point: `Frontend/index.html`; numbered CSS modules loaded through `Frontend/css/styles.css`.
- JavaScript: classic scripts in dependency order from `app-state.js` through `app-cards-admin.js`.
- Shared state/configuration: `Frontend/js/app-state.js`.
- Offline: IndexedDB in `app-offline.js`, queue synchronization, stale-while-revalidate API cache, and `Frontend/sw.js`.
- Backend: `Backend/Code.js`, using Google Apps Script `doGet`/`doPost`, LockService, PropertiesService, Sheets, Drive, Slides, and Firebase push.
- Identity: Google ID-token verification, hashed 30-day backend bearer sessions, allowlist/owner checks, and sync-only logout sessions.
- Data: Google Sheets; historical records and audit sheets remain separate from active roster state.
- Test Mode: separate frontend/backend, storage namespaces, database/cache names, spreadsheet marker, allowlist, and credentials.
- Deployment: GitHub Pages stages production and `/test-mode/` separately; Pages is not a deployment of GAS.
- Tests: Node 24-compatible Node test runner, 138 source-level tests, static checks, mocked GAS integration, and Test Mode tests.

## C. Existing feature inventory

Verified by source:
- Arabic/English UI, theme and language preferences, one-time tutorial.
- Google sign-in and backend session restoration.
- Dashboard with one/two/three layout choices.
- QR attendance and name search; regular/laptop camera modes.
- Offline roster, queued attendance, manual/automatic sync, background sync, sync progress.
- Roster, profiles, card operations, active/archived state, birthday and follow-up views.
- Attendance window, check-in/check-out, emergency checkout, cancellation, audit records.
- Attendance reports, trends, daily sheets, XLSX/PDF/PNG exports.
- WhatsApp sharing.
- Firebase push registration and owner-only global notification sending.
- App settings, schedule settings, notifications, offline queue review.
- Test Mode password gate and dashboard customization experiment.
- Service worker, manifest, app icons, and installable PWA shell.

## D. Confirmed issues and potential risks

### Confirmed
- **AUD-001:** Cache identity mismatch. Test expects v94, source is v1.
- **AUD-002:** Cache spelling mismatch. `lampas-bible-shell-v1` differs from `lambas-bible-*`; activation cleanup may leave the legacy name.
- **AUD-003:** Product naming inconsistency. `Frontend/manifest.json` uses "Lampas Bible", while the application uses "Lambas Bible".
- **AUD-004:** Large frontend/backend modules reduce localized review efficiency: `app-views.js`, `app-i18n.js`, `app-offline.js`, and `Backend/Code.js` are large.
- **AUD-005:** The test suite has no executed browser automation result in this environment; current evidence is source/static and Node mocks.

### Potential risks
- IndexedDB contains account-associated roster, API cache, events, and sync credentials after logout.
- Browser credentials are persisted locally and require same-origin compromise protection and server revocation.
- A 400-session capacity limit can deny new sessions; operational monitoring/recovery may be needed.
- The service worker only caches same-origin GETs, and cache entries can contain stale public or private API responses if cache ownership is not sufficiently partitioned.
- Classic scripts and browser globals make changes more susceptible to cross-module ordering and name-collision regressions.

## E. Security audit

### Security review summary

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | Frontend/js/app-auth.js; Frontend/js/app-offline.js | 927-969; 198-208 | Shared-device PII may remain in account-specific IndexedDB after logout | 6/10 |
| 2 | 🟡 MEDIUM | Frontend/js/app-state.js; Frontend/js/app-offline.js | 7-17; 343-356 | Session credentials remain in browser storage/IndexedDB until revocation or expiry | 7/10 |

No confirmed XSS, SQL/Sheets injection, authorization bypass, exposed server secret, or Test Mode cross-resource access was found. Confirmed server behavior includes:
- Google ID audience, issuer, email verification, expiry validation.
- Backend session validation and allowlist recheck.
- Sync-only restriction on retained logout sessions.
- Script locking for sensitive writes.
- Separate Test Mode allowlist, marker, spreadsheet, cache, and storage namespaces.

Security assumptions: same-origin compromise, device/browser-profile access, and Firebase/Drive permission misconfiguration cannot be disproved without live credentials or deployment inspection.

## F. Data reliability and backend audit

Strengths:
- Offline event records use unique IDs and script-property status for retry protection.
- Sync rejects mismatched accounts, malformed IDs/timestamps, old/future events.
- Script locking serializes attendance and administrative writes.
- Lock busy responses are retryable.
- Failed events remain available; completed events are not reapplied.
- Roster migration creates a backup and sheet writes retain active/history separation.

Risks:
- A failed property write after a claimed PENDING event can leave server state pending until retry behavior resolves it.
- Retry records are pruned after seven days; browser and server retention windows should be reviewed as a combined lifecycle.
- 20-event batch limits and 400-session limits may need observable quota/operational diagnostics.
- Some read paths are not under an explicit lock; stale reads remain a consistency tradeoff that should be documented.
- Export cleanup and temporary resource failure handling need live Drive tests.

## G. Offline and synchronization audit

Verified workflow:
- IndexedDB stores events, roster, API cache, metadata, and sync credentials.
- The service worker retries background-sync events in timestamp order.
- One immediate sync attempt is paired with later retries.
- Logout refuses to proceed offline and waits for server confirmation online.
- Test Mode startup clears cached reads but preserves queued test attendance.

Recommended verification gaps:
- Browser crash/restart during a pending batch.
- Storage quota exhaustion and IndexedDB transaction abort.
- Account switch while queue and cached roster exist.
- Deletion of queued events while background sync is active.
- Cache update activation while an offline tab is open.
- Long periods beyond server/browser retention.
- Two-device concurrent attendance already has an explicit online-only ordering caveat.

## H. UI/UX audit

The static evidence shows a strong premium glassmorphism foundation, one-column dashboard switcher, RTL-aware layout choices, fullscreen subviews, loading/empty/error states, and user-facing confirmation patterns.

Potential improvements:
- Modularize repeated inline-action patterns and confirm that all icon-only controls have names and visible focus.
- Add stronger empty-state guidance for reports, follow-up, and queue failures.
- Make sync/authorization errors distinguish network reachability, credential rejection, and server busy states consistently.
- Verify touch target size, contrast, and text wrapping on 320–360 px devices and at 200% zoom.
- Replace long monolithic Arabic/English strings in a few views with reusable components or formatting helpers.
- Add visible recovery actions rather than relying on toast-only failures.

No mobile, laptop, keyboard, or screen-reader browser run was available for this audit.

## I. Dashboard customization audit

Production currently supports saved one/two/three layout choice in `Frontend/js/app-views.js` and `07-dashboard.css`.

Test Mode contains a fuller implementation:
- account-specific preferences
- reorder controls
- pointer dragging
- move buttons
- hidden/visible shortcuts
- compact/standard/wide tile sizes
- visible-label toggle
- reset and live preview

Reuse plan:
- Reuse the existing normalized preference model, draft/edit state, pointer drag, move controls, and account-key migration.
- Production needs server-independent/local persistence by account, stable migration, keyboard drag alternatives, and deeper responsive testing.
- Widget resizing and arbitrary widgets are not established and should not be the first implementation.

## J. QR scanner usability audit

Verified scanner behavior:
- Bundled decoder supports offline startup.
- Regular/laptop modes exist.
- Laptop mode uses a larger scan region and faster configured frame rate.
- Repeat scans are suppressed and rearms after no detection.
- Camera fallback proceeds from environment to user-facing mode.
- Processing/result states and scan sounds exist.

Protected QR generation, encryption, identifiers, and card compatibility were not reviewed or modified.

Potential UX/performance work:
- Runtime camera selection and remembered per-device selection.
- Expose optical capability checks for zoom/focus only.
- Improve lighting and camera-position guidance.
- Add retry/reopen camera action after permission or hardware failure.
- Surface a no-readable-code timeout with practical distance/angle guidance.
- Browser/device performance measurement before changing frame rate or scan region.

## K. Performance audit

No runtime measurements were performed; avoid invented metrics.

Evidence-based areas:
- Ten CSS modules are a clear cascade architecture.
- Classic scripts delay some startup but avoid bundler complexity.
- `app-i18n.js` is 1332 lines, `app-views.js` 2497 lines, and `app-offline.js` 1205 lines.
- Backend dispatch is centralized in one 3501-line module.
- Services use stale-while-revalidate where appropriate.
- Scanning has fixed frame rates and large Laptop Mode regions.
- Reports and PDFs/PNGs can be heavy on the browser or Apps Script.

The best first performance improvements are measurement and regressions, not speculative optimization.

## L. Testing audit

Initial baseline: `137 pass`, `1 fail`, `138 total`.

P1-001 verification: `138 pass`, `0 fail`, `138 total`.

Initial failure classification:
- Outdated test expectation and source naming inconsistency.
- `tests/frontend-scripts.test.js:386` expected `lambas-bible-shell-v94`.
- `Frontend/sw.js:1` had `lampas-bible-shell-v1`.
- P1-001 changed the source cache to `lambas-bible-shell-v1` and aligned the test. This resolves the mismatch and matches the existing activation cleanup namespace.

Existing coverage:
- 138 broad source and mocked-GAS tests.
- Strong roster, attendance, session, sync, export, and Test Mode coverage.
- Limited real browser/PWA execution and no evidence of live camera hardware tests.

Missing coverage:
- Browser automation with Playwright or equivalent.
- Real GAS deployment and OAuth integration.
- Shared browser-profile logout/PII cleanup.
- Service-worker update activation and cache migration.
- IndexedDB quota/crash/transaction failure.
- Accessibility automation.
- Live Firebase push and Drive/Slides cleanup.
- Mobile/laptop camera device matrix.

## M. Advanced feature opportunities

Recommend only:
- Personalized dashboard with tested production reuse of the Test Mode editor.
- Attendance engagement and trend scoring based on existing attendance/report data.
- Notification center filtering and delivery-state history.
- Device/session management for the 30-day session model.
- Backup and recovery status with visible exports/audit history.
- Better bulk roster management and conflict indicators.
- Configurable report templates using existing Sheets/PNG/PDF infrastructure.

Defer arbitrary widget marketplace, QR redesign, and WhatsApp provider expansion until existing reliability/security gaps close.

## N. Prioritized implementation backlog

| ID | Title | Problem | Evidence / solution | Files | Risk | Complexity | Priority | Benefit | Acceptance criteria | Tests | Specialists |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-001 | Restore cache/test baseline | Release suite fails and cache names are inconsistent | Define one Lambas cache identity, cleanup both legacy prefixes if needed, align test | `sw.js`, test | Cache stale data | Small | P1 | Reliable installs/updates | One cache policy, all existing assets precached, suite green | Node frontend test + browser update test | PWA, Tester |
| P1-002 | Add account-specific logout cleanup | Shared-device PII and cache may remain | Implemented: clear account-owned roster/API cache only after confirmed revoke, preserve pending sync queue, reset in-memory and in-flight caches, normalize account matching, exclude completed retries, and surface cleanup failures | auth/offline/sw | Data exposure | Medium | P1 (completed) | Safer shared devices | Logout succeeds and only the signed-out account data is cleared | Auth/offline Node + browser storage test | Security, PWA, Tester |
| P1-003 | Add browser PWA smoke suite | Static tests do not prove browser behavior | Automate sign-in shell, navigation, offline startup, queue, service-worker update | tests/workflows | Regression | Medium | P1 | Fewer live-site regressions | Test Mode and production shell execute in Chromium | Browser tests | Tester, PWA |
| P1-004 | Add offline crash/quota tests | Partial sync or storage failures are not browser-verified | Cover abort, quota, crash/restart, partial batch, and account switch | offline/sw/test | Lost attendance | Medium | P1 | Reliable queue recovery | Zero duplicate/lost events in documented scenarios | IndexedDB/browser tests | PWA, Backend |
| P1-005 | Reconcile PWA manifest branding | Public install name says Lampas | Verify approved product name, update manifest and cache naming consistently | manifest/sw | Branding/identity | Small | P1 | Consistent installation | Install UI and metadata use Lambas | Manifest/browser test | Frontend |
| P1-006 | Improve session operational limits | 400-session and quota states need observability | Add bounded metrics/diagnostics and owner-facing capacity response | backend/auth | Availability | Medium | P1 | Predictable login/sync | Capacity and lock states are observable and tested | GAS mocks + isolated integration | Backend, Database |
| P1-007 | Harden logout credential lifecycle | Retained credentials and PII are sensitive | Minimize browser credential lifetime and clear account data safely | auth/offline | Shared-device risk | Medium | P1 | Reduced exposure window | Rejected/expired sessions cannot read private cached reads | Auth/offline tests | Security, PWA |
| P1-008 | Add live GAS contract smoke | Mocked tests cannot prove deployed behavior | Create owner-approved separate deployment test matrix | backend/TestMode | Integration | Medium | P1 | Deployment confidence | Test deployment passes identity/action/lock cases | Isolated GAS deployment | Backend, Tester |
| P1-009 | Improve accessibility baseline | WCAG evidence is incomplete | Add automated checks and manual keyboard/zoom/RTL pass | HTML/CSS/JS | Usability | Medium | P1 | Safer for all users | Key flows pass WCAG-oriented checks | Axe/browser + manual | UI/UX, Accessibility |
| P1-010 | Add real sync conflict scenarios | Cross-device ordering and partial sync need evidence | Test batch interruption and concurrent devices in isolated data | backend/offline | Duplicate/lost attendance | Large | P1 | Stronger attendance reliability | Duplicate and partial scenarios documented/passing | Integration | Backend, PWA |
| P2-001 | Productionize dashboard customization | Test Mode editor exists but production lacks it | Port a reviewed subset of reorder/visibility/size controls | TestMode + production | UX/state | Large | P2 | Personalized dashboard | Account migration, reset, keyboard and responsive use | Unit/browser | UI/UX, Frontend |
| P2-002 | Modularize app-views | One large module causes coordinated change risk | Extract navigation, reports, dashboard, and roster by feature | app-views.js | Regressions | Large | P2 | Faster maintainable changes | Classic-script globals/contracts preserved | Full frontend suite | Architect, Builder |
| P2-003 | Modularize i18n loading | Large i18n data can affect startup | Split or lazy-load by feature where offline-safe | i18n/index | Missing translations | Medium | P2 | Lower startup cost | No missing keys or cache drift | Key completeness test | Frontend |
| P2-004 | Add performance baselines | No runtime measurement exists | Record startup, view render, sync, and report timings | PWA/GAS | Budget | Medium | P2 | Evidence-led optimization | Reproducible baseline and thresholds | Browser/Lighthouse/GAS logs | Performance |
| P2-005 | Improve sync diagnostics | Failures can be hard to diagnose | Add normalized error codes and recoverable action guidance | offline/auth/backend | Slow recovery | Medium | P2 | Faster user support | Every pending state has an actionable message | Sync tests | PWA, Backend |
| P2-006 | Camera usability controls | Camera selection/fallback is limited | Add runtime camera selection, timeout, and re-open guidance | scanner/index | Camera usability | Medium | P2 | Easier scanning | Laptop/mobile camera paths recover visibly | Browser device matrix | QR specialist, Frontend |
| P2-007 | Report/export UX | Exports have several formats and failure states | Consolidate progress/error/retry and filename preview | reports/backend | User confusion | Medium | P2 | Better reporting | Every export state is visible/retryable | Export tests/browser | UI/UX, Backend |
| P2-008 | Attendance analytics views | Existing report data can support more insight | Add engagement trends and configurable periods | reports/backend | Metric misuse | Medium | P2 | Better follow-up decisions | Metrics and formulas documented/tested | Unit/integration | Analytics |
| P2-009 | Device/session management | Users cannot manage retained sessions | Add authorized-device/session inventory and revoke action | auth/backend | Account exposure | Large | P2 | Safer account control | Session revocation and expiry verified | Auth tests | Security, Backend |
| P3-001 | Compact notification center | Notifications are functional but basic | Add filters, read/unread, and retention controls | app views/offline | Noise | Medium | P3 | Better message handling | Notification lifecycle tested | Frontend tests | UI/UX |
| P3-002 | Advanced dashboard widgets | Arbitrary widgets are not established | Research only after baseline customization proves useful | dashboard | Scope | Large | P3 | Optional customization | User feedback/validated need | Prototype tests | UI/UX |

## O. Recommended development roadmap

### Batch 0 — Baseline (P1)
- P1-001 cache/test reconciliation.
- P1-005 manifest branding.
- P1-003 browser smoke suite.
Exit: CI passes and PWA naming/version policy is explicit.

### Batch 1 — High-risk safety (P1)
- P1-002 logout PII cleanup.
- P1-007 credential lifecycle.
- P1-008 live isolated GAS contract smoke.
- P1-006 session quota observability.
Exit: security and auth behavior is verified in Test Mode/isolated deployment.

### Batch 2 — Offline reliability (P1)
- P1-004 crash/quota tests.
- P1-010 conflict scenarios.
- P1-005 only if not already included in Batch 0.
- P2-005 sync diagnostics.
Exit: pending queue behavior is browser and backend verified.

### Batch 3 — Quality and usability (P1/P2)
- P1-009 accessibility baseline.
- P2-002 and P2-003 only after tests exist.
- P2-004 performance baseline.
- P2-007 report UX.
Exit: measurable UX/performance baseline and responsive accessibility pass.

### Batch 4 — Feature expansion (P2/P3)
- P2-001 dashboard customization.
- P2-008 attendance analytics.
- P2-009 device/session management.
- P3 items after usage evidence.
Exit: enhancements have acceptance tests and release rollback plans.

## P. Recommended first implementation task

**P1-001: Restore a deterministic PWA cache and test baseline.**

Scope:
- Correct the cache name to an intentional product name.
- Align `Frontend/sw.js` cleanup with the actual cache namespace and remove stale legacy prefixes.
- Align the failing frontend test with the cache policy instead of a hard-coded asset generation suffix.
- Verify manifest naming consistently.

Non-goals:
- No QR code/card changes.
- No database or authentication changes.
- No production deployment.
- No test-only resource changes.

Acceptance criteria:
- `node --test tests/*.test.js` passes.
- Cache cleanup does not recreate stale cache entries.
- Existing offline assets remain in the precache.
- Test assertions reflect the policy rather than a fragile version.
- Test Mode cache remains separate.

## Q. Recommended agent and skill selection

First task:
- **PWA Specialist** for cache lifecycle and offline shell.
- **Tester** for focused frontend test execution.
- **Builder/Frontend Engineer** only if implementation proceeds.
- **Independent Reviewer** for the actual diff, but only after implementation.
- Skills: `pwa-offline`, `automated-testing`, `independent-code-review`, `advanced-html-css` only if manifest/index assets need styling support.

## R. Test Mode validation strategy

- Use the dedicated test frontend and backend with separate credentials.
- Verify cache names in Test Mode remain `lambas-test-mode-*` and never collide with production.
- Run the 138-test suite and any future browser smoke suite against local/isolated Test Mode only.
- Test browser cache update/activation while the production app shell is open.
- Never copy production sheets, OAuth IDs, QR keys, or Firebase resources into Test Mode.

## S. Production protection strategy

- Do not deploy or modify production resources during implementation.
- Deploy backend changes before frontend changes only when a backend contract actually changes.
- For PWA cache-only changes, preserve offline fallback and installability.
- Roll back by restoring the previous service worker and cache policy; do not clear user IndexedDB or queued attendance blindly.
- Any future QR work requires separate owner authorization and compatibility acceptance testing.
