---
name: feature-workflow
description: "Plan, implement, test, and independently review a PWA or Google Apps Script feature."
disable-model-invocation: true
---
Implement this feature:

${input:feature:Describe the feature and expected behavior}

Follow the repository's multi-agent workflow.

1. Inspect the actual project and read its instructions.
2. Confirm the existing frontend and GAS implementation.
3. Delegate bounded, read-only investigations to Tester and Reviewer if subagent delegation is available. Otherwise, perform the investigations sequentially or ask the user to invoke the agents manually.
4. Define acceptance criteria, affected files, integration contracts, risks, and test plan.
5. Delegate implementation to Builder or switch to Builder.
6. Have Tester execute relevant tests and Reviewer inspect the actual diff.
7. Fix confirmed issues, then retest and re-review.
8. Report files changed, commands actually executed, results, limitations, and remaining risks.

Do not assume the example folder structure exists. Do not allow conflicting edits. Do not use production data for destructive tests. Do not deploy, publish, push, or commit without explicit approval. Distinguish executed tests from static inspection and untested assumptions.
