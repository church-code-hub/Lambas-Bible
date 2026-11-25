# Optimized Workflow Examples

## Small task: button label
1. Read project context.
2. Search the exact label and i18n key.
3. Edit the relevant HTML/i18n file.
4. Run the smallest translation or frontend test.
5. Report and stop.

## Medium task: offline queue status bug
1. Search queue state, sync functions, and relevant test names.
2. Read only direct dependencies.
3. Create two or three acceptance criteria.
4. Implement one focused module change.
5. Run the relevant test file.
6. Review the diff only if a state or data-integrity risk exists.

## Large/high-risk task: authorization change
1. Load architecture and direct frontend/GAS/session dependencies.
2. Define affected files, API contracts, failure cases, and test plan.
3. Implement in backend-contract and frontend-guard batches.
4. Run targeted backend tests after each batch.
5. Use one Security Reviewer and Tester for independent verification.
6. Retest corrected scope and document deployment as not performed.
