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
  validateRequirementDigests,
  validateRequirementLinks,
  validateTask,
} from "./lib/task-protocol.mjs";

const ROOT = process.env.HARNESS_TASK_ROOT
  ? path.resolve(process.env.HARNESS_TASK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve the task id from an explicit `--id` or a `task/<ID>` branch.
 *
 * `--id ""` (GitHub Actions when `inputs.task_id` is unset) and a bare `--id`
 * boolean must not win over the branch. `??` keeps `true` and `""`, which made
 * CI look up `evidence/tasks/true.json` instead of `task/FOO`.
 */
export function resolveTaskId(
  args,
  env = process.env,
  branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GIT_BRANCH || "",
) {
  const explicit = typeof args.id === "string" ? args.id.trim() : "";
  if (explicit) return explicit;
  return branch.startsWith("task/") ? branch.slice(5) : "";
}

/**
 * Files changed after the verification commit. A shallow clone that does not
 * contain that commit must fail loudly — `git diff missing..HEAD` otherwise
 * aborts with an opaque revision error and blocks the only live CI path.
 */
export function changedFilesSince(verifiedCommit, git) {
  if (!verifiedCommit) throw new Error("verified commit is required");
  try {
    git(["cat-file", "-e", `${verifiedCommit}^{commit}`]);
  } catch {
    throw new Error(
      `cannot see verification commit ${verifiedCommit} in this checkout. ` +
        `task:check diffs that commit against HEAD, so CI must fetch full ` +
        `history (actions/checkout fetch-depth: 0).`,
    );
  }
  const changed = git(["diff", "--name-only", `${verifiedCommit}..HEAD`]);
  return changed ? changed.split(/\r?\n/).filter(Boolean) : [];
}

export function unverifiedFiles(changed, allowed) {
  return changed.filter((file) => file && !allowed.has(file));
}

function file(relative, root = ROOT) {
  if (!relative || path.isAbsolute(relative))
    throw new Error("artifact path must be relative");
  const absolute = path.resolve(root, relative);
  if (
    path.relative(root, absolute).startsWith("..") ||
    !fs.existsSync(absolute)
  ) {
    throw new Error(`required task artifact is missing: ${relative}`);
  }
  return absolute;
}

export function checkTask({
  id,
  root = ROOT,
  git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(),
} = {}) {
  if (!id) throw new Error("--id is required (or use a task/<ID> branch)");
  const task = readJson(file(path.join("evidence", "tasks", `${id}.json`), root));
  validateTask(task);
  if (task.status !== "verified")
    throw new Error(`task ${id} is ${task.status}, not verified`);
  validateRequirementLinks(
    task,
    activeRequirementIds(
      readJson(file(path.join("evidence", "requirements.json"), root)),
    ),
  );
  validateRequirementDigests(
    task,
    readJson(file(path.join("evidence", "requirements.json"), root)),
  );
  const plan = task.approvals?.plan;
  const planState = approvalState(
    task,
    "plan",
    plan?.path,
    fs.readFileSync(file(plan?.path, root), "utf8"),
  );
  if (!planState.ok) throw new Error(planState.reason);
  if (task.proofMode !== "no-test") {
    if (!task.evidence)
      throw new Error(`task ${id} has no verification evidence`);
    const evidence = fs.readFileSync(file(task.evidence.path, root), "utf8");
    if (contentHash(evidence) !== task.evidence.sha256) {
      throw new Error("task evidence changed after verification");
    }
  }
  const allowed = new Set([
    task.approvals.plan.path,
    `evidence/tasks/${id}.json`,
  ]);
  if (task.evidence) allowed.add(task.evidence.path);
  const unverified = unverifiedFiles(
    changedFilesSince(task.verifiedCommit, git),
    allowed,
  );
  if (unverified.length) {
    throw new Error(
      `code changed after verification: ${unverified.join(", ")}`,
    );
  }
  return `[task] ${id} is verified and branch-visible`;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const id = resolveTaskId(args, process.env);
  try {
    console.log(checkTask({ id }));
  } catch (error) {
    console.error(`[task] ${error.message}`);
    process.exitCode = 1;
  }
}
