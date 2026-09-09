# Graded-rule fixture corpus

Regression cover for the rules no regex can enforce.

## Why this exists

The harness has 11 rules. Eight are `severity: "block"` — a regex fires, the write-time hook refuses,
and `test-block-rules-enforced.mjs` proves every one of them fires on a violating sample. Declare a
block rule without a sample and that test fails.

Three are `severity: "review"`, graded by `pre-merge-qa-gate`:

| Rule                   | How it fails                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `locator-priority`     | Score deduction, −10, "Structural locator where a semantic one exists" |
| `narrow-before-index`  | Score deduction, −10, "Index used where a filter would disambiguate"   |
| `search-before-create` | **BLOCK** — gate Phase 1, duplicate ownership                   |

They are graded rather than hooked on purpose: deciding whether a locator had a better alternative
needs analysis, and a regex here produces false positives that teach people to ignore the hook.

The cost of that choice is that **model judgment is now a dependency**. Upgrade the model, or edit
`harness/qa-automation-foundations.md`, and what the gate accepts can shift with nothing to notice.
This corpus is the thing that notices.

## What is checked automatically

`node scripts/engine/test-graded-rule-fixtures.mjs`, wired into `npm run harness:test`. It is
deterministic and makes no model calls:

1. **Coverage** — every graded rule has a `pass` and a `fail` fixture. Adding a fourth graded rule
   without fixtures fails the test.
2. **Reachability** — no fixture trips a *blocking* rule at its declared `asIfPath`. This is the
   property that makes the corpus mean anything: a should-fail fixture containing, say, a hardcoded
   selector would be refused by the hook and the gate would never grade it. The corpus would look
   populated and prove nothing. (This check caught two of the six fixtures on first run — they were
   missing the `@no-ensureAuthenticated` pragma.)
3. **Manifest ↔ disk** — no orphan fixtures, no missing files, every entry states an expectation.

It **cannot** detect judgment drift. Only running the gate can.

## Running the corpus

After a model upgrade, an edit to `qa-automation-foundations.md`, an agent prompt change, or an
engine bump:

1. Invoke `pre-merge-qa-gate` against the fixtures. It has `Read`, `Grep` and `Glob`, so point it at
   `harness/fixtures/graded-rules/` and have it grade each file **as if** it were at the `asIfPath`
   recorded in `manifest.json` — path determines which rules apply.
2. Compare its findings, deductions and verdicts to each fixture's `expect` block.
3. Any difference is drift. Decide which is right:
   - The gate is now **stricter** → new false positives; check the pass fixtures first.
   - The gate is now **looser** → a real regression; violations are reaching merge.
   - The intended standard changed → update `expect` and bump `recordedAgainst` in the manifest,
     in the same commit as the policy change that caused it.

Never update `expect` to make a diff go away without deciding which side is correct. A corpus edited
to match whatever the model said this week measures nothing.

## Adding a fixture

- One rule, one polarity, one file. A fixture that violates two rules cannot tell you which one drifted.
- The fail fixture must be *reachable*: clean under every blocking rule at its `asIfPath`.
- The pass fixture must express the **same behaviour** as its fail counterpart, done correctly —
  otherwise a diff cannot distinguish "the gate got stricter" from "the two files just differ".
- Record `expect` and a one-line `why` in `manifest.json`.

Fixtures live outside `cypress/tests/**` on purpose: Cypress never collects them and `check:rules`
never scans them.
