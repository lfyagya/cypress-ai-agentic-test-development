#!/usr/bin/env node
/**
 * Cypress rule validator.
 *
 * Hook mode reads a PostToolUse event from stdin.
 * --base-ref <ref> checks files changed from origin/<ref>.
 * --all checks every JavaScript file under cypress/.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTENSION_PATTERNS,
  extractToolChange,
  loadAllowlist,
  scanContent,
  toPosix,
} from "./shared-rules.mjs";
import { formatViolation } from "./rule-engine.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(directory, "..", "..");
const allowlist = loadAllowlist(
  path.resolve(directory, "cypress-hook-allowlist.json"),
);

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    // Must accept TypeScript too. Walking only .js meant a .cy.ts spec was never opened, so every
    // rule silently passed on it — the CI rescan and --all sweep both went blind on a TS repo.
    else if (
      entry.isFile() &&
      EXTENSION_PATTERNS.TARGET_FILE_RE.test(toPosix(full))
    )
      files.push(full);
  }
  return files;
}

function report(violations, label, failCode) {
  if (violations.length === 0) {
    console.log(`[${label}] All Cypress rule checks passed.`);
    process.exit(0);
  }
  console.error("");
  console.error(`❌ [${label}] Cypress rule violations detected:`);
  for (const violation of violations) {
    console.error(formatViolation(violation));
  }
  console.error("");
  process.exit(failCode);
}

const baseRefIndex = process.argv.indexOf("--base-ref");

if (process.argv.includes("--all")) {
  const violations = walk(path.join(repoRoot, "cypress")).flatMap((file) =>
    scanContent(file, fs.readFileSync(file, "utf8"), allowlist, repoRoot),
  );
  report(violations, "SCAN", 1);
} else if (baseRefIndex !== -1) {
  const baseRef = process.argv[baseRefIndex + 1];
  if (!baseRef) {
    console.error("Usage: node validate-cypress-rules.mjs --base-ref <ref>");
    process.exit(1);
  }

  let changedFiles;
  try {
    const diffOutput = execSync(
      `git diff --name-only --diff-filter=ACM origin/${baseRef}...HEAD`,
      { cwd: repoRoot, encoding: "utf8" },
    );
    changedFiles = diffOutput.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    console.error(`[CI] git diff failed: ${error.message}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log("[CI] No changed files — nothing to check.");
    process.exit(0);
  }

  const violations = changedFiles.flatMap((relativeFile) => {
    const absolutePath = path.resolve(repoRoot, relativeFile);
    if (!fs.existsSync(absolutePath)) return [];
    return scanContent(
      absolutePath,
      fs.readFileSync(absolutePath, "utf8"),
      allowlist,
      repoRoot,
    );
  });
  report(violations, "CI", 1);
} else {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let toolData;
  try {
    toolData = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const { filePath, content } = extractToolChange(toolData, repoRoot, {
    readCurrent: true,
  });
  if (!filePath || !content) process.exit(0);

  const violations = scanContent(filePath, content, allowlist, repoRoot);
  if (violations.length === 0) process.exit(0);

  console.error("");
  console.error(
    "❌ [POST-CHECK] Cypress rule violations detected in written file.",
  );
  for (const violation of violations) {
    console.error(formatViolation(violation));
  }
  console.error("");
  console.error("Correct these violations before committing.");
  process.exit(2);
}
