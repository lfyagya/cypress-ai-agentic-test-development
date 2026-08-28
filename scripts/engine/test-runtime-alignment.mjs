#!/usr/bin/env node
// Node 22 is the supported local minimum; CI runs Node 24 because GitHub-hosted actions do.
// Drift here is how a clone "works on my machine" and fails in CI (or the reverse).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const MINIMUM_MAJOR = 22;
const CI_MAJOR = 24;

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const engines = pkg.engines?.node;
assert.ok(engines, "package.json must declare engines.node");
assert.match(
  String(engines),
  new RegExp(`>=\\s*${MINIMUM_MAJOR}(\\.0\\.0)?`),
  `package.json engines.node must require Node ${MINIMUM_MAJOR}+ (found ${engines})`,
);

const workflows = [
  path.join(root, ".github", "workflows", "cypress.yml"),
  path.join(root, ".github", "workflows", "cypress-rules.yml"),
];
for (const file of workflows) {
  const text = fs.readFileSync(file, "utf8");
  assert.match(
    text,
    new RegExp(`NODE_VERSION:\\s*"${CI_MAJOR}"|node-version:\\s*"${CI_MAJOR}"`),
    `${path.relative(root, file)} must pin Node ${CI_MAJOR}`,
  );
  assert.doesNotMatch(
    text,
    /node-version:\s*"(18|20)"|NODE_VERSION:\s*"(18|20)"/,
    `${path.relative(root, file)} still pins a pre-22 Node version`,
  );
  assert.match(text, /uses: actions\/checkout@v5/);
  assert.match(text, /uses: actions\/setup-node@v5/);
}

const [cypressWorkflow, rulesWorkflow] = workflows.map((file) =>
  fs.readFileSync(file, "utf8"),
);
assert.match(cypressWorkflow, /pull_request:\s*\n\s+branches: \[main\]/);
assert.match(cypressWorkflow, /uses: actions\/upload-artifact@v6/);
assert.match(
  cypressWorkflow,
  /if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'pull_request' && startsWith\(github\.head_ref, 'task\/'\)\)/,
  "Cypress PRs must not require a manual task_id unless they use a task branch",
);
assert.match(rulesWorkflow, /pull_request:\s*\n\s+paths:/);
assert.match(
  rulesWorkflow,
  /if: github\.event_name == 'workflow_dispatch' \|\| startsWith\(github\.head_ref, 'task\/'\)/,
  "rules PRs must not require a manual task_id unless they use a task branch",
);

const environment = JSON.parse(
  fs.readFileSync(path.join(root, ".cursor", "environment.json"), "utf8"),
);
assert.match(
  String(environment.install ?? ""),
  /major\s*<\s*22|Node\.js 22\+/,
  ".cursor/environment.json install must refuse Node < 22",
);

const config = fs.readFileSync(path.join(root, "cypress.config.js"), "utf8");
assert.doesNotMatch(
  config,
  /chromeWebSecurity\s*:\s*false/,
  "cypress.config.js must not disable chromeWebSecurity without a verified requirement",
);

console.log(
  `[runtime-alignment] Node ${MINIMUM_MAJOR}+ declared for local use and Node ${CI_MAJOR} pinned in CI; chromeWebSecurity default restored`,
);
