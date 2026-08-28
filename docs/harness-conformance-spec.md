# Harness Conformance Spec

**Status:** P0 draft · 25 August 2026
**Governs:** what a project must satisfy to be running the AI Agentic Test Development harness, and
what it is free to decide for itself.
**Companion:** `harness-rollout-architecture.md`, in the QA analysis workspace — portfolio
analysis and rollout sequencing. That document is analysis payload and is deliberately **not**
vendored: nothing in the engine may depend on it, which is why it is named here rather than linked.
**This document is a contract, and it ships with the engine** — vendored into every consumer, so no
repo depends on a specification outside itself.

---

## 1. Why this exists

Laudio was designated the first real exercise of the Playwright adapter. Adoption failed, and the
five reasons the team gave were:

1. the harness does not use BDD or POM;
2. it has no `package.json` of its own and is not part of the yarn workspace;
3. its runner config (parallelism, workers, retries, timeouts, test ids, setup flow) and folder
   structure differ from the existing suite;
4. it was believed to assume fresh login per test, against Laudio's cached session;
5. it is not wired into the project's type-check or lint scripts.

Item 4 was a misreading — cached auth is the harness's _own_ mandated pattern
(`storage-state-auth` blocks `login()` in `beforeEach`). The other four are real, and they share one
cause: **the boilerplate was the delivery vehicle.** Adopting the governance layer required adopting
a whole repo's architecture with it.

The architecture being imposed was not even framework policy. Laudio is Playwright too. The
imposition was a _design pattern_ — `Config → Helpers → Tests`, page objects rejected — encoded at
engine level as if it were a property of Playwright. **11 of 22 surveyed projects report POM.** A
`no-page-object` block rule at engine level is not a policy; it is a rejection of half the portfolio.

Patching the boilerplate for Laudio would queue the same patch for FVC, then BuildWitt, then
Signetic. This spec removes the need for the patch.

---

## 2. Layers and the dependency rule

```
L0  SPEC        this document — invariants · concern registry · tiers · profile schema
                framework-agnostic · versioned
                    │  implemented by
L1  ENGINE      lf-qa-harness-os — authored ONCE, forked NEVER
                composition · hook runtime · rule scanner · drift check
                agent roster · evidence pipeline · conformance checker
                    │  supplied framework patterns by
L2  ADAPTER     playwright · cypress · pytest              ← rule PATTERNS
                    │  supplied architecture selection by
L3  PATTERN     helper-first · command-first · POM · BDD+POM · data-driven
                    │  parameterised by
L4  PROFILE     projects/<key>.json — topology · strategy · recorded overrides
```

**Dependency rule: each layer may read the layer above it and nothing below.** L1 never contains a
project name. L2 never contains an architecture opinion. L3 never contains a path. L4 is the only
file a project authors.

**Boilerplates are not a layer.** They sit beside this stack as _reference implementations_ — one per
framework — that must pass the conformance suite. A greenfield project forks one. **A project with an
existing suite never touches one.**

---

## 3. The conformance baseline — seven invariants

These are what make a project's setup _the harness_. None names a framework, a design pattern, a
folder, or a package manager. **None of Laudio's five objections touches any of them.**

| #      | Invariant                                                                                                                         | Why                                                                                                                                          | Verified by                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **I1** | **One generated source of policy.** Composed from L2+L3+L4, carries a `GENERATED` marker, never hand-edited, drift-checked in CI. | Two owners of the same policy means the policy has no owner.                                                                                 | `harness:compose --verify` + drift check                         |
| **I2** | **Rules reach the writer and the pipeline.** The same rule set is enforced at write-time and in CI.                               | A rule that only exists in a document is advice, and advice does not survive a deadline.                                                     | write-time hook + CI step, both present                          |
| **I3** | **Declared equals enforced.** A rule declared `block` has a pattern behind it. A declared path is the path actually scanned.      | A rule declared blocking with no pattern is worse than an absent rule — the generated instructions advertise protection that does not exist. | `test-block-rules-enforced` · `test-config-paths-honest`         |
| **I4** | **An independent read-only evaluator.** The gate that grades output cannot write files or run commands.                           | The builder must never grade its own work.                                                                                                   | `pre-merge-qa-gate`: `permissionMode: plan`, Read/Grep/Glob only |
| **I5** | **Trust boundaries are never relaxed.** No credential literals. Smoke suites read-only. No production data.                       | These are breaches, not style.                                                                                                               | Tier 0 rules, non-disableable                                    |
| **I6** | **Traceability.** Every test carries exactly one known requirement id, so coverage is computable.                                 | Three of 22 projects can measure coverage today. Without this the rollout has no evidence.                                                   | `one-requirement-tag`, enforcement ramped (§6.4)                 |
| **I7** | **Evidence ledger.** Every gate verdict is backed by recorded command output.                                                     | A verdict nobody can reproduce is an opinion.                                                                                                | `evidence:record` / `evidence:build`                             |

### 3.1 I2 and advisory-only tools

Only some AI tools can refuse a write. Claude Code hooks can block; Copilot receives the same rules
as advisory text. For a project whose enabled adapters are all advisory, **CI and the pre-push hook
are the real gate**, and the conformance report must say so explicitly rather than implying
write-time enforcement the tool cannot deliver.

---

## 4. The variable surface — four dimensions

Everything below is declared by the project. The engine adapts. None of it is negotiated.

| Dim              | Owns                                                                                                    | Declared in                | Portfolio examples                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| **D1 Framework** | Which rule _patterns_ apply                                                                             | L2 adapter, selected by L4 | Playwright · Cypress · Pytest                              |
| **D2 Pattern**   | Which _architecture_ rules apply                                                                        | L3 pattern, selected by L4 | helper-first · command-first · POM · BDD+POM · data-driven |
| **D3 Topology**  | Paths, folder layout, package manager, workspace membership, lint/type-check chain, CI provider         | L4                         | Laudio: yarn workspace, own `tsconfig`, GitHub Actions     |
| **D4 Strategy**  | Auth strategy, test-data strategy, credential source, parallelism, retries, timeouts, test-id attribute | L4                         | Laudio: cached session, vault credentials                  |

Mapping Laudio's five objections: #1 → **D2**. #2, #3, #5 → **D3**. #4 → **D4**, already satisfied.
Every one of them is data. **None of them is an engine change.**

---

## 5. What the overlay installs, and what it must never install

A project with an existing suite adopts by _overlay_. The engine writes only its own artifacts.

**Installs** — all root-relative, all `GENERATED`-marked:

- `.claude/agents/**`, `.claude/settings.json`, `.claude/hooks/**`
- `.github/agents/**`, `.github/copilot-instructions.md`, `.github/hooks/harness.json`
- `harness.config.json` and the L4 profile
- a rules block injected into the project's existing `CLAUDE.md` between markers
- one script entry (`harness:check`) and one CI step

**Never installs:** a runner config · a folder tree · a `package.json` · an eslint, prettier or
tsconfig · a fixture, helper, page object or spec · anything that decides D3 or D4.

The hook loader is already portable — generated hook commands resolve
`CURSOR_PROJECT_DIR → CLAUDE_PROJECT_DIR → cwd()` at runtime, so `.claude/` functions in any repo
root with no path rewriting. **The AI layer needs no work to become portable. Only the rule patterns
and the script wiring are repo-shaped.**

### 5.1 Install safety

Dry-run by default. Print a file manifest before writing. Refuse to overwrite any file that does not
carry a `GENERATED` marker. Injection into a project-owned file happens only between markers, never
by rewriting the file.

---

## 6. The rule model

### 6.1 Concerns are stable; patterns are per-adapter

A rule has a **concern id** that is identical across every framework, and a **pattern** that differs.
Today's adapters violate this: Playwright names cached auth `storage-state-auth`, Cypress names it
`require-auth-command`. Same concern, two ids. For a project that migrates framework — **Laudio
migrated Cypress → Playwright** — that means which rules applied changed silently.

| Concern                                        | Tier   | Playwright rule                         | Cypress rule                  |
| ---------------------------------------------- | ------ | --------------------------------------- | ----------------------------- |
| `CRED` no credential literals                  | 0      | `no-credential-literal`                 | `no-credential-literal`       |
| `SMOKE-RO` smoke suites read-only              | 0      | `smoke-read-only`                       | `smoke-read-only`             |
| `WAIT` no fixed-delay waits                    | 1      | `no-hard-wait`                          | `no-hard-wait`                |
| `SELECTOR` no selector literals                | 1      | `no-hardcoded-selector`                 | `no-hardcoded-selector`       |
| `ROUTE` no route literals                      | 1      | `no-hardcoded-route`                    | `no-hardcoded-route`          |
| `SEARCH-FIRST` search before creating an asset | 1      | `search-before-create`                  | `search-before-create`        |
| `TRACE` one requirement id per test            | 1 ramp | `one-requirement-tag`                   | `one-requirement-tag`         |
| `FOCUSED-QUARANTINED` focused/skip governance  | 1      | `focused-or-quarantined-test`           | `focused-or-quarantined-test` |
| `LOCATOR-PRIORITY` semantic locators first     | 1      | `locator-priority`                      | `locator-priority`            |
| `LOCATOR-NARROW` filter before index           | 1      | `narrow-before-index`                   | `narrow-before-index`         |
| `CACHED-AUTH` auth cached, not per-test        | 2      | `storage-state-auth`                    | `require-auth-command`        |
| `ARCH-BOUNDARY` one UI abstraction owner       | 2      | `no-page-object`, `base-fixture-import` | `no-page-object`              |

**Both cells were once `missing` on the Cypress side.** Closed during P1b: the policy was already in that adapter's `qa-automation-foundations.md`, word for word, and its gate already deducted 10 points for a structural locator where a semantic one existed — but neither concern was declared in the rule table. So the generated instruction tables under-reported what the gate would mark down. The inverse of the usual defect: not declared-but-unenforced, but _enforced-but-undeclared_.

### 6.2 Tiers — who may change what

**Tier 0 · Invariant.** `CRED` · `SMOKE-RO`. No project may downgrade or disable these by any
mechanism. The engine must reject a profile that tries.

**Tier 1 · Universal quality.** `WAIT` · `SELECTOR` · `ROUTE` · `SEARCH-FIRST` · `TRACE` ·
`FOCUSED-QUARANTINED` · `LOCATOR-PRIORITY` · `LOCATOR-NARROW`. Default `block`. A project may downgrade to `review` **only
with a recorded reason in its profile**. Never `off`. `review` means the read-only gate still scores
it; the write is not refused.

**Tier 2 · Pattern-bound.** `CACHED-AUTH` · `ARCH-BOUNDARY`. Not negotiated at all — **selected by
D2**. These describe an architecture, so the declared pattern determines whether they apply, exactly
as the declared framework determines whether `waitForTimeout` or `cy.wait` is the pattern to match.

Laudio declares `pattern: bdd-pom` → `ARCH-BOUNDARY` deselects itself and `CACHED-AUTH` binds to
their session cache. Tiers 0 and 1 stay fully armed. **Zero engine changes.** The next project
declaring `data-driven` costs the same: zero.

### 6.3 Overrides are recorded, not silent

Every Tier 1 downgrade carries a `reason` string in the profile. The composed config keeps it, and
the generated instructions state it. An override with no reason fails composition. An unrecorded
exception is indistinguishable from a mistake.

### 6.4 The `TRACE` ratchet

`TRACE` is a spec invariant (I6) enforced at Tier 1 rather than Tier 0, because a project with an
existing untagged suite cannot satisfy it on day one and a blocking rule would simply stop adoption.
The ramp:

- **Onboarding:** `review`. The gate scores untagged tests; writes are not refused.
- **After the project's first clean sprint:** ratchets to `block`.

The invariant survives; only the friction is staged. A project may not stay at `review`
indefinitely — the ratchet date is recorded in the profile.

---

## 7. The L4 profile — what a project authors

The profile is the **only** file a project writes. Today's template is close but incomplete: it
cannot express D2, D3 or a rule override, because composition reads `paths` and `rules` from the
adapter baseline alone. Closing that is P2 work; this is the target contract.

```jsonc
{
  "key": "laudio",
  "displayName": "Laudio",
  "owner": "<a person, not a team>",
  "repo": "<path or URL>",

  // D1 — framework
  "adapter": "playwright",
  "language": "typescript",

  // D2 — pattern. Selects which Tier 2 concerns apply.
  "pattern": "bdd-pom",

  // D3 — topology. Overrides adapter path defaults. Every declared root must exist.
  "paths": {
    "testRoot": "<their root>",
    "configRoot": "<theirs>",
    "commandRoot": "<theirs>",
    "specGlob": "<theirs>",
    "stepRoot": "<BDD step definitions, if pattern is BDD>",
  },
  "wiring": {
    "packageManager": "yarn",
    "workspacePackage": true,
    "verifyScript": "<their existing pre-commit entry point>",
  },

  // D4 — strategy
  "strategy": {
    "auth": "cached-session",
    "testData": "<fresh | seeded | cached-fixture>",
    "credentialSource": "vault",
  },

  // AI tools actually in use. At least one must be enabled.
  "adapters": { "claude": { "enabled": true }, "copilot": { "enabled": true } },

  // Tier 1 downgrades only. Tier 0 is rejected. Tier 2 is not settable — D2 decides it.
  "ruleOverrides": {
    "TRACE": { "severity": "review", "reason": "<why>", "ratchetBy": "<date>" },
  },
}
```

**Composition must reject:** a Tier 0 override · a Tier 2 entry in `ruleOverrides` · a Tier 1
downgrade with no reason · a `severity: off` · a declared path that does not exist on disk · a
profile enabling no AI adapter.

### 7.1 Path derivation and its one risk

Deriving the rule regexes from `paths` introduces a silent-failure mode the current design
deliberately avoided by hardcoding the directory: **a typo in a declared path stops every rule
matching while CI still reports green.** The existing guard inverts rather than disappears. It must
assert both directions:

- a path **inside** the declared root matches the derived scanner, and
- a path **outside** it does not.

A derivation without that two-sided assertion is not conformant.

---

## 8. Adoption procedure

Five steps, no engine edits at any point.

1. **Intake** — answer D1–D4. One conversation with the project's named owner.
2. **Compose** — profile → `harness.config.json`, plus a report: _these rules are ON · these are OFF
   because `pattern=<x>` · these are downgraded for `<recorded reason>` · these two are
   non-negotiable_.
3. **Conformance check** — does the project satisfy I1–I7? **Reports gaps; fixes nothing.** This is
   the entire negotiation surface with a team: seven items, each defensible alone.
4. **Install overlay** — §5, dry-run first.
5. **Wire** — one script entry, one CI step, into the chain the project already runs.

Step 3 is the honest conversation. Everything a team might object to has already been moved into
D1–D4 before this point.

---

## 9. The governing rule

> **A project's nature never changes the engine. It changes its profile.**
>
> If a project's nature **cannot** be expressed in a profile, that is a missing **dimension in this
> spec** — and it is added once, for everyone. **Never as a project-specific branch.**

This is both the escape valve and the discipline. Laudio's arrival should produce exactly one
permanent artifact: the **D2 pattern layer**. Their profile is disposable data. The dimension is the
asset, and it is inherited by the eleven POM projects behind them.

The growth axis is bounded. The survey shows the whole portfolio spans roughly five patterns. Writing
the POM pattern module once serves eleven projects.

---

## 10. Gaps this spec surfaces

Findings, not tasks. Each needs an owner before it is scheduled.

| #   | Gap                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Composition cannot express D2, D3 or rule overrides | `compose-harness-config.mjs` reads `base.paths.*` and `base.rules` only; profiles cannot reach either                                                                                                                                                                                                                                                                              |
| 2   | Rule patterns hardcode the framework directory      | `shared-rules.mjs` — `TARGET_FILE_RE`, the helper-root test and the smoke-root test all contain a literal `playwright/`                                                                                                                                                                                                                                                            |
| 3   | Concern ids diverge across adapters                 | `storage-state-auth` vs `require-auth-command` for one concern; a framework migration silently changes which rules apply                                                                                                                                                                                                                                                           |
| 4   | ~~Cypress adapter is missing two Tier 1 concerns~~  | **CLOSED in P1b.** Both declared at `review` / QA gate, matching Playwright — neither is regex-enforceable, and a regex here produces false positives that teach people to ignore the hook. Cypress idioms named: `cy.findByRole()`/`cy.findByLabelText()`/`cy.findByText()` then `cy.getByTestId()`, and `.filter()`/`.contains()`/`.within()` over `.eq()`/`.first()`/`.last()`. |
| 5   | Engine exists twice                                 | L1 is implemented per-repo by deliberate interim choice; a policy change must be applied by hand in both, with nothing enforcing agreement                                                                                                                                                                                                                                         |
| 6   | No overlay install path exists                      | `sync.mjs` resolves its root to its own directory and writes only there — the harness can be cloned or forked, never added                                                                                                                                                                                                                                                         |
| 7   | Rollout doc asserts a claim this spec contradicts   | It states the harness assumes fresh per-test login; `storage-state-auth` mandates the opposite                                                                                                                                                                                                                                                                                     |

---

## 11. Change control

**Adding a dimension** requires: the case that an existing dimension cannot express it, the default
that preserves every current project's behaviour unchanged, and a conformance test. A dimension added
without a default is a breaking change to every profile.

**Adding a concern** requires a tier, a pattern in **every** adapter, and — if Tier 2 — the set of
patterns that select it. A concern present in one adapter and absent in another is gap 4 repeating.

**Changing a tier** is a spec version bump and needs every affected project's owner informed. Moving
a concern _up_ a tier may invalidate a recorded override.

**Versioning.** This spec is versioned independently of any adapter. The engine records which spec
version it implements; the conformance checker fails on a mismatch it cannot satisfy.
