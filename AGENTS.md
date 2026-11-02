# Repository Agent Instructions

These instructions apply to GitHub Copilot coding agent and other agents that read `AGENTS.md`.

## Project
- Frontend: HTML, CSS, Vanilla JavaScript.
- Backend: Google Apps Script (GAS).
- Application: Progressive Web App (PWA).

## Repository-first rule
Inspect the actual repository before making changes. Do not assume sample folders, files, APIs, functions, or schemas exist. Preserve the established structure, naming, data model, and frontend/GAS contracts.

## Development
- Make small, targeted changes.
- Avoid unrelated refactoring and unnecessary dependencies.
- Preserve existing behavior unless the user requests a change.
- Use semantic HTML, accessible controls, responsive CSS, and modular JavaScript.
- Avoid unsafe DOM injection; treat user-controlled content as untrusted.

## GAS security and reliability
- Validate all client-supplied data on the server.
- Authorize sensitive operations server-side.
- Never expose secrets in frontend code.
- Handle exceptions consistently.
- Consider Apps Script quotas, execution limits, concurrency, and data integrity.
- Do not use production data for destructive tests.

## PWA
Inspect the existing manifest and service worker before changing them. Preserve installability and offline behavior. Consider cache invalidation and do not cache sensitive responses without a deliberate security review.

## Testing
Discover existing test commands and execute relevant safe tests. Distinguish executed tests from static inspection and tests not run. Use a separate test deployment and test data for GAS integration where possible. Never claim an unexecuted test passed.

## Safety
Do not discard unrelated user changes. Do not commit, push, publish, deploy, or modify production data without explicit user approval.

## Final report
Summarize changes, files changed, tests actually run and results, review findings, and remaining risks.
