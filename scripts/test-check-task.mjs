#!/usr/bin/env node
// Tests for task-id resolution (PR #14) and shallow-clone guard (PR #16).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/cli.mjs";
import { changedFilesSince, resolveTaskId } from "./check-task.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── resolveTaskId / parseArgs ────────────────────────────────────────────────

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

// ── CLI invocation: empty --id falls back to branch ─────────────────────────

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

// ── changedFilesSince: shallow-clone guard ───────────────────────────────────

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "task-check@example.com"]);
  git(dir, ["config", "user.name", "task-check"]);
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "check-task-full-"));
initRepo(repo);
fs.writeFileSync(path.join(repo, "code.js"), "export const n = 1;\n");
git(repo, ["add", "."]);
git(repo, ["commit", "-m", "verified snapshot"]);
const verified = git(repo, ["rev-parse", "HEAD"]);

fs.mkdirSync(path.join(repo, "evidence", "tasks"), { recursive: true });
fs.writeFileSync(
  path.join(repo, "evidence", "tasks", "TASK-001.json"),
  '{"status":"verified"}\n',
);
git(repo, ["add", "."]);
git(repo, ["commit", "-m", "record verified manifest"]);

const gitAt = (cwd) => (args) => git(cwd, args);

assert.deepEqual(
  changedFilesSince(verified, gitAt(repo)),
  ["evidence/tasks/TASK-001.json"],
  "full history must see the post-verify manifest commit",
);

const shallowParent = fs.mkdtempSync(
  path.join(os.tmpdir(), "check-task-shallow-"),
);
const shallow = path.join(shallowParent, "clone");
git(repo, ["clone", "--depth", "1", `file://${repo}`, shallow]);
assert.equal(
  git(shallow, ["rev-list", "--count", "HEAD"]),
  "1",
  "shallow clone keeps only HEAD",
);
assert.throws(
  () => changedFilesSince(verified, gitAt(shallow)),
  /fetch-depth: 0/,
  "shallow clone must fail with an actionable fetch-depth error",
);

console.log("[task:check:test] all checks passed.");
