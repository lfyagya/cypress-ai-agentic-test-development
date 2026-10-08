# Onboarding a project onto the harness

**Status:** written and executed 25 August 2026 · **Implements:** [`harness-conformance-spec.md`](harness-conformance-spec.md) §8

This is the whole procedure. It is meant to be followed by someone who has not read the other
documents and who does not need to: if you have to ask anyone a question that is not in the
**Decide** step below, that is a defect in this file, not in you.

**The rule this protects:** onboarding a project changes a profile, never the engine. If you find
yourself editing anything under `scripts/engine/`, `harness/concerns.mjs`, `harness/patterns.mjs` or
a `.patterns.mjs` file, stop — you have hit a missing dimension in the spec, and it gets added once
for everyone rather than patched for this project. §9 of the spec.

---

## What you need before you start

- A checkout of each boilerplate needed by the project's lanes — `lf-playwright-boilerplate`
  and/or `cypress-automation-boilerplate`. Install each lane from its matching adapter.
- The target repository, checked out, on a branch.
- Node 22.
- The project requirements/context and answers in **Decide**. These are the project facts the
  harness must not invent.

---

## Step 1 — Decide

Record one shared project identity, then define each lane explicitly. Everything else is
mechanical.

| #   | Question                                                   | Goes in                                | Notes                                                                                                  |
| --- | ---------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Who owns this project and what is its stable project name? | `owner`, `projectName`                 | Name a person as owner, not only a team.                                                               |
| 2   | Which governed lanes exist?                                | `lanes[]`                              | Each has a unique ID, kind, adapter, architecture pattern, repo, and safety policy.                    |
| 3   | Where does each lane's code live?                          | shared `paths`, lane `paths` overrides | All resulting paths must be real and scanner-verified.                                                 |
| 4   | How do lanes authenticate, seed data, and get credentials? | shared `strategy`, lane overrides      | Only define a lane override where it differs.                                                          |
| 5   | What package manager and verify command are already used?  | shared `wiring`, lane overrides        | The overlay never edits `package.json`.                                                                |
| 6   | Which AI tools does the project use?                       | `adapters`                             | Enable only tools actually used by the team.                                                           |
| 7   | What requirements and acceptance evidence govern the work? | `.planning/` and `evidence/`           | The GSD pipeline owns the stages and gates; project facts and acceptance criteria remain team-owned.   |
| 8   | Where do the requirements come from?                       | `sources`                              | Tickets, Confluence, Figma, documentation, API: name where each lives; delete the ones you do not use. |

Supported active runner adapters are Cypress and Playwright. Pytest is future work and must not be
declared as an enforced lane yet. Declare one lane per kind of test the project has: `e2e`, `frontend`, `backend`, `functional`,
`integration`, `regression`, `smoke`, `api`, `contract`, `component`, `performance`, `accessibility`,
or `other`. Nothing requires an end-to-end, smoke, or API lane specifically. Smoke and
production-targeting lanes are always read-only.

A lane's `safety` is a declared, validated, drift-checked policy that the generated instructions
restate to agents. It is not a sandbox: only the Tier 0 smoke rule and the QA gate block mechanically,
so scope credentials to match what the lane declares.

**On question 3.** The pattern decides which architecture rules apply. A project whose architecture
_is_ page objects does not get the rule forbidding page objects — not as a favour, but because the
rule describes an architecture they are not using. Every safety and quality rule still applies. Get
this one wrong and the harness will either block legitimate code or fail to scan the files that
matter, so ask the team rather than guessing from the directory names.

---

## Step 2 — Write the profile

One file. Copy this, replace every value, delete nothing.

```jsonc
{
  "key": "their-key",
  "displayName": "Their Project",
  "owner": "A Named Person",
  "repo": "/path/or/url",
  "language": "javascript",
  "projectName": "their-project-automation",

  // Shared defaults; lane values override these field-by-field.
  "paths": {
    "testRoot": "cypress/tests",
    "configRoot": "cypress/configs",
    "commandRoot": "cypress/pages",
    "specGlob": "cypress/tests/**/*.cy.{js,ts}",
  },
  "wiring": {
    "packageManager": "npm",
    "workspacePackage": false,
    "verifyScript": "npm run e2e",
  },
  "strategy": {
    "auth": "cached-session",
    "testData": "fresh",
    "credentialSource": "ci-secret",
  },

  // Where the PRD material lives. Locations only, never credentials; delete what you do not use.
  "sources": {
    "tickets": "Jira project PAY",
    "confluence": "Space PAY-QA",
    "figma": "https://www.figma.com/file/<id>",
    "documentation": "docs/",
    "api": "https://example.test/openapi.json",
  },

  // One lane per kind of test. Each picks its own adapter, pattern, paths, and safety.
  "lanes": [
    {
      "id": "ui-e2e",
      "name": "UI end to end",
      "kind": "e2e",
      "adapter": "cypress",
      "pattern": "pom",
      "safety": {
        "targets": ["dev", "qa"],
        "mutation": "allowlisted",
        "allowedOperations": ["create synthetic test data"],
      },
    },
    {
      "id": "api-integration",
      "name": "Backend integration",
      "kind": "integration",
      "adapter": "playwright",
      "pattern": "helper-first",
      "paths": {
        "testRoot": "playwright/tests",
        "configRoot": "playwright/config",
        "commandRoot": "playwright/helpers",
        "specGlob": "playwright/tests/api/**/*.spec.ts",
      },
      "safety": {
        "targets": ["qa"],
        "mutation": "allowlisted",
        "allowedOperations": ["create and delete synthetic orders"],
      },
    },
    {
      "id": "regression",
      "name": "Regression",
      "kind": "regression",
      "adapter": "cypress",
      "pattern": "pom",
      "paths": { "specGlob": "cypress/tests/regression/**/*.cy.ts" },
      "safety": { "targets": ["qa", "staging"], "mutation": "read-only" },
    },
    {
      "id": "prod-smoke",
      "name": "Production smoke",
      "kind": "smoke",
      "adapter": "playwright",
      "pattern": "helper-first",
      "paths": {
        "testRoot": "playwright/tests",
        "configRoot": "playwright/config",
        "commandRoot": "playwright/helpers",
        "specGlob": "playwright/tests/smoke/**/*.spec.ts",
      },
      "safety": { "targets": ["production"], "mutation": "read-only" },
    },
  ],

  "adapters": { "claude": { "enabled": true } },
}
```

Every enumerated value is validated, so a typo fails loudly rather than being ignored. Allowed
values: `packageManager` npm|yarn|pnpm · `auth` cached-session|storage-state|per-test-login|token-injection ·
`testData` fresh|seeded|cached-fixture · `credentialSource` vault|env|ci-secret. A lane inherits
shared `paths`, `wiring`, and `strategy` field-by-field; its values override only matching keys.
Every lane still resolves to a complete configuration. The selected lane controls the adapter,
architecture, paths, safety declaration, and evidence identity; a stale top-level adapter never
routes a lane.

The engine owns one canonical delivery pipeline — PRD, test plan, test cases, implementation,
execution, debugging, evidence, validation, release — with human approval gates after the PRD, the
plan, the cases, and validation, and it maps feature, defect, refactor, test, docs/config, and
research tasks to the evidence they must produce. Do not duplicate or override this workflow in the
profile. Generated instructions route every enabled AI tool through the same pipeline. The PRD
stage collects from the `sources` you declared; the test plan is organised by format (backend,
frontend, functional, integration, regression, smoke) and each section names the lane that owns it. Each project
keeps GSD's `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and `phases/` under
`.planning/`; `sync` scaffolds them when absent and never overwrites them, and requirement and test
evidence remains linked through the harness evidence registry. Plain markdown is enough — no
separate GSD install is required. Agents that can write get the full pipeline; the read-only QA
gate gets an evidence-review and validation stanza only.

**If their suite is not fully requirement-tagged** — most existing suites are not — add a recorded
downgrade with an end date. An exception with no reason is indistinguishable from a mistake, so both
fields are required:

```jsonc
"ruleOverrides": {
  "TRACE": {
    "severity": "review",
    "reason": "existing suite predates requirement tagging",
    "ratchetBy": "2026-12-01"
  }
}
```

You cannot downgrade a Tier 0 concern, switch anything off, or override an architecture rule — those
attempts are refused with an explanation. Change `pattern` if an architecture rule does not fit.

---

## Step 3 — Install

From the boilerplate checkout, dry run first. It prints every file it would write and refuses if any
of them is already theirs.

```bash
node scripts/engine/install-overlay.mjs --target /path/to/their/repo --profile /path/to/profile.json --lane ui-e2e
```

Read the manifest. Then:

```bash
node scripts/engine/install-overlay.mjs --target /path/to/their/repo --profile /path/to/profile.json --lane ui-e2e --apply
```

It never writes their `package.json`, runner config, lint or type-check config, or any test file. It
appends a marker-delimited block to their `CLAUDE.md` and leaves the rest of that file alone.

---

## Step 4 — Compose, sync, lock

In the target repo:

```bash
node harness/profiles/bin/compose-harness-config.mjs --profile harness/profiles/projects/<key>.json --lane ui-e2e --out harness.config.json
node scripts/engine/sync.mjs
node scripts/engine/check-drift.mjs
node scripts/engine/lock-profile.mjs
```

`--lane` is required the first time. Re-composing or `--verify` afterwards reuses the lane recorded in
`harness.config.json`, so the plain `harness:compose` script keeps working.

`sync` generates the AI-tool projections, fills the rules block, and scaffolds `.planning/` if it is missing. `check-drift` proves they match
the config. `lock-profile` signs the profile off; until it is locked, the prompt gate blocks work in
that repo and tells the user what to run.

---

## Step 5 — Check conformance

```bash
node scripts/engine/conformance.mjs
```

Eight invariants, each reported `ok`, `ramping`, or `GAP`. This is the conversation with the team,
not a build gate — it reports and fixes nothing, because every gap is a decision someone owns.

`ramping` is legitimate: traceability at `review` with a recorded ratchet date. `ramping` with no end
date is a `GAP`, deliberately.

Expect to resolve gaps by changing the profile or by the team changing something real. If resolving
one seems to need an engine edit, re-read the rule at the top of this file.

---

## Step 6 — Wire their pipeline

The harness does not edit `package.json`. Add one script and one CI step, using their own naming:

```json
"harness:check": "node scripts/engine/check-drift.mjs && node .claude/hooks/validate-<framework>-rules.mjs --all"
```

Call it from whatever `wiring.verifyScript` names. That is the whole integration.

---

## Upgrading later

Re-run Step 3 from a current boilerplate checkout. The install record
(`.claude/harness-overlay.json`) tells the installer which files are the overlay's, so those are
replaced and anything else is left alone. The run names both engine versions, so an upgrade is
legible:

```
[install] engine   0.2.0  (upgrading target from 0.1.0)
```

Then re-run Step 4. There is no registry, so nothing notifies a repo that it is behind — upgrades are
pull-based and deliberate.

---

## Findings from the first run of this procedure

This runbook was executed against a synthetic second project on the **Cypress** adapter, chosen
because every previous install had been from Playwright. Two defects surfaced, both now fixed, and
both worth knowing about because they show what this exercise is for:

1. **The overlay manifest was incomplete.** Cypress declares three skills whose sources live under
   `harness/skills/`, which the manifest did not carry, so `sync` failed validating a config that
   referenced files the install had not delivered. Playwright declares no skills, so installing from
   it never exercised that path. One line.

2. **Tier 2 deselection did not reach the scanner.** The composed config correctly omitted the
   page-object rule for a POM project and the generated instructions correctly never mentioned it —
   and the write-time hook blocked their page objects anyway, because the scanner iterated the
   framework's full rule catalogue rather than what the project declared. The scanner now enforces
   only declared rules.

   Worth noting how this was missed: an earlier check appeared to prove the opposite, but the probe
   file happened to sit under `commandRoot`, where an unrelated exclusion skipped the rule. It passed
   for the wrong reason. **Onboarding a second project on a second adapter found in one afternoon
   what reasoning about the first had not.**

Both were engine changes, so the strict claim — _a second project onboarded with no engine change_ —
**did not hold on first attempt.** It holds now, and the next onboarding is the real test of that.
