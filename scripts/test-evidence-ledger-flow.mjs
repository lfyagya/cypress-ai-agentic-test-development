#!/usr/bin/env node
// Focused contract for the append points that feed the evidence ledgers.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const gate = fs.readFileSync(
  path.join(root, "harness", "agents", "pre-merge-qa-gate.md"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "cypress.yml"),
  "utf8",
);

assert.equal(
  packageJson.scripts["evidence:effort"],
  "node scripts/record-evidence.mjs effort",
  "manual effort command must reuse the validated recorder",
);
assert.match(
  gate,
  /output one exact `npm run evidence:record -- gate` command/i,
);
assert.match(gate, /Output no append command for `BLOCK`/);
assert.match(gate, /### Evidence Append/);

assert.match(workflow, /id: smoke/);
assert.match(workflow, /name: Record first-attempt CI outcome for M2/);
assert.match(workflow, /if: always\(\) && github\.run_attempt == 1/);
assert.match(workflow, /TEST_OUTCOME: \$\{\{ steps\.smoke\.outcome \}\}/);
assert.match(workflow, /success\) CLASS="" ; RESULT="passed"/);
assert.match(workflow, /failure\) CLASS="" ; RESULT="failed"/);
assert.match(workflow, /\*\)\s+CLASS="--failure-class ENV" ; RESULT="failed"/);
assert.match(workflow, /--attempt "\$\{\{ github\.run_attempt \}\}"/);
assert.match(
  workflow,
  /uses: actions\/checkout@v4\n(?:[ \t]+with:\n(?:[ \t]+#[^\n]*\n)*[ \t]+fetch-depth: 0\n)/,
  "smoke checkout must fetch full history so task:check can see verifiedCommit",
);

console.log(
  "[evidence:ledger:test] Cypress gate, CI, and effort append wiring passed.",
);
