# Progressive Context Loading

1. Load `AGENTS.md` and `.github/copilot-instructions.md`.
2. Load `AI-Engineering/documentation/project-context.md`.
3. Classify task risk and relevant module.
4. Search exact symbols, API names, or test names.
5. Read only relevant line ranges and direct dependencies.
6. Load one specialist skill or agent instruction only if its expertise is needed.
7. Expand only when source evidence requires it.

Avoid automatically loading every skill, agent profile, README section, source module, or test file.
Do not reread unchanged files in the same task context. Use a targeted diff after editing.
Exclude generated files, dependencies, caches, build outputs, and unrelated assets unless they are necessary to correctness or security.
