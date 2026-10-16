# Configure prompt — project profile

> Paste into Claude, Cursor, Copilot, or Codex.
> Writes **one** profile file, then compose + sync. Does **not** hand-edit `harness.config.json`.
> Does **not** generate tests.

Canonical template: [`projects/_template.json`](projects/_template.json)  
How profiles work: [`README.md`](README.md)  
Full lifecycle: [`../../docs/START-HERE.md`](../../docs/START-HERE.md)

---

## Prompt (copy below)

```text
Configure the Cypress harness profile for this project.

Read first:
1. harness/profiles/projects/_template.json — the only file a new project authors
2. harness/profiles/README.md — adapter vs project facts
3. docs/START-HERE.md §2.4 and §6 Step 1 — intake rules
4. harness.config.json — generated; do not invent policy here

Task:
- Interview me in small batches (max 5 questions) for missing facts.
- Prefer my answers over inventing. If I say unknown, leave optional fields out or record unknown in docs later — do not invent URLs, credentials, modules, or requirements.
- Copy _template.json → harness/profiles/projects/<key>.json and fill:
  key, displayName, owner, adapter (cypress), language, projectName, repo, adapters enabled flags for claude/copilot/cursor/codex.
- Omit the overrides block unless this project genuinely differs from adapter defaults.
- Adapters: enable each AI tool the team actually uses. If I am unsure, leave claude and copilot enabled and cursor/codex disabled. Never disable all adapters.
- Be accurate: Claude Code, Copilot, and Cursor can refuse violating writes through generated pre-tool hooks. Codex has no hook API and relies on `npm run verify` plus the pre-push hook; those floor checks also cover human edits and hook misses. See docs/architecture/cross-tool-configuration.md.
- After sync, official Cypress skills live under harness/skills/cypress/* and are projected to .claude/skills and .agents/skills. Refresh with `npm run harness:skills` when upstream changes; do not invent skill content by hand.
- Optional at this step (not required to start): API contracts, CI details — record as unknown for cypress-intake / application-intelligence later.
- Never put passwords, tokens, or PII in the profile.
- Leave `locked` false. A lead runs `npm run harness:lock` after compose/sync/check — work stays blocked until then.
- Do not create specs, commands, selectors, or evidence/requirements.json entries in this step.

Then run (or tell me to run):
  node harness/profiles/bin/compose-harness-config.mjs --profile harness/profiles/projects/<key>.json --out harness.config.json
  npm run harness:sync
  npm run harness:check
  npm run harness:lock

Output when done:
1. Path of the profile written
2. adapters enabled
3. Exact compose/sync/check results
4. Next step = docs/START-HERE.md Step 1 (cypress-intake) — not BUILD

Project hints I already know (optional):
- Project key / display name:
- Owner:
- Repo path or URL:
- Language (javascript | typescript):
- AI tools (any of claude / copilot / cursor / codex):
```

---

## After configure

```bash
npm run harness:compose   # if using the boilerplate profile script, or compose with --profile as above
npm run harness:sync
npm run harness:check
npm run verify            # empty profile: bootstrap; this repo's reference clone runs products smoke
```

`output/` and any profile-report artifacts stay gitignored. There is **no** `build_project_profiles_report` script — this prompt + profile file is the configuration step.

Next: [`../../docs/application-intelligence/requirement-authoring-guide.md`](../../docs/application-intelligence/requirement-authoring-guide.md) after INTAKE, or invoke `cypress-intake` per START-HERE.
