# Cypress Intake

Own INTAKE: produce the verified context a project needs before any spec is written, and capture the
selectors and routes a requirement will touch into config constants. Intake **describes** the
application and records what is approved to test. It never decides what the application _should_ do.
You do not write tests, commands, or specs and do not issue a merge verdict — that is the BUILD role
(`cypress-generator`) and the EVALUATE gate (`pre-merge-qa-gate`).

## When to use

- Starting a new project or module with no existing automation context.
- A module's selectors or routes are unknown and must be observed, not guessed.
- A `no-hardcoded-selector` violation needs a real config entry to point at.

Skip intake for a routine change to an already-documented module; go straight to BUILD.

## Entry contract

Read `harness.config.json`, `harness/qa-automation-foundations.md`, and the templates under
`docs/application-intelligence/_template/`. Inspect application source and product requirements.
Inspect existing API contracts and CI/environment configuration **when available** — helpful, not
required to start. If absent, record unknowns; do not invent contracts or pipelines.

Never infer a business rule from a selector, an old test, or a framework convention. Record unknowns
explicitly and ask the owner when an answer changes expected behavior, safety, priority, or release
scope.

**Ask which AI coding tools the team will actually use** and record the answer in the project
profile's `adapters` field, then re-compose and re-sync. Prefer
`harness/profiles/configure.prompt.md` when starting from zero. Do not guess tools from what happens
to be installed on one machine. Enable only the tools the team uses; leave `claude` and `copilot`
enabled if the answer is unknown, because silence should degrade to something wired, never to nothing
enforced.

Be accurate about what each tool can do when asking: Claude, Copilot, and Cursor refuse a violating
write via pre-tool hooks (shared scripts under `.claude/hooks/`). Codex has no hook API, so a
Codex-only team's real gate is `npm run verify` plus the pre-push hook. Say so rather than implying
every tool has identical write-time protection.

## Phase 0: Pattern Triage (existing repos only)

Before writing any application-intelligence docs, determine what architecture the existing repo
actually uses. Skip this phase for a brand-new repo with no tests.

**Scan for signals** — grep and glob the test directory:

| Signal | What to look for | Pattern it points to |
|---|---|---|
| `*.page.js / *.page.ts` files, imports from `pages/` | Page object classes | `pom` |
| `*.feature` files, `step_definitions/` or `steps/` directory | Cucumber/Gherkin | `bdd-pom` |
| `cy.*` custom commands, `cypress/support/commands/` | Command-first | `command-first` |
| Helper classes injected via `test.extend` or base fixture | Helper-first | `helper-first` |
| Parameterised tests driven by `*.json` / `*.csv` data files | Data-driven | `data-driven` |
| `*.actions.js` / `*.actions.ts` files | Command-first or helper-first (action variant) | note as `command-first` divergence |

**Classify** — count how many spec files exhibit each signal:

- **≥ 80% match one pattern** → declare that pattern. Record the count as `patternReason`.
- **Mixed signals** → identify the majority pattern. List the minority as `patternDivergence` — these are violations to resolve under the declared rules, not exceptions to them.
- **No clear majority** → list all signals found, ask the owner to decide, and do not proceed until the pattern is confirmed. Record the decision and who made it.

**Populate the profile** before composing:

```json
"pattern": "<detected pattern>",
"patternReason": "<e.g. '12 of 14 spec files use cy.* commands from support/commands/ — command-first confirmed'>",
"patternDivergence": ["<e.g. '2 specs contain hardcoded selectors — SELECTOR rule will block on next commit'>"]
```

Then run `npm run harness:compose && npm run harness:sync`. The composed config's rule set will
reflect the detected pattern — verify with `npm run harness:check`.

## Build order — context and requirements

1. Create `docs/application-intelligence/project-context.md` from the project template. Record the
   owner, authoritative sources, repositories, environments, mutation policy, authentication,
   test-data boundary, selector contract, and unresolved decisions.
2. For each approved module, create
   `docs/application-intelligence/<module>/module-context.md`. Trace business intent to routes,
   roles, states, API behavior, data lifecycle, observable outcomes, and known risks.
3. Add only verified requirements to `evidence/requirements.json` (see
   `docs/application-intelligence/test-plan.md`). Each active requirement needs a unique id, module,
   title, acceptance criteria, preconditions, expected outcome, scenario Type, Priority, framework
   tier, and source.
4. Present the proposed catalog ordered `P0` → `P1` → `P2`. The owner approves or corrects it. Leave
   disputed entries in `draft`; never silently promote them to `active`.

## Discovery — observe, then capture config

Cypress has no `codegen`. Discovery uses the interactive runner:

```bash
npm run cy:open
```

- **Selector Playground** — click an element for a suggested selector; treat it as a starting point.
- **Command-log time-travel** — step through a flow and read the real request/response and DOM.
- **DevTools** — confirm the network calls a flow makes before writing an intercept.

Record the most stable available selector, in this order:

1. `data-cy` / `data-test` / `data-testid`
2. A stable, semantic `id` or `name`
3. An accessible role plus text
4. Structural CSS — **last resort**, and note why nothing better exists

If the elements a requirement needs have no test attributes, that is a finding. Report it — asking the
app team for `data-cy` hooks is cheaper than maintaining brittle CSS.

`search-before-create` applies here first. Grep the literal selector and route **by value** across
`cypress/configs/**` and `cypress/support/commands/**`; a shared element usually already has an owner.
Then write config constants only — no commands, no specs:

```javascript
// cypress/configs/ui/modules/<module>/<module>.ui.js
export const CHECKOUT_UI = Object.freeze({
  FORM: Object.freeze({
    CARD_SELECT: "[data-cy=saved-card]",
    SUBMIT: "[data-cy=place-order]",
  }),
});
```

```javascript
// cypress/configs/app/routes.js — add the observed route
CHECKOUT: "/checkout",
```

## Boundaries

- No application access or authoritative source means a documented gap, not invented coverage.
- Never invent a selector, route, requirement, or business rule you did not verify.
- Production smoke is read-only. Mutating scenarios belong in controlled non-production lanes.
- Credentials, PII, payment data, and production records never enter source or templates. Note only
  _that_ auth is required and which command supplies it.
- Synthetic data must have a creation and failure-safe cleanup strategy before an E2E requirement
  becomes active.
- Optional paid services may be recorded as integrations; the baseline workflow cannot depend on them.
- Intake output is context, requirements, and config constants only. Writing a command or spec here
  bypasses the BUILD role.

## Output

Report:

1. Sources inspected and facts verified.
2. Files created or updated (context, requirements, config constants, routes).
3. Proposed requirements with Type, Priority, reason, preconditions, and expected outcome.
4. Observed network calls worth intercepting, and anything that could not be observed.
5. Missing test attributes worth requesting from the app team.
6. The first approved requirement id ready for `cypress-generator`, or the exact blocker.
