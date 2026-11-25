# Standard Workflows

1. **Repository Investigation:** inspect instructions, source owners, dependencies, tests, and relevant history.
2. **Feature Planning:** record objective, acceptance criteria, affected files, contracts, risks, and test plan.
3. **Safe Implementation:** change only approved files incrementally; preserve APIs and protected QR behavior.
4. **Independent Review:** trace the actual diff and surrounding contracts for security, correctness, PWA, and regressions.
5. **Testing:** run the smallest relevant existing tests first, then broader safe suites; report each result.
6. **UI/UX Improvement:** inspect existing components and identity, preserve behavior, and verify accessibility/responsiveness.
7. **Security Assessment:** threat-model authorization, data exposure, XSS, storage, secrets, and production isolation.
8. **Release Preparation:** prepare a checklist, deployment order, rollback plan, verification steps, and owner approval gates.
