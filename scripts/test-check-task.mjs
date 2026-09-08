#!/usr/bin/env node
// Contract for task:check's post-verify diff. The documented flow commits the
// verified manifest after verify, so verifiedCommit is a parent of HEAD. A
// shallow clone cannot see that parent; CI must fetch full history.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedFilesSince } from "./check-task.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "cypress.yml"),
  "utf8",
);

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

assert.equal(
  [...workflow.matchAll(/uses:\s*actions\/checkout@v4/g)].length,
  2,
  "smoke and e2e both check out the repo",
);
assert.equal(
  [...workflow.matchAll(/fetch-depth:\s*0/g)].length,
  2,
  "both checkouts must fetch full history so task:check can see verifiedCommit",
);
assert.match(
  workflow,
  /name: Verify task manifest\n\s+run: npm run task:check/,
  "smoke still runs task:check after checkout",
);

console.log("[task:check:test] shallow-clone guard and checkout depth passed.");
