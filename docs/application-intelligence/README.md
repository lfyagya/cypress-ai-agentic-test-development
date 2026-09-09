# Application Intelligence

This directory starts with templates only. `cypress-intake` creates project and module
contracts from verified sources; the framework generator does not invent them.

1. Copy [`_template/project-context.md`](_template/project-context.md) to `project-context.md`.
2. Copy [`_template/module-context.md`](_template/module-context.md) to `<module>/module-context.md`.
3. Draft and approve requirements in the canonical `evidence/requirements.json` — see
   [`requirement-authoring-guide.md`](requirement-authoring-guide.md) (shape: [`_template/requirement.example.json`](_template/requirement.example.json)).
4. Keep unknowns explicit and requirements in `draft` until approved.

Profile / adapters first: [`../../harness/profiles/configure.prompt.md`](../../harness/profiles/configure.prompt.md).

See [`../START-HERE.md`](../START-HERE.md) for the complete lifecycle.
