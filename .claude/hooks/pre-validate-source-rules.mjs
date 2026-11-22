#!/usr/bin/env node
// Write-time gate for dev lanes (PreToolUse on Edit|Write). Blocks a proposed change that adds a rule
// violation; legacy lines in the baseline and human-recorded waivers pass. Exit 2 blocks the write.
// Fail closed: input this hook cannot read is a block, never a silent allow.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatViolation } from "./rule-engine.mjs";
import { extractToolChange, scanContent } from "./source-rules.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const block = (lines) => {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(2);
};

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let toolData;
try {
  toolData = JSON.parse(raw);
} catch {
  block([
    "❌ [PRE-CHECK] the hook could not read the tool input, so the write is blocked rather than unchecked.",
  ]);
}

let change;
try {
  change = extractToolChange(toolData, repoRoot);
} catch (error) {
  block([`❌ [PRE-CHECK] ${error.message}; write blocked.`]);
}
if (!change.filePath || !change.content) process.exit(0); // not a file write

const violations = scanContent(change.filePath, change.content, null, repoRoot);
if (violations.length === 0) process.exit(0);
block([
  "❌ [PRE-CHECK] Rule violations in the proposed change — write BLOCKED.",
  ...violations.map(formatViolation),
]);
