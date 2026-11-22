#!/usr/bin/env node
// SessionStart: tells the agent (and through it the human) what the harness last found, before any
// work starts. Reads evidence/gaps.json, which the doctor writes locally and in CI. Notifies only, so it
// always exits 0; a stale or missing report is itself reported, never treated as "no gaps".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const STALE_HOURS = 24;
let report;
try {
  report = JSON.parse(
    fs.readFileSync(path.join(root, "evidence", "gaps.json"), "utf8"),
  );
} catch {
  console.log(
    "[harness] No gap report yet. Run `node scripts/engine/doctor.mjs` before starting work.",
  );
  process.exit(0);
}
const age = (Date.now() - Date.parse(report.generatedAt)) / 3600000;
const { blocking = 0, total = 0 } = report.summary ?? {};
const lines = [
  `[harness] Gap report from ${Math.round(age)}h ago: ${blocking} blocking, ${total - blocking} to decide.${age > STALE_HOURS ? " It is stale: run `node scripts/engine/doctor.mjs` (add --heal for safe repairs)." : ""}`,
  ...(report.gaps ?? [])
    .sort(
      (a, b) =>
        (a.severity === "block" ? -1 : 1) - (b.severity === "block" ? -1 : 1),
    )
    .slice(0, 8)
    .map(
      (g) =>
        `- ${g.severity === "block" ? "BLOCK" : "warn"} [${g.area}] ${g.detail} → ${g.fix}`,
    ),
];
if (total > 8) lines.push(`- …and ${total - 8} more in evidence/gaps.json`);
if (blocking)
  lines.push(
    "Resolve blocking gaps before new work, or say why this task is unrelated to them.",
  );
console.log(lines.join("\n"));
process.exit(0);
