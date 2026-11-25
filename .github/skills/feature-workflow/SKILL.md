---
name: feature-workflow
description: "Plan, implement, test, and independently review a PWA or Google Apps Script feature."
disable-model-invocation: true
---
Implement this feature:

${input:feature:Describe the feature and expected behavior}

Follow the repository's multi-agent workflow.

1. Read global instructions and `AI-Engineering/documentation/project-context.md`.
2. Classify the task as small, medium, or large/high-risk.
3. Inspect only the relevant module and direct dependencies.
4. Small task: implement directly and run focused verification.
5. Medium task: define brief acceptance criteria and risks, implement, test, and review the diff.
6. Large/high-risk task: plan affected files and contracts, implement in batches, test each batch, and request independent review.
7. Delegate Tester or Reviewer only when the test or review scope justifies it. Avoid duplicate investigation.
8. Report files changed, commands executed, results, limitations, remaining risks, and deployment status.

Do not assume the example folder structure exists. Do not allow conflicting edits. Do not use production data for destructive tests. Do not deploy, publish, push, or commit without explicit approval. Distinguish executed tests from static inspection and untested assumptions.
