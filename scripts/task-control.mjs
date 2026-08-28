#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson } from "./lib/cli.mjs";
import {
  activeRequirementIds,
  approvalState,
  approveArtifact,
  contentHash,
  createTask,
  dependenciesReady,
  groupSourceTddPhases,
  isDocumentationPath,
  isTestPath,
  snapshotRequirementDigests,
  transition,
  validateRequirementDigests,
  validateRequirementLinks,
  validateTask,
} from "./lib/task-protocol.mjs";

const ROOT = process.env.HARNESS_TASK_ROOT
  ? path.resolve(process.env.HARNESS_TASK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK_ROOT = path.join("evidence", "tasks");

function usage() {
  console.error(`Usage:
  task-control.mjs new --id <id> --requirement <id[,id]> --proof-mode <source-tdd|automation-evidence|no-test> [--reason <text>]
  task-control.mjs claim --id <id> --owner <name> --worktree <absolute-path> [--branch <name>]
  task-control.mjs approve --id <id> --artifact <plan|verification> --file <repo-relative-path> --by <name>
  task-control.mjs attach-evidence --id <id> --file <repo-relative-path>
  task-control.mjs verify --id <id> --plan <repo-relative-path>
  task-control.mjs land --id <id> --merge <sha>
  task-control.mjs status [--id <id>]`);
}

function taskFile(id, root = ROOT) {
  return path.join(root, TASK_ROOT, `${id}.json`);
}

function saveTask(task, root = ROOT) {
  fs.mkdirSync(path.dirname(taskFile(task.id, root)), { recursive: true });
  fs.writeFileSync(
    taskFile(task.id, root),
    `${JSON.stringify(task, null, 2)}\n`,
  );
}

function loadTask(id, root = ROOT) {
  const file = taskFile(id, root);
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id}`);
  const task = readJson(file);
  validateTask(task);
  return task;
}

function allTasks(root = ROOT) {
  const directory = path.join(root, TASK_ROOT);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => loadTask(path.basename(entry, ".json"), root));
}

function repoFile(relative, root = ROOT) {
  if (!relative || path.isAbsolute(relative)) {
    throw new Error("artifact paths must be repository-relative");
  }
  const absolute = path.resolve(root, relative);
  if (path.relative(root, absolute).startsWith("..")) {
    throw new Error("artifact path must stay inside the repository");
  }
  if (!fs.existsSync(absolute))
    throw new Error(`artifact not found: ${relative}`);
  return { absolute, relative: relative.replaceAll("\\", "/") };
}

function taskArtifactFile(task, relative) {
  return repoFile(relative, task.claim?.worktree ?? ROOT);
}

function requireId(args) {
  if (typeof args.id !== "string") throw new Error("--id is required");
  return args.id;
}

function requirementRegistry(root = ROOT) {
  return readJson(path.join(root, "evidence", "requirements.json"));
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function commandNew(args) {
  const requirements = String(args.requirement ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const task = createTask({
    id: requireId(args),
    requirements,
    proofMode: args["proof-mode"],
    noTestReason: typeof args.reason === "string" ? args.reason : "",
    requirementDigests: snapshotRequirementDigests(
      requirements,
      requirementRegistry(),
    ),
  });
  if (task.proofMode === "source-tdd") {
    if (typeof args["test-cmd"] !== "string" || !args["test-cmd"].trim()) {
      throw new Error("source-tdd tasks require --test-cmd");
    }
    task.sourceTdd = {
      testCommand: args["test-cmd"],
      setupCommand:
        typeof args["setup-cmd"] === "string" ? args["setup-cmd"] : "",
      testRanPattern:
        typeof args["test-ran-pattern"] === "string"
          ? args["test-ran-pattern"]
          : "",
    };
  }
  validateRequirementLinks(task, activeRequirementIds(requirementRegistry()));
  if (fs.existsSync(taskFile(task.id)))
    throw new Error(`task already exists: ${task.id}`);
  saveTask(task);
  console.log(`[task] created ${task.id} (${task.proofMode})`);
}

function commandClaim(args) {
  const task = loadTask(requireId(args));
  if (task.status !== "queued")
    throw new Error(`task ${task.id} is already ${task.status}`);
  if (typeof args.owner !== "string" || !args.owner.trim())
    throw new Error("--owner is required");
  if (typeof args.worktree !== "string" || !path.isAbsolute(args.worktree)) {
    throw new Error("--worktree must be an absolute path");
  }
  const byId = new Map(allTasks().map((item) => [item.id, item]));
  const dependencies = dependenciesReady(task, byId);
  if (!dependencies.ready)
    throw new Error(`task is blocked by: ${dependencies.blocked.join(", ")}`);
  const branch =
    typeof args.branch === "string" ? args.branch : `task/${task.id}`;
  const worktree = path.resolve(args.worktree);
  if (fs.existsSync(worktree))
    throw new Error(`worktree path already exists: ${worktree}`);
  const baseCommit = git(ROOT, ["rev-parse", "HEAD"]);
  execFileSync("git", ["worktree", "add", "-b", branch, worktree, baseCommit], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const claimed = transition(task, "claimed");
  claimed.claim = { owner: args.owner.trim(), branch, worktree, baseCommit };
  saveTask(claimed);
  saveTask(claimed, worktree);
  console.log(`[task] claimed ${task.id} in ${worktree}`);
}

function commandApprove(args) {
  const task = loadTask(requireId(args));
  if (!new Set(["plan", "verification"]).has(args.artifact)) {
    throw new Error("--artifact must be plan or verification");
  }
  if (typeof args.file !== "string" || typeof args.by !== "string") {
    throw new Error("--file and --by are required");
  }
  const artifact = taskArtifactFile(task, args.file);
  const approved = approveArtifact(
    task,
    args.artifact,
    artifact.relative,
    fs.readFileSync(artifact.absolute, "utf8"),
    args.by.trim(),
    new Date().toISOString(),
  );
  saveTask(approved);
  console.log(`[task] approved ${args.artifact} for ${task.id}`);
}

function commandAttachEvidence(args) {
  const task = loadTask(requireId(args));
  if (typeof args.file !== "string") throw new Error("--file is required");
  const artifact = repoFile(args.file);
  task.evidence = {
    path: artifact.relative,
    sha256: contentHash(fs.readFileSync(artifact.absolute, "utf8")),
  };
  saveTask(task);
  console.log(`[task] attached evidence for ${task.id}`);
}

function gitLines(root, args) {
  const result = git(root, args);
  return result ? result.split(/\r?\n/).filter(Boolean) : [];
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function runShell(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runScoped(task, cwd, files) {
  const run = runShell(
    `${task.sourceTdd.testCommand} ${files.map(shellQuote).join(" ")}`,
    cwd,
  );
  if (task.sourceTdd.testRanPattern) {
    const pattern = new RegExp(task.sourceTdd.testRanPattern);
    if (!pattern.test(run.output)) return { ...run, code: 1, noTests: true };
  }
  return run;
}

function auditSourceTdd(task) {
  if (!task.claim?.worktree || !task.claim?.branch || !task.claim?.baseCommit) {
    throw new Error(
      "source-tdd task requires a claimed worktree, branch, and base commit",
    );
  }
  if (!task.sourceTdd?.testCommand)
    throw new Error("source-tdd task has no test command");
  const root = task.claim.worktree;
  const commits = gitLines(root, [
    "rev-list",
    "--reverse",
    `${task.claim.baseCommit}..${task.claim.branch}`,
  ]);
  const phases = commits.flatMap((sha) => {
    const value = git(root, [
      "show",
      "-s",
      "--format=%(trailers:key=Harness-Phase,valueonly)",
      sha,
    ]);
    return value ? [{ sha, value }] : [];
  });
  const groups = groupSourceTddPhases(phases);
  if (groups.length === 0)
    throw new Error("source-tdd task has no Harness-Phase ledger entries");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "harness-source-tdd-"));
  try {
    execFileSync(
      "git",
      ["worktree", "add", "--detach", scratch, task.claim.branch],
      {
        cwd: root,
        stdio: "pipe",
      },
    );
    if (task.sourceTdd.setupCommand) {
      const setup = runShell(task.sourceTdd.setupCommand, scratch);
      if (setup.code !== 0)
        throw new Error("source-tdd setup command failed in fresh worktree");
    }
    const results = groups.map((group) => {
      const files = gitLines(root, [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        group.red,
      ]);
      if (files.length === 0 || files.some((file) => !isTestPath(file))) {
        throw new Error(
          `${group.behavior} RED must change one or more test files only`,
        );
      }
      execFileSync("git", ["checkout", "--detach", group.red], {
        cwd: scratch,
        stdio: "pipe",
      });
      const red = runScoped(task, scratch, files);
      const unchanged =
        spawnSync(
          "git",
          ["diff", "--quiet", `${group.red}..${group.green}`, "--", ...files],
          { cwd: root },
        ).status === 0;
      execFileSync("git", ["checkout", "--detach", group.green], {
        cwd: scratch,
        stdio: "pipe",
      });
      const green = runScoped(task, scratch, files);
      const refactors = group.refactors.map((sha) => {
        const unchangedTest =
          spawnSync(
            "git",
            ["diff", "--quiet", `${sha}^..${sha}`, "--", ...files],
            { cwd: root },
          ).status === 0;
        execFileSync("git", ["checkout", "--detach", sha], {
          cwd: scratch,
          stdio: "pipe",
        });
        const result = runScoped(task, scratch, files);
        return { sha, ok: unchangedTest && result.code === 0 };
      });
      return {
        behavior: group.behavior,
        red: group.red,
        green: group.green,
        ok:
          red.code !== 0 &&
          !red.noTests &&
          unchanged &&
          green.code === 0 &&
          !green.noTests &&
          refactors.every((item) => item.ok),
        refactors,
      };
    });
    const failed = results.filter((result) => !result.ok);
    if (failed.length)
      throw new Error(
        `source-tdd replay failed: ${failed.map((result) => result.behavior).join(", ")}`,
      );
    return {
      version: 1,
      task: task.id,
      proofMode: "source-tdd",
      verifiedAt: new Date().toISOString(),
      behaviors: results,
    };
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", scratch], {
        cwd: root,
        stdio: "pipe",
      });
    } catch {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function commandVerify(args) {
  const task = loadTask(requireId(args));
  if (task.status !== "claimed")
    throw new Error(`task ${task.id} must be claimed before verification`);
  if (typeof args.plan !== "string") throw new Error("--plan is required");
  validateRequirementDigests(task, requirementRegistry());
  const plan = taskArtifactFile(task, args.plan);
  const planApproval = approvalState(
    task,
    "plan",
    plan.relative,
    fs.readFileSync(plan.absolute, "utf8"),
  );
  if (!planApproval.ok) throw new Error(planApproval.reason);
  if (task.proofMode === "automation-evidence") {
    if (!task.evidence)
      throw new Error(
        "automation-evidence tasks require attached runner evidence",
      );
    const evidence = repoFile(task.evidence.path);
    const evidenceState = approvalState(
      { approvals: { evidence: task.evidence } },
      "evidence",
      evidence.relative,
      fs.readFileSync(evidence.absolute, "utf8"),
    );
    if (!evidenceState.ok)
      throw new Error(
        "attached evidence changed after verification attachment",
      );
  }
  if (task.proofMode === "no-test") {
    if (
      !task.claim?.baseCommit ||
      !task.claim?.branch ||
      !task.claim?.worktree
    ) {
      throw new Error(
        "no-test task requires its claimed worktree and base commit",
      );
    }
    const changed = gitLines(task.claim.worktree, [
      "diff",
      "--name-only",
      `${task.claim.baseCommit}..${task.claim.branch}`,
    ]);
    const nonDocumentation = changed.filter(
      (file) => !isDocumentationPath(file),
    );
    if (nonDocumentation.length) {
      throw new Error(
        `no-test tasks may change Markdown only: ${nonDocumentation.join(", ")}`,
      );
    }
  }
  if (task.proofMode === "source-tdd") {
    const report = auditSourceTdd(task);
    const reportPath = path.join(ROOT, TASK_ROOT, `${task.id}.source-tdd.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    task.evidence = {
      path: path.relative(ROOT, reportPath).replaceAll("\\", "/"),
      sha256: contentHash(fs.readFileSync(reportPath, "utf8")),
    };
  }
  task.verifiedCommit = git(ROOT, ["rev-parse", "HEAD"]);
  const verified = transition(task, "verified");
  saveTask(verified);
  console.log(`[task] verified ${task.id}`);
}

function commandLand(args) {
  const task = loadTask(requireId(args));
  if (typeof args.merge !== "string" || !/^[0-9a-f]{7,64}$/i.test(args.merge)) {
    throw new Error("--merge must be a commit SHA");
  }
  const landed = transition(task, "landed");
  landed.mergeCommit = args.merge;
  saveTask(landed);
  console.log(`[task] marked ${task.id} landed at ${args.merge}`);
}

function commandStatus(args) {
  const tasks = args.id ? [loadTask(args.id)] : allTasks();
  if (tasks.length === 0) return console.log("[task] no tasks recorded");
  for (const task of tasks) {
    console.log(
      `${task.id}\t${task.status}\t${task.proofMode}\t${task.requirements.join(",")}`,
    );
  }
}

async function main() {
  const [command, ...tokens] = process.argv.slice(2);
  const args = parseArgs(tokens);
  switch (command) {
    case "new":
      return commandNew(args);
    case "claim":
      return commandClaim(args);
    case "approve":
      return commandApprove(args);
    case "attach-evidence":
      return commandAttachEvidence(args);
    case "verify":
      return commandVerify(args);
    case "land":
      return commandLand(args);
    case "status":
      return commandStatus(args);
    default:
      usage();
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[task] ${error.message}`);
  process.exitCode = 1;
});
