#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson } from "./lib/cli.mjs";
import {
  activeRequirementIds,
  approvalState,
  contentHash,
  validateRequirementLinks,
  validateTask,
} from "./lib/task-protocol.mjs";

const ROOT = process.env.HARNESS_TASK_ROOT
  ? path.resolve(process.env.HARNESS_TASK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const branch = process.env.GITHUB_HEAD_REF ?? process.env.GIT_BRANCH ?? "";
const id = args.id ?? (branch.startsWith("task/") ? branch.slice(5) : "");
const git = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function file(relative) {
  if (!relative || path.isAbsolute(relative))
    throw new Error("artifact path must be relative");
  const absolute = path.resolve(ROOT, relative);
  if (
    path.relative(ROOT, absolute).startsWith("..") ||
    !fs.existsSync(absolute)
  ) {
    throw new Error(`required task artifact is missing: ${relative}`);
  }
  return absolute;
}

try {
  if (!id) throw new Error("--id is required (or use a task/<ID> branch)");
  const task = readJson(file(path.join("evidence", "tasks", `${id}.json`)));
  validateTask(task);
  if (task.status !== "verified")
    throw new Error(`task ${id} is ${task.status}, not verified`);
  validateRequirementLinks(
    task,
    activeRequirementIds(
      readJson(file(path.join("evidence", "requirements.json"))),
    ),
  );
  const plan = task.approvals?.plan;
  const planState = approvalState(
    task,
    "plan",
    plan?.path,
    fs.readFileSync(file(plan?.path), "utf8"),
  );
  if (!planState.ok) throw new Error(planState.reason);
  if (task.proofMode !== "no-test") {
    if (!task.evidence)
      throw new Error(`task ${id} has no verification evidence`);
    const evidence = fs.readFileSync(file(task.evidence.path), "utf8");
    if (contentHash(evidence) !== task.evidence.sha256) {
      throw new Error("task evidence changed after verification");
    }
  }
  const changed = git(["diff", "--name-only", `${task.verifiedCommit}..HEAD`]);
  const allowed = new Set([
    task.approvals.plan.path,
    `evidence/tasks/${id}.json`,
  ]);
  if (task.evidence) allowed.add(task.evidence.path);
  const unverified = changed
    .split(/\r?\n/)
    .filter((file) => file && !allowed.has(file));
  if (unverified.length) {
    throw new Error(
      `code changed after verification: ${unverified.join(", ")}`,
    );
  }
  console.log(`[task] ${id} is verified and branch-visible`);
} catch (error) {
  console.error(`[task] ${error.message}`);
  process.exitCode = 1;
}
