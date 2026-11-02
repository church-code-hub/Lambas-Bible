# Project Instructions

## Stack
- HTML5, CSS3, Vanilla JavaScript frontend.
- Google Apps Script backend.
- Progressive Web App.
- Do not introduce a framework or dependency unless explicitly requested.

## Repository-first
Inspect the actual project before changing it. Do not assume sample folders, APIs, GAS functions, endpoints, or schemas exist. Preserve existing structure, naming, data models, and communication contracts. If these instructions conflict with verified project behavior, explain the discrepancy and follow the actual implementation.

## General
- Make the smallest safe change.
- Avoid unrelated refactoring and duplicated logic.
- Use semantic HTML, accessible controls, responsive CSS, and modular JavaScript.
- Handle loading, empty, success, and error states.
- Treat user-controlled content as untrusted; avoid unsafe DOM injection.
- Preserve existing behavior unless explicitly asked to change it.

## Google Apps Script
- Validate incoming data and authorize sensitive operations server-side.
- Never expose secrets or credentials in browser-delivered code.
- Preserve existing function signatures and request/response contracts unless a change is planned.
- Handle exceptions consistently.
- Consider quotas, execution limits, concurrency, and data integrity.
- Never use production data for destructive tests.

## Frontend/GAS integration
Identify the actual communication method before changing it, such as `google.script.run` or `fetch`. Handle malformed responses, authorization failures, network errors, and duplicate submissions. Do not report success before a successful response is received.

## PWA
Inspect the existing manifest and service worker before modifying them. Preserve installability and offline behavior. Consider cache versioning, stale assets, update activation, and sensitive-response caching.

## Verification
Use existing test commands first. Separate executed tests from static inspection and unexecuted recommendations. Use a separate GAS test deployment and test data where possible. Never claim unexecuted tests passed.

## Git and deployment
Do not discard unrelated changes. Do not commit, push, publish, deploy, or modify production data without explicit user approval.

## Final response
Report changes, files modified, tests actually executed and results, review findings, and remaining risks.
