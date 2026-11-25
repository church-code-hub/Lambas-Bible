# Delegation Policy

## Defaults
- Ordinary self-contained task: one implementation agent or direct execution.
- Specialist input needed: one specialist, with a bounded question or bounded review scope.
- Independent testing or review: invoke only when risk justifies it.
- Parallel delegation: only when work is independent and file sets do not overlap.
- Tiny tasks: no delegation.

## Agent selection
- Frontend: Frontend Engineer or UI/UX Designer.
- GAS: Backend Engineer.
- Sheets/migrations: Database Engineer.
- Security/auth/integrity: Security Engineer plus one focused Reviewer.
- Offline/PWA: PWA Specialist.
- Performance: Performance Engineer.
- Tests: Tester.
- Mixed implementation: Orchestrator plans, then one implementation agent edits.

## Cost controls
- Send exact file paths, symbols, acceptance criteria, and stop conditions.
- Do not ask multiple agents to read the same source.
- Do not use a Reviewer for a trivial CSS/text/config edit.
- Do not continuously poll background agents; continue independent work or wait for a result notification.
- Consolidate findings once; make one corrected implementation pass, then retest/re-review the corrected scope.
