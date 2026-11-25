# Lambas Bible AI Engineering Environment

This directory documents the repository-native engineering system. Copilot also discovers executable instructions through `.github/copilot-instructions.md`, `.github/agents/`, and `.github/skills/`.

## Agent inventory
- Orchestrator: coordinates planning and handoffs.
- Builder: implements approved changes.
- Frontend Engineer: HTML, CSS, JavaScript, and browser behavior.
- UI/UX Designer: visual consistency, accessibility, and interaction design.
- Backend Engineer: Google Apps Script APIs and server logic.
- Database Engineer: Sheets schemas, migrations, integrity, and concurrency.
- Security Engineer: authorization, secrets, XSS, threat modeling, and audits.
- PWA Specialist: service workers, IndexedDB, queues, and offline sync.
- Performance Engineer: rendering, network, GAS, and Core Web Vitals.
- Tester: executes safe tests and integration verification.
- Reviewer: independent read-only correctness and security review.

## Skill inventory
See `skills/` for project-specific reusable skills covering architecture, frontend, UI/UX, GAS, data, APIs, security, PWA, reliability, testing, review, performance, accessibility, Git, QR integration, analytics, and documentation.

## Collaboration
The Orchestrator investigates, defines acceptance criteria, and assigns bounded work. Only one implementation agent edits a file set at a time. Tester and Reviewer remain read-only; Reviewer never substitutes testing. Confirmed findings return to Builder or the responsible implementation agent, followed by retesting and re-review.

## Efficient execution
- Load `documentation/project-context.md`, then only the relevant module and direct dependencies.
- Classify small, medium, and large/high-risk work; do not plan or delegate a trivial task.
- Use capability-tier model routing and automatic routing where available; no model ID is invented by this repository.
- Delegate specialists only for genuine expertise or independent verification.
- Use task handoffs and efficiency reports instead of regenerating repository summaries.

See `documentation/model-routing.md`, `delegation-policy.md`, `context-loading.md`, `verification-policy.md`, `workflow-examples.md`, and the templates directory.

## Protected boundaries
- No production deployment or data modification.
- No test resource reuse across production and Test Mode.
- No changes to QR generation, encryption, decryption, token format, or card compatibility without separate owner authorization.

## Verification
The repository test command is `node --test tests/*.test.js`. CI also syntax-checks frontend scripts, the service worker, and Apps Script code.
