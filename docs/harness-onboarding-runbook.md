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

- A checkout of the boilerplate matching the project's framework — `lf-playwright-boilerplate` or
  `cypress-automation-boilerplate`. This is where you run the installer _from_.
- The target repository, checked out, on a branch.
- Node 22.
- Answers to the six questions in **Decide**. These are the only things nobody else can supply.

---

## Step 1 — Decide

Six answers. Everything else is mechanical.

| #   | Question                                                      | Goes in    | Notes                                                                        |
| --- | ------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| 1   | Who is accountable for this suite?                            | `owner`    | **A person, not a team.** A team owning something is how it ends up unowned. |
| 2   | Which framework?                                              | `adapter`  | `playwright` or `cypress`. Must match the boilerplate you install from.      |
| 3   | What is the architecture?                                     | `pattern`  | `helper-first`, `command-first`, `pom`, `bdd-pom`, `data-driven`. See below. |
| 4   | Where does the code live?                                     | `paths`    | Their real directories. All must exist on disk.                              |
| 5   | How do they authenticate, seed data, and get credentials?     | `strategy` | `auth`, `testData`, `credentialSource`                                       |
| 6   | What is their pre-commit/CI entry point, and package manager? | `wiring`   | The harness will not edit `package.json`; this records where their gate is.  |

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

  "adapter": "cypress",
  "language": "javascript",
  "projectName": "their-project-automation",

  "pattern": "pom",

  "paths": {
    "testRoot": "cypress",
    "configRoot": "cypress/configs",
    "commandRoot": "cypress/pages",
    "specGlob": "cypress/tests/**/*.cy.{js,ts}",
    // BDD projects add: "stepRoot": "cypress/support/steps"
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

  "adapters": { "claude": { "enabled": true } },
}
```

Every enumerated value is validated, so a typo fails loudly rather than being ignored. Allowed
values: `packageManager` npm|yarn|pnpm · `auth` cached-session|storage-state|per-test-login|token-injection ·
`testData` fresh|seeded|cached-fixture · `credentialSource` vault|env|ci-secret.

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
node scripts/engine/install-overlay.mjs --target /path/to/their/repo --profile /path/to/profile.json
```

Read the manifest. Then:

```bash
node scripts/engine/install-overlay.mjs --target /path/to/their/repo --profile /path/to/profile.json --apply
```

It never writes their `package.json`, runner config, lint or type-check config, or any test file. It
appends a marker-delimited block to their `CLAUDE.md` and leaves the rest of that file alone.

---

## Step 4 — Compose, sync, lock

In the target repo:

```bash
node harness/profiles/bin/compose-harness-config.mjs --profile harness/profiles/projects/<key>.json --out harness.config.json
node scripts/engine/sync.mjs
node scripts/engine/check-drift.mjs
node scripts/engine/lock-profile.mjs
```

`sync` generates the AI-tool projections and fills the rules block. `check-drift` proves they match
the config. `lock-profile` signs the profile off; until it is locked, the prompt gate blocks work in
that repo and tells the user what to run.

---

## Step 5 — Check conformance

```bash
node scripts/engine/conformance.mjs
```

Seven invariants, each reported `ok`, `ramping`, or `GAP`. This is the conversation with the team,
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
