# Model Routing Policy

## Platform discovery
This workspace exposes an automatic model-routing option and subagent task options, but it does not expose a verified inventory or stable model IDs to repository instructions. Therefore configuration uses capability tiers, not invented model names or IDs.

## Routing tiers
- **Low-cost / fast:** explanations, formatting, documentation, boilerplate, single isolated CSS or HTML edits.
- **Economical coding:** routine JavaScript, focused bugs, one-module changes, and relevant test fixes.
- **Capable coding:** multi-file changes, moderate debugging, frontend/GAS integration, PWA synchronization, and database contracts.
- **Strong reasoning:** security, architecture, difficult debugging, concurrency/data integrity, protected-component risk, and major release decisions.

Use automatic routing for ordinary work when the platform provides it. If routing quality is uncertain, choose the lowest tier that has sufficient codebase context and escalate after one confirmed failure, not merely one difficult sentence.

## Agent recommendations
- Orchestrator: capable coding for coordination; strong reasoning for architecture or risk consolidation.
- Builder: economical coding for ordinary implementation; capable coding for integration or multi-file implementation.
- Frontend Engineer: economical coding.
- UI/UX Designer: low-cost/fast for visual analysis; economical coding when implementing.
- Backend/Database Engineer: capable coding; strong reasoning for authorization, migration, concurrency, or integrity.
- Security Engineer: strong reasoning.
- PWA Specialist: capable coding.
- Tester: economical coding for test execution; capable coding for integration/PWA diagnosis.
- Reviewer: strong reasoning for high-risk review; capable coding for medium-risk review.
- Performance Engineer: capable coding.

These are recommendations. The platform's available model selector or automatic routing remains authoritative; do not force a premium tier for every task.
