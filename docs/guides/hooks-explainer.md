# Hooks Explainer — reference

The enforcement model (what blocks a violation, where, and why) lives in
[`../START-HERE.md`](../START-HERE.md) §4. This page is the hook-specific reference: the scripts, the
events they fire on, the rules they scan for, and how to add or exempt one. It does not restate the
model.

## The four hook scripts

All live under `.claude/hooks/` and are shared by every tool that supports write-time hooks.

| Hook file                        | Fires on                                             | Effect                                                                     |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `prompt-duplication-guard.mjs`   | prompt submit                                        | Reminds the agent to search before creating a new config, command, or spec |
| `pre-validate-cypress-rules.mjs` | before Edit/Write                                    | Scans proposed content and **blocks** the write on a violation (exit 2)    |
| `validate-cypress-rules.mjs`     | after Edit/Write; also CI via `--all` / `--base-ref` | Safety-net scan; CI runs the same scanner on the tree                      |
| `session-end-reminder.mjs`       | session stop                                         | If Cypress files changed, prints the pre-merge checklist                   |

The pre-write hook **blocks**; the post-write hook **warns**. The event-to-hook wiring is generated
into each tool's settings by `npm run harness:sync` — never edit it by hand.

## Who runs them

Claude, Copilot, and Cursor run these scripts through their pre-tool hook APIs, so all three refuse a
violating write before it reaches disk. Codex has no hook API. Hooks also do not fire for
hand-written code. In every uncovered case the gate is the universal floor — `npm run verify`,
pre-push, and CI — which runs the same scanner. See [`../START-HERE.md`](../START-HERE.md) §4 and
[`../architecture/cross-tool-configuration.md`](../architecture/cross-tool-configuration.md) for the
per-tool matrix.

## What the scanner detects

Rules are defined once in `.claude/hooks/shared-rules.mjs` and apply to `.cy.*`, `.commands.*`, and
other Cypress files. The authoritative rule list (with severities and rationale) is the generated
block in `CLAUDE.md` / `README.md`; the scanner enforces the `block`-severity subset:

- hard waits — `cy.wait(<number>)`
- hardcoded selectors in specs/commands
- hardcoded routes in `cy.visit()`
- `*.actions.js` / page-object imports
- hardcoded credentials
- write requests in a smoke spec (`smoke-read-only`)
- requirement/Type/Priority/tier tag shape (`one-requirement-tag`)

## Adding a rule

1. Add a `scanForRegex(...)` call in `.claude/hooks/shared-rules.mjs` — it applies to both the
   pre-write block and the post-write warning; you do not edit the hook files.
2. Add the rule's policy entry to `harness/profiles/adapters/cypress.json`, then
   `npm run harness:compose && npm run harness:sync` so its message and docs are generated.

```javascript
scanForRegex(
  violations,
  normalized,
  content,
  /cy\.contains\(['"][^'"]{3,}['"]\)/g,
  "Hardcoded text in cy.contains(). Use a config constant or data attribute instead.",
);
```

## Exempting a legitimate value

Some literals are legitimate (e.g. `cy.get('body')`). Add them to
`.claude/hooks/cypress-hook-allowlist.json` and record the reason in
`cypress-hook-allowlist-governance.md`. Never weaken the rule itself. Framework-internal API-engine
files under `cypress/support/core/api/` are excluded by `TARGET_FILE_RE`.

## Running the scanner without an AI tool

```bash
node .claude/hooks/validate-cypress-rules.mjs --base-ref main
```

Diffs `HEAD` against `origin/main`, reads every changed Cypress file, and exits non-zero on a
violation. `npm run check:rules` runs it across the whole tree. CI setup:
[`ci-cd-guide.md`](ci-cd-guide.md).
