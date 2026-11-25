# Lambas Bible Project Context

## Architecture
- Static PWA: `Frontend/index.html`, numbered CSS modules, classic JavaScript in dependency order.
- Backend: `Backend/Code.js` deployed as Google Apps Script.
- Test clone: `TestMode/Frontend/` and `TestMode/Backend/`; staged separately and never copied into production.
- PWA shell: `Frontend/manifest.json`, `Frontend/sw.js`, and `Frontend/Assets/`.

## Entry points and boundaries
- HTML loads classic scripts and CSS from `Frontend/index.html`; add offline assets to the service worker shell.
- Shared browser state/configuration starts in `Frontend/js/app-state.js`.
- Feature modules own auth, attendance views, offline sync, scanner/search, cards/admin, and i18n.
- GAS API and sheet business rules live in `Backend/Code.js`.
- CSS ownership follows `Frontend/css/01-foundation.css` through `09-sync-progress.css`.

## Communication and storage
- Frontend calls GAS through the existing fetch/API method; preserve request and response contracts.
- IndexedDB stores offline events, roster snapshots, API cache, metadata, and sync credentials.
- Google Sheets stores persistent application data. GAS uses Script Properties for sessions and sensitive configuration.
- Test Mode uses separate endpoints, caches, IndexedDB, browser-key prefixes, sheets, Drive resources, and credentials.

## Conventions
- Small targeted changes; no framework or package dependency.
- Semantic HTML, accessible controls, text-safe DOM APIs, RTL/LTR support, and existing CSS tokens.
- Preserve offline behavior and service-worker cache versions when offline assets change.
- Never expose secrets in frontend files or browser-delivered configuration.

## Protected components
- QR generation, encryption/decryption, token formats and identifiers, card encoding, and secret-key handling cannot change without a separate authorized project.
- Production deployment, production Sheets/Drive/OAuth/Firebase, and production credentials require explicit approval.
- Test Mode is isolated and must never use production data or resources.

## Verification
- Full safe suite: `node --test tests/*.test.js`
- Frontend scripts: `node --check Frontend/js/app-*.js`
- Service worker: `node --check Frontend/sw.js`
- Backend: `node --check Backend/Code.js`
- Run the smallest relevant test for small changes; add cross-module and full-suite checks for justified risk.
