## QA Automation Foundations

### Scenario contract

Before implementation, classify every scenario:

- **Type:** `SMOKE` for a minimal, must-pass core happy path; `REGRESSION` for edge cases,
  negative paths, data variations, or past bugs.
- **Priority:** `P0` blocks release, `P1` is major, and `P2` is minor. Implement `P0` first.
- Record the requirement and acceptance criterion, preconditions, expected outcome, and a one-line
  reason for the Type and Priority. Ask when the classification is genuinely unclear.

Type and framework tier are related but separate. A `smoke` tier test is `SMOKE`; `e2e` and `ddt`
tests are `REGRESSION`. Each test carries exactly one Type tag (`@smoke` or `@regression`), one
Priority tag (`@P0`, `@P1`, or `@P2`), exactly one requirement tag, and any distinct framework tier
tag such as `@e2e` or `@ddt`.

### Test contract

- Prefix the title with the requirement id so every reporter preserves traceability, then state the
  observable behavior and expected result, for example
  `[PAY-CHECKOUT-001] creates order when cart is valid`. Group files and suites by feature with
  consistent casing.
- Keep one behavior per test. Use Arrange–Act–Assert, with thin tests and verb-first reusable steps.
- Make tests independent, order-agnostic, repeatable, and deterministic. Do not rely on timing,
  retries, run order, or leftover state.
- Use a meaningful assertion that fails when the behavior breaks. A passing test is insufficient
  unless it passes for the intended reason.
- Use synthetic, disposable, non-PII data. Do not use shared or production data. Prefer a
  factory/builder when a test needs varied created data, and clean up created state in
  framework-appropriate teardown even when the test fails.
- Use `try/catch` only for real recovery, diagnostic context, or cleanup. Never swallow an
  assertion or convert a failure into a pass.
- Treat flakiness as a defect: quarantine with an owner and reason, then root-cause it. Never mask
  it with blind retries or arbitrary waits.
- Remove duplication and dead or commented-out code. Use descriptive data names instead of magic
  values.

### Locator contract

Prefer locators that describe **intent** over locators that describe **structure**. In order:

| Priority | Locate by                                             | Use for                                |
| -------: | ----------------------------------------------------- | -------------------------------------- |
|        1 | Accessible role plus its name                         | Interactive elements                   |
|        2 | Associated label                                      | Form controls                          |
|        3 | Visible text                                          | Non-interactive assertions             |
|        4 | An explicit test attribute (`data-testid`, `data-cy`) | An intentional test contract           |
|        5 | CSS or XPath                                          | Last resort only, with a stated reason |

A structural selector is a bet that the DOM will not change. Levels 1–3 survive a refactor that
levels 4–5 do not, and they double as accessibility pressure on the application.

When more than one element matches, **narrow with a content or descendant filter before reaching for
an index**. An index silently targets the wrong element the moment the DOM shifts, and it fails as a
passing test rather than an error — the worst failure mode. If no filter can disambiguate, that is a
finding about the application's testability, not a reason to reach for position.

Neither rule is enforced at write time: deciding whether a given locator had a better alternative
needs real analysis, not a regex, and a regex here produces false positives that teach people to
ignore the hook. Both are graded by the independent gate instead.

### Independent gate grading

The builder uses this rubric as acceptance criteria but never grades its own output. The
independent gate starts each changed test at 100 and applies every relevant deduction:

| Defect                                            | Deduction |
| ------------------------------------------------- | --------: |
| Unclear or incorrect naming                       |       -15 |
| Wrong Type or Priority                            |       -15 |
| Not independent or order-dependent                |       -20 |
| Weak or missing assertion                         |       -20 |
| Duplicated logic or dead code                     |       -10 |
| `try/catch` hides failures or flakiness is masked |       -20 |
| Created state has no failure-safe cleanup         |       -15 |
| Requirement traceability is missing               |        -5 |
| Structural locator where a semantic one exists    |       -10 |
| Index used where a filter would disambiguate      |       -10 |

A test needs at least 80/100 to pass. That score is necessary, not sufficient: missing required
command evidence, credentials or unsafe data, state-changing smoke behavior, hidden failures, or
another repository `BLOCK` rule still blocks the merge regardless of score.

The gate reports scenario Type, Priority, and reason; the per-test score and deductions; the
overall verdict; and any gaps or risks. It never invents evidence or coverage.

### Verdict meanings

| Verdict             | Merge?   | Follow-ups                                                            |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `PASS`              | Yes      | None required                                                         |
| `PASS_WITH_ACTIONS` | Yes, now | Named non-blocking follow-ups only — never a substitute for a blocker |
| `BLOCK`             | No       | Blockers with file:line; fix before merge                             |

`PASS_WITH_ACTIONS` counts as accepted for M1. Named actions (and optional resolution notes) are
preserved on the gate ledger row and surfaced in `metrics.json` as `gateFollowUps`.

### Role contracts

Each role has a fixed scope. Crossing it — grading your own work, writing files from EVALUATE,
running DIAGNOSE speculatively — defeats the separation that makes AI output trustworthy.

| Role     | Agent              | Precondition                          | Input                          | Output                                    | Permissions       | Cannot                              |
| -------- | ------------------ | ------------------------------------- | ------------------------------ | ----------------------------------------- | ----------------- | ----------------------------------- |
| INTAKE   | `cypress-intake`   | New project or module, no context yet | App source, product docs       | `docs/application-intelligence/**`, requirement drafts | Read + Write docs | Write specs or commands             |
| BUILD    | `cypress-generator`| One active requirement id approved    | A single `active` requirement  | Config constants, commands, one spec      | Read + Write `cypress/**` | Issue verdicts, invoke gate  |
| EVALUATE | `pre-merge-qa-gate`| BUILD has run and provided evidence   | Changed files + command output | Verdict (PASS / PASS_WITH_ACTIONS / BLOCK) | **Read only** (no Write, no Bash) | Fix findings, append evidence |
| DIAGNOSE | `cypress-debugger` | A reproducible failure exists         | Failure evidence               | Root cause + targeted fix                 | Read + Write `cypress/**` | Run speculatively, grade output |

Repairs by BUILD after a BLOCK verdict count against `loops.gateRepairLimit` (default 3). Reaching
the limit without a PASS escalates to the human with the remaining evidence-backed blockers — the
loop does not continue indefinitely.
