# Task workflow standard

**Status:** active · **Scope:** optional, repository-local task control for work that needs an
explicit owner, review record, and reproducible proof. This standard is shipped with the harness;
it does not depend on LANE or another external orchestrator.

## Standard

The task record is coordination metadata, not a replacement for product intent, source review, or
native runner evidence. Every task references one or more active ids in
`evidence/requirements.json`; it never copies acceptance criteria into a second document.

```
queued → claimed → verified → landed
```

Only this sequence is valid. A task is claimed by one named owner in one explicit Git worktree.
`land` records a merge already completed elsewhere; this command never merges, pushes, or changes a
workflow.

## Required workflow

Run `new` and `claim` from the main checkout. Run the remaining commands from the claimed
worktree. Task records live at `evidence/tasks/<id>.json`.

1. **Create.** Select the requirement ids and exactly one proof mode.

   ```text
   node scripts/task-control.mjs new --id TASK-001 --requirement REQ-001 --proof-mode automation-evidence
   ```

   `automation-evidence` is for Cypress or Playwright work. `source-tdd` is for deterministic
   source changes and also requires a test command, for example `--test-cmd "node --test"`.
   `no-test` is limited to documentation or process work and requires `--reason`.

2. **Claim.** Give the task one named owner and a new, absolute worktree path.

   ```text
   node scripts/task-control.mjs claim --id TASK-001 --owner "Reviewer name" --worktree C:\worktrees\TASK-001
   ```

   Do the implementation and write the plan inside this claimed worktree. Do not share, reuse, or
   hand-edit another task's worktree. `claim` also writes the claimed manifest into that branch.
   Approve and verify from the claimed worktree, then commit its manifest, approved plan, and proof
   report. CI rejects a task branch if code changed after its verification commit.

3. **Approve the plan.** A human reviewer approves the exact plan file. The stored SHA-256 is part
   of the approval, so any later edit blocks verification until it is approved again.

   ```text
   node scripts/task-control.mjs approve --id TASK-001 --artifact plan --file docs/tasks/TASK-001/plan.md --by "Reviewer name"
   ```

4. **Attach proof and verify.** The verifier checks the selected proof mode, then writes the task
   as `verified`.

   ```text
   node scripts/task-control.mjs attach-evidence --id TASK-001 --file evidence/runner-result.json
   node scripts/task-control.mjs verify --id TASK-001 --plan docs/tasks/TASK-001/plan.md
   ```

5. **Land only after the merge exists.** Record the actual merge commit; do not use this command as
   a substitute for review or release approval.

   ```text
   node scripts/task-control.mjs land --id TASK-001 --merge <merged-commit-sha>
   ```

CI runs `npm run task:check`. PRs use a `task/TASK-001` branch so the task id is unambiguous; a
manual workflow supplies the same id explicitly.

## Proof standard

| Mode                  | Required proof                                            | Verification rule                                                                                             |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `automation-evidence` | Approved plan and runner evidence artifact                | The evidence file must still match its attached SHA-256. Use native Cypress/Playwright output when available. |
| `source-tdd`          | Approved plan, path-accepting test command, commit ledger | A fresh worktree replays each behavior's failing RED, unchanged-test passing GREEN, and any passing refactor. |
| `no-test`             | Approved plan and explicit reason                         | Markdown-only; it is not execution evidence.                                                                  |

For `source-tdd`, record commits in order using exactly:

```text
Harness-Phase: red B-1
Harness-Phase: green B-1
Harness-Phase: refactor B-1
```

RED changes test files only and must fail. GREEN must leave those test files unchanged and make them
pass. REFACTOR must leave them unchanged and keep them passing. A missing, reordered, altered, or
non-running phase fails verification.

## Boundaries and release

- Run `new` and `claim` from the main checkout. Run `approve`, `attach-evidence`, and `verify`
  from the claimed worktree so the manifest, plan, and compact runner summary are all committed with
  the reviewed change.
- A task record proves only the declared workflow. It does not turn a setup failure, missing
  artifact, or static check into passing automation evidence.
- Change the canonical `src/` document and command first. Vendor it to each boilerplate, run
  `harness:check`, rules, lint, and the relevant runner checks in each consumer.
- Preserve consumer-owned changes. A vendored update must be staged as its own explicit file list;
  it must not absorb unrelated workflows, package scripts, local evidence, or feature work.
