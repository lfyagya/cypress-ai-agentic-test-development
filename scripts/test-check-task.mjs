#!/usr/bin/env node
// Contract for task-id resolution. GitHub Actions expands
// `--id "${{ inputs.task_id }}"` to `--id ""` when the input is unset.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { resolveTaskId } from "./check-task.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.deepEqual(
  parseArgs(["--id", ""]),
  { id: "" },
  "empty --id must stay empty, not become boolean true",
);
assert.deepEqual(
  parseArgs(["--id"]),
  { id: true },
  "bare --id is a boolean flag",
);
assert.deepEqual(parseArgs(["--id", "TASK-001"]), { id: "TASK-001" });

assert.equal(
  resolveTaskId(parseArgs(["--id", ""]), { GITHUB_HEAD_REF: "task/FOO" }),
  "FOO",
  "empty --id on a task/* PR branch must use the branch id",
);
assert.equal(
  resolveTaskId(parseArgs(["--id", ""]), { GITHUB_REF_NAME: "task/BAR" }),
  "BAR",
  "empty --id on a task/* dispatch branch must use GITHUB_REF_NAME",
);
assert.equal(
  resolveTaskId(parseArgs(["--id"]), { GITHUB_HEAD_REF: "task/FOO" }),
  "FOO",
  "boolean --id must not resolve to evidence/tasks/true.json",
);
assert.equal(
  resolveTaskId(parseArgs(["--id", "EXPLICIT"]), {
    GITHUB_HEAD_REF: "task/FOO",
  }),
  "EXPLICIT",
);
assert.equal(
  resolveTaskId(parseArgs(["--id", ""]), { GITHUB_HEAD_REF: "feature/x" }),
  "",
  "empty --id on a non-task branch has no id",
);

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

const invoked = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "check-task.mjs"), "--id", ""],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_HEAD_REF: "task/FOO" },
  },
);
assert.notEqual(invoked.status, 0, "missing FOO task must fail");
assert.match(
  invoked.stderr,
  /evidence\/tasks\/FOO\.json/,
  "empty --id on task/FOO must look up FOO.json, not true.json",
);
assert.doesNotMatch(
  invoked.stderr,
  /true\.json/,
  "boolean-true fallback would silently check the wrong task",
);

console.log(
  "[task:check:test] empty --id, branch fallback, and optional CI gate passed.",
);
