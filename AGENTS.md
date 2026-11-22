<!-- GENERATED FROM harness.config.json — DO NOT EDIT. Change harness.config.json, then run npm run harness:sync. npm run harness:check fails on drift. -->

# AGENTS.md — cypress-ai-agentic-test-development

Codex reads this file before starting work. Architecture: **Config → Commands → Tests**. The full
framework contract is `CLAUDE.md`; application behavior is
`docs/application-intelligence/<module>/module-context.md`.

## Non-negotiable rules

- **no-hard-wait** (Hook + CI) — never cy.wait(<number>); use cy.apiWait('@alias') or a state-based assertion. A fixed wait masks the real timing bug and fails on slower CI machines.
- **no-hardcoded-selector** (Hook + CI) — never a selector literal in a spec or command; use constants from cypress/configs/ui/**. One app change should mean one config edit, not a hunt through 50 specs.
- **no-hardcoded-route** (Hook + CI) — never a URL literal in cy.visit(); use constants from cypress/configs/app/routes.js. Routes change; a central registry keeps every caller correct.
- **no-page-object** (Hook + CI) — never *.actions.js files or page-object wrappers; use custom cy.* commands — command-first only. Commands are the page methods; a second abstraction layer duplicates ownership.
- **require-auth-command** (Hook + CI) — never an auth-required spec without an auth call; use cy.ensureAuthenticated() in beforeEach(), or the module's own auth command plus the // @no-ensureAuthenticated pragma. Session setup belongs in one place, not repeated per test.
- **no-credential-literal** (Hook + CI) — never a password, secret, API key or token assigned a literal string; use cy.env([...]) reading cypress.env.json (gitignored) or a CI secret. Trust boundary. A committed credential is a breach, not a style issue.
- **smoke-read-only** (Hook + CI) — never POST/PUT/PATCH/DELETE in a smoke spec; use read-only assertions; put mutations in the e2e tier. Smoke runs against shared and production-like environments.
- **no-sql-literal** (Hook + CI) — never a SQL literal in a spec or command; use a frozen entry from cypress/configs/db/** passed to cy.dbQuery(). A query is the datastore contract. One schema change should mean one config edit, not a grep across specs.
- **focused-or-quarantined-test** (Hook + CI) — never it.only()/describe.only(), or a skip without a recorded quarantine; use run focused tests only from the CLI; put // @quarantine ISSUE-123: reason directly above a deliberate skip. A focused test can hide suite failures, while an unrecorded skip hides risk with no owner.
- **locator-priority** (QA gate) — never skip semantic locators without a reason; use cy.findByRole(), cy.findByLabelText(), cy.findByText(), then cy.getByTestId(). Semantic locators are more stable and accessible.
- **narrow-before-index** (QA gate) — never use .eq(), .first() or .last() where a filter can identify the element; use .filter(), .contains(), or .within() to disambiguate by content or ancestor. Index-based locators silently target the wrong element when the UI changes.
- **search-before-create** (QA gate) — never a new config, command or spec without searching first; use grep the literal selector/endpoint/route across configs and commands — search by value, not filename. A filename check that finds nothing is not a value check that finds nothing. Duplicate owners are the most common review failure.
- **one-requirement-tag** (Hook + CI) — never a spec with no requirement tag, or more than one; use exactly one known requirement id in the title and as a tag, plus Type, Priority, and tier tags. The title survives every reporter and the tag supports filtering; together they make coverage computable.

## GSD workflow — required for every task

Work state lives in `.planning/` (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, phases). Keep one bounded outcome per phase, and keep that phase's stage documents under `.planning/phases/<phase>/`.

Run the test-development pipeline in order, one stage at a time: **REQUIREMENTS AND SCOPE -> SCENARIOS -> TEST PLAN -> TEST CASES -> IMPLEMENTATION -> EXECUTION -> DEBUGGING -> EVIDENCE -> VALIDATION -> RELEASE**. Scale each stage to the task — a small change gets a short section — but never skip a stage or a gate.

1. **Requirements and scope** (`.planning/phases/<phase>/PRD.md`) — Collect the product requirements from every declared source and reconcile them into one PRD that fixes the scope. Record conflicts and gaps between sources instead of resolving them silently. Sources: tickets, confluence, figma, documentation, api. **Gate G0:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G0 <artifact>...`; GSD checks it at `discuss:post`.
2. **Scenarios** (`.planning/phases/<phase>/SCENARIOS.md`) — From the approved scope, list the happy, negative, and edge scenarios. Each one cites its acceptance criterion and the source that shows the behavior. **Gate G1:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G1 <artifact>...`; GSD checks it at `plan:pre`.
3. **Test plan** (`.planning/phases/<phase>/TEST-PLAN.md`) — From the approved scenarios, plan the testing in sections by format. For each section say what it covers, which lane owns it, what is out of scope, and the environment and data it needs. Plan sections: backend, frontend, functional, integration, regression, smoke. **Gate G2:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G2 <artifact>...`; GSD checks it at `plan:post`.
4. **Test cases** (`.planning/phases/<phase>/TEST-CASES.md`) — From the approved plan, write detailed cases that cover each flow end to end. Read the specs and the code, and check existing automation first: mark every case new, extended, or already covered, and never duplicate coverage. Inputs: specs, codebase, existing automation coverage. **Gate G3:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G3 <artifact>...`; GSD checks it at `plan:post`.
5. **Implementation** — Implement only approved cases, following the framework's architecture and rules. Reuse existing commands, helpers, and fixtures before adding new ones. A human approves the exact diff, every changed file, before any test runs against it. Standards: framework standard, well structured, reusable, maintainable, readable. **Gate G4:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G4 <artifact>...`; GSD checks it at `execute:wave:post`.
6. **Execution** — With G4 holding, run the focused tests first, then the impacted regression checks, using the project's own commands.
7. **Debugging** — Diagnose each failure from its evidence and fix the root cause, not the symptom. A fix changes the approved diff, so G4 is approved again before the rerun.
8. **Evidence** — Record the runs as evidence and link every case to its requirement. A human approves the evidence; without it the work is not complete. **Gate G5:** stop for human approval before the next stage. The human records it in an interactive terminal with `node scripts/gates.mjs approve --phase-dir <phase> G5 <artifact>...`; GSD checks it at `ship:pre`.
9. **Validation** — Reconcile the results against the approved scope, scenarios, plan, and cases, and list every gap. An independent reviewer judges this stage, not the author.
10. **Release** — With G5 holding, prepare release material only. A human decides, performs, or authorises the release: an agent never publishes, merges, or deploys.

GSD Core 1.14.0 runs this pipeline (`/gsd-discuss-phase` → `/gsd-plan-phase` → `/gsd-execute-phase` → `/gsd-verify-work` → `/gsd-ship`), and its `qa-harness` capability blocks the loop at each gate. `node scripts/gates.mjs status --phase-dir <phase>` shows every gate and the next command.

Never infer approval from an agent response or from green tests. Changing an approved artifact reopens its gate and every gate after it; re-check it.

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

Codex has no write-time hook, so these rules are guidance. The enforcing gate is `npm run verify`
(local + pre-push) and CI — see `docs/architecture/cross-tool-configuration.md`.

## Agent roster

- `cypress-intake` (INTAKE) — Start a new project or module, or turn unknown application behavior into context and config constants
- `cypress-generator` (BUILD) — Build a module from a requirement id — config → commands → spec
- `cypress-debugger` (DIAGNOSE) — Debugging a reproducible test failure locally
- `pre-merge-qa-gate` (EVALUATE) — Evaluate supplied diff and verification evidence — PASS / PASS_WITH_ACTIONS / BLOCK

Read/search only by design: the gate cannot edit files or execute shell commands, so the builder never grades its own output.

## Where things live

| Layer | Path |
|---|---|
| Config | `cypress/configs` |
| Commands | `cypress/support/commands` |
| Tests | `cypress/tests/**/*.cy.{js,ts}` |
