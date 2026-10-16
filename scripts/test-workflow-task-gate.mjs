#!/usr/bin/env node
// Cypress CI workflow gate — the consumer half of the task-control checks.
//
// Split out of test-check-task.mjs when that moved into the engine. The resolveTaskId and
// shallow-clone assertions are framework-agnostic and belong there; these read
// .github/workflows/cypress*.yml, which no other adapter has. Vendoring the combined file would
// have broken the Playwright consumer on a missing cypress.yml.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── workflow gate assertions ─────────────────────────────────────────────────

const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "cypress.yml"),
  "utf8",
);
const rules = fs.readFileSync(
  path.join(root, ".github", "workflows", "cypress-rules.yml"),
  "utf8",
);
for (const [name, text] of [
  ["cypress.yml", workflow],
  ["cypress-rules.yml", rules],
]) {
  assert.match(
    text,
    /required: false/,
    `${name} must not require task_id — task control is optional`,
  );
  assert.match(
    text,
    /if: \$\{\{ inputs\.task_id != '' \|\| startsWith\(github\.head_ref, 'task\/'\) \|\| startsWith\(github\.ref_name, 'task\/'\) \}\}/,
    `${name} must skip task:check unless a task id is actually in play`,
  );
}

assert.equal(
  [...workflow.matchAll(/uses:\s*actions\/checkout@/g)].length,
  2,
  "smoke and e2e both check out the repo",
);
assert.equal(
  [...workflow.matchAll(/fetch-depth:\s*0/g)].length,
  2,
  "both checkouts must fetch full history so task:check can see verifiedCommit",
);

console.log("[workflow:task-gate:test] all checks passed.");
