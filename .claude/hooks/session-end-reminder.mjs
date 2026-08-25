#!/usr/bin/env node
/**
 * Stop hook: if this session touched test code, remind the author what the gate will check.
 *
 * Framework-neutral by derivation. Both adapters used to keep their own copy, and each hardcoded
 * two things: the test root (`/playwright\//`, `/cypress\//`) and a checklist of rules. Both were
 * restatements of `harness.config.json`, and both had drifted from it — the Playwright copy listed
 * five items when that adapter enforces nine block rules, so the reminder omitted rules the hook
 * would actually refuse a write for.
 *
 * The scope and the checklist now come from the composed config, which is the same source the rules
 * themselves come from. One owner, and the reminder cannot fall behind the policy it describes.
 *
 * A reminder that cannot read its config stays quiet rather than crashing the end of a session.
 * This is advisory output; the hooks and CI are the enforcement.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function runGit(command) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

let config;
try {
  config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "harness.config.json"), "utf8"),
  );
} catch {
  process.exit(0);
}

const testRoot = config.project?.testRoot;
if (!testRoot) process.exit(0);

const changed = [
  runGit("git diff --name-only HEAD"),
  runGit("git ls-files --others --exclude-standard"),
]
  .filter(Boolean)
  .join("\n");

// Only the declared test root, so a project that keeps its suite in `e2e/` is served as well as one
// that keeps it in `playwright/`.
const touched = changed
  .split("\n")
  .some((file) => file.replaceAll("\\", "/").startsWith(`${testRoot}/`));
if (!touched) process.exit(0);

// The checklist is the config's own block rules. A rule added to policy shows up here on the next
// session with nothing to remember.
const blocking = (config.rules ?? []).filter(
  (rule) => rule.severity === "block",
);

const line = "━".repeat(50);
console.log("");
console.log(line);
console.log(`  Session ended with changes under ${testRoot}/.`);
console.log("");
console.log("  Before opening a PR, run:");
console.log("  → pre-merge-qa-gate agent   full QA verdict");
if (blocking.length > 0) {
  console.log("");
  console.log(`  Pre-merge checklist (${blocking.length} block rule(s)):`);
  for (const rule of blocking) {
    console.log(`  [ ] never ${rule.never} — use ${rule.instead}`);
  }
}
console.log(line);
console.log("");

process.exit(0);
