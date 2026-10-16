# Cypress Automation Boilerplate

A Cypress AI harness using:

```text
Verified context → Approved requirement → Config → Commands → Tests → Gate → Run → Metrics
```

This repository is the **reference instantiation** of the Cypress adapter: harness policy plus a
small Automation Exercise `products` module with two active requirements and smoke tests
(`AE-PRODUCTS-001`, `AE-PRODUCTS-002`). Forks start from that pattern; agents must still derive new
automation from verified sources rather than inventing application facts.

## Start

Requires **Node.js 22+**.

```bash
npm ci
npm run harness:check
npm run harness:test
npm run check:rules
npm run lint
npm test
npm run evidence:build
```

A healthy clone runs the two products smoke specs and builds evidence with requirement coverage.
Empty-harness bootstrap (zero requirements / zero tests) remains a valid state for a brand-new
profile — see [docs/START-HERE.md](docs/START-HERE.md).

## Architecture

| Layer | Location | Responsibility |
| --- | --- | --- |
| Harness | `harness.config.json`, `harness/**` | Roles, policy, permissions, quality contract |
| Application intelligence | `docs/application-intelligence/**` | Verified project and module behavior |
| Requirements | `evidence/requirements.json` | Canonical approved scenario registry |
| Config | `cypress/configs/**` | Selectors, routes, and API contracts |
| Commands | `cypress/support/commands/**` | Reusable behavior and assertions |
| Tests | `cypress/tests/**` | Thin orchestration |
| Evidence | `evidence/**` | Normalized runs, coverage, and metrics |

## Agent lifecycle

Four agents, invoked by condition — not a fixed pipeline. Shipping the PR and maintaining the harness
are the parent workflow's job, not separate agents. Invoke at most one specialist per task.

| Role | Agent | Purpose |
| --- | --- | --- |
| INTAKE | `cypress-intake` | Derive verified context and requirements, and capture observed selectors/routes into config |
| BUILD | `cypress-generator` | Implement one active requirement |
| EVALUATE | `pre-merge-qa-gate` | Independently grade and approve/block (read-only) |
| DIAGNOSE | `cypress-debugger` | Trace a reproducible failure to root cause |

## Cross-tool glance

One harness policy projects to four tools. Full diagrams live in
[cross-tool-configuration.md](docs/architecture/cross-tool-configuration.md).

| Tool | Projection | Write-time gate |
| --- | --- | --- |
| Claude | `.claude/**`, `CLAUDE.md` | `PreToolUse` refuses Edit/Write |
| Copilot | `.github/**`, instructions | `PreToolUse` denies (exit 2) |
| Cursor | `.cursor/**` | `preToolUse` denies Write/StrReplace |
| Codex | `AGENTS.md` | none — floor only |

Shared skills land under `.claude/skills` and `.agents/skills`. Universal floor for every tool and
human: `npm run verify` → pre-push → CI (when Actions is available).

Edit neutral sources (`harness.config.json`, `harness/**`, `.claude/hooks/**`), then:

```bash
npm run harness:sync
npm run harness:check
```

## Rules

<!-- HARNESS:RULES:START -->
<!-- Generated from harness.config.json — run `npm run harness:sync`. Do not edit by hand. -->

```text
NEVER  →  cy.wait(<number>)                                                        cy.apiWait('@alias') or a state-based assertion
NEVER  →  a selector literal in a spec or command                                  constants from cypress/configs/ui/**
NEVER  →  a URL literal in cy.visit()                                              constants from cypress/configs/app/routes.js
NEVER  →  *.actions.js files or page-object wrappers                               custom cy.* commands — command-first only
NEVER  →  an auth-required spec without an auth call                               cy.ensureAuthenticated() in beforeEach(), or the module's own auth command plus the // @no-ensureAuthenticated pragma
NEVER  →  a password, secret, API key or token assigned a literal string           cy.env([...]) reading cypress.env.json (gitignored) or a CI secret
NEVER  →  POST/PUT/PATCH/DELETE in a smoke spec                                    read-only assertions; put mutations in the e2e tier
NEVER  →  a SQL literal in a spec or command                                       a frozen entry from cypress/configs/db/** passed to cy.dbQuery()
NEVER  →  it.only()/describe.only(), or a skip without a recorded quarantine       run focused tests only from the CLI; put // @quarantine ISSUE-123: reason directly above a deliberate skip
NEVER  →  skip semantic locators without a reason                                  cy.findByRole(), cy.findByLabelText(), cy.findByText(), then cy.getByTestId()
NEVER  →  use .eq(), .first() or .last() where a filter can identify the element   .filter(), .contains(), or .within() to disambiguate by content or ancestor
NEVER  →  a new config, command or spec without searching first                    grep the literal selector/endpoint/route across configs and commands — search by value, not filename
NEVER  →  a spec with no requirement tag, or more than one                         exactly one known requirement id in the title and as a tag, plus Type, Priority, and tier tags
```

| Rule | Why it exists | Enforcement |
|---|---|---|
| `no-hard-wait` | A fixed wait masks the real timing bug and fails on slower CI machines. | Hook + CI |
| `no-hardcoded-selector` | One app change should mean one config edit, not a hunt through 50 specs. | Hook + CI |
| `no-hardcoded-route` | Routes change; a central registry keeps every caller correct. | Hook + CI |
| `no-page-object` | Commands are the page methods; a second abstraction layer duplicates ownership. | Hook + CI |
| `require-auth-command` | Session setup belongs in one place, not repeated per test. | Hook + CI |
| `no-credential-literal` | Trust boundary. A committed credential is a breach, not a style issue. | Hook + CI |
| `smoke-read-only` | Smoke runs against shared and production-like environments. | Hook + CI |
| `no-sql-literal` | A query is the datastore contract. One schema change should mean one config edit, not a grep across specs. | Hook + CI |
| `focused-or-quarantined-test` | A focused test can hide suite failures, while an unrecorded skip hides risk with no owner. | Hook + CI |
| `locator-priority` | Semantic locators are more stable and accessible. | QA gate |
| `narrow-before-index` | Index-based locators silently target the wrong element when the UI changes. | QA gate |
| `search-before-create` | A filename check that finds nothing is not a value check that finds nothing. Duplicate owners are the most common review failure. | QA gate |
| `one-requirement-tag` | The title survives every reporter and the tag supports filtering; together they make coverage computable. | Hook + CI |

## GSD workflow — required for every task

Work state lives in `.planning/` (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, phases). Keep one bounded outcome per phase, and keep that phase's stage documents under `.planning/phases/<phase>/`.

Run the delivery pipeline in order, one stage at a time: **PRD -> TEST PLAN -> TEST CASES -> IMPLEMENTATION -> EXECUTION -> DEBUGGING -> EVIDENCE -> VALIDATION -> RELEASE**. Scale each stage to the task — a small change gets a short section — but never skip a stage or a gate.

1. **PRD** (`.planning/phases/<phase>/PRD.md`) — Collect the product requirements from every declared source and reconcile them into one PRD. Record conflicts and gaps between sources instead of resolving them silently. Sources: tickets, confluence, figma, documentation, api. **Gate:** stop for human approval, recorded with `approve --artifact prd`, before the next stage.
2. **Test plan** (`.planning/phases/<phase>/TEST-PLAN.md`) — From the approved PRD, plan the testing in sections by format. For each section say what it covers, which lane owns it, what is out of scope, and the environment and data it needs. Plan sections: backend, frontend, functional, integration, regression, smoke. **Gate:** stop for human approval, recorded with `approve --artifact plan`, before the next stage.
3. **Test cases** (`.planning/phases/<phase>/TEST-CASES.md`) — From the approved plan, write detailed cases that cover each flow end to end. Read the specs and the code, and check existing automation first: mark every case new, extended, or already covered, and never duplicate coverage. Inputs: specs, codebase, existing automation coverage. **Gate:** stop for human approval, recorded with `approve --artifact test-cases`, before the next stage.
4. **Implementation** — Implement only approved cases, following the framework's architecture and rules. Reuse existing commands, helpers, and fixtures before adding new ones. Standards: framework standard, well structured, reusable, maintainable, readable.
5. **Execution** — Run the focused tests first, then the impacted regression checks, using the project's own commands.
6. **Debugging** — Diagnose each failure from its evidence and fix the root cause, not the symptom.
7. **Evidence** — Record the runs as evidence and link every case to its requirement. Without recorded evidence the work is not complete.
8. **Validation** — Reconcile the results against the approved PRD, plan, and cases, and list every gap. An independent reviewer judges this stage, not the author. **Gate:** stop for human approval, recorded with `approve --artifact verification`, before the next stage.
9. **Release** — Prepare release material only. A human decides, performs, or authorises the release: an agent never publishes, merges, or deploys.

Never infer approval from an agent response or from green tests. Changing an approved upstream document (PRD, plan, or cases) invalidates the downstream work and its approvals; re-check it.

Classify each task before planning. Apply every obligation for mixed tasks; if the classification changes scope or risk, stop and clarify rather than dropping a workflow:

- **feature:** acceptance criteria; source context; dependency-aware plan; focused tests; regression impact; verification evidence.
- **defect:** reproduction evidence; source context; regression test; root-cause fix; verification evidence.
- **refactor:** behavior baseline; bounded scope; dependency-aware plan; regression tests; verification evidence.
- **test:** requirement mapping; scenario and test plan; test implementation; focused execution; coverage evidence.
- **docs-config:** scope and owner; source-of-truth mapping; schema or link validation; verification evidence.
- **research:** bounded question; source-backed context; findings and uncertainty; no implementation without a follow-up plan.

Repair a repeated failure at most 2 times without new evidence, then stop and report the blocker. Completion requires recorded verification evidence. Never auto-publish, merge, or perform external side effects.

## PRD sources for this project

- none declared

Collect the PRD from these. Not declared: tickets, confluence, figma, documentation, api — ask the owner whether they exist rather than guessing where they are.

<!-- HARNESS:RULES:END -->

## Execution and evidence

```bash
npm run cy:run:smoke
npm run cy:run:e2e
npm run evidence:build
```

Cypress produces HTML plus machine-readable JSON (`video: false` by default; screenshots on
failure). The evidence script produces a runner-neutral summary, requirement coverage, and five
outcome metrics. Missing upstream evidence is reported as unavailable, never as a misleading zero.

Cypress Cloud is optional and activates only when both Cloud credentials are supplied.

## CI note

Automatic `pull_request` / `push` triggers are temporarily disabled while the GitHub account is
billing-locked. Manual `workflow_dispatch` remains available. Restore the commented triggers in
`.github/workflows/*.yml` when billing is fixed — see [docs/guides/ci-cd-guide.md](docs/guides/ci-cd-guide.md).
