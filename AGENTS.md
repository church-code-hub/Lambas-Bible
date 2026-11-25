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

## Engineering environment
- Use `.github/agents/` for repository-specific Copilot agent profiles.
- Use `.github/skills/` for reusable project-specific skills.
- Use `.github/workflows/feature-workflow/SKILL.md` for standard implementation handoffs.
- Consult `AI-Engineering/` for architecture, workflows, templates, and task reports.
- Preserve existing agents and instructions unless a change is explicitly approved.

## Mandatory engineering rules
- Investigate existing implementation and dependencies before changing code.
- Define acceptance criteria and a test plan before implementation.
- Prefer focused changes and preserve existing naming, module order, APIs, and UX.
- Never remove functionality without explicit approval.
- Do not claim a test passed unless it was executed.
- Report implementation, testing, review, deployment, and remaining-risk status separately.
- Independently review implementation changes before declaring them complete.
- Never commit, push, publish, or deploy without explicit approval.
- Never modify production Sheets, Drive, OAuth, Apps Script deployments, Firebase, or test credentials during development.
- Production and Test Mode are isolated; never copy Test Mode resources into production or use production records for Test Mode tests.

## Efficiency-first execution
- Start with `AI-Engineering/documentation/project-context.md`; do not load source-wide summaries for focused work.
- Use progressive context: global rules, project context, relevant module, direct dependencies, then specialist context only when needed.
- Search exact symbols and read targeted ranges before opening large files. Avoid unchanged-file rechecks and repetitive repository scans.
- Classify tasks before delegating: small tasks use one agent or direct execution, medium tasks use one implementation agent plus focused verification, and large/high-risk tasks use bounded specialist/review work.
- Do not invoke every agent or every skill. Parallelize only independent work; one implementation agent edits each file set.
- Trivial edits do not require a separate reviewer. Authentication, permissions, data integrity, protected functionality, security, or cross-module releases require focused independent verification.
- Prefer the cheapest model tier likely to succeed once. Escalate only on complexity or confirmed correction needs. Automatic model routing is preferred when available; fixed model IDs must not be invented.
- Report only a task handoff: objective, changed files, unfinished work, tests run, and discovered constraints. Do not repeatedly regenerate repository summaries.
- Measure tool calls, model requests, delegations, files read/modified, correction attempts, test duration, and exposed usage if available. Do not invent credit or token totals.

## Protected QR functionality
QR generation, encryption, decryption, token formats, card encoding, QR identifiers, secret-key handling, and card compatibility are protected legacy functionality. Do not modify or automatically refactor them unless the owner authorizes a separate modernization project. Scanner UI and camera integration changes must preserve existing QR processing and card compatibility.

## Standard task report
Every development task must report:
1. Task objective.
2. Existing implementation.
3. Files inspected.
4. Files modified.
5. Reason for each modification.
6. Dependencies and risks.
7. Tests executed.
8. Test results.
9. Regression assessment.
10. Remaining issues.
11. Suggested next step.
