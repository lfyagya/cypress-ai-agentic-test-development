#!/usr/bin/env node
// Records a human decision that one rule finding on one line is a genuine exception.
//   node scripts/engine/waive.mjs --rule <id> --file <path> --line <n> --reason "<why>" --owner "<name>" [--days 30]
//   node scripts/engine/waive.mjs --list
// Human-only (needs an interactive terminal), so an agent cannot waive its own finding. The waiver is
// bound to the line's text: editing the line ends it. It expires after at most 90 days, and Tier 0
// rules (credentials, read-only production) can never be waived. CI rejects a malformed waiver.
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  MAX_WAIVER_DAYS,
  WAIVER_FILE,
  fingerprint,
  loadRuleMeta,
} from "../../.claude/hooks/rule-engine.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const fail = (message, code = 1) => {
  console.error(`waive: ${message}`);
  process.exit(code);
};
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const file = path.join(ROOT, WAIVER_FILE);
const data = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8"))
  : { version: 1, waivers: [] };

if (args.includes("--list")) {
  const now = Date.now();
  for (const w of data.waivers)
    console.log(
      `${Date.parse(w.expires) > now ? "active " : "EXPIRED"} ${w.expires.slice(0, 10)} ${w.rule} ${w.file}:${w.line} owner=${w.owner} — ${w.reason}`,
    );
  process.exit(0);
}

const rule = flag("--rule");
const target = flag("--file")?.replace(/\\/g, "/");
const line = Number(flag("--line"));
const reason = flag("--reason")?.trim() ?? "";
const owner = flag("--owner")?.trim() ?? "";
const days = Number(flag("--days") ?? 30);
if (!rule || !target || !Number.isInteger(line) || line < 1)
  fail(
    'usage: waive.mjs --rule <id> --file <path> --line <n> --reason "<why>" --owner "<name>" [--days 30]',
    2,
  );
const meta = loadRuleMeta(ROOT)[rule];
if (!meta) fail(`${rule} is not a rule this project declares`);
if (meta.tier === 0)
  fail(`${rule} is Tier 0 (a trust boundary); it cannot be waived. Fix it.`);
if (reason.length < 15)
  fail("--reason must say why this is an exception (at least 15 characters)");
if (!owner) fail("--owner names who removes the exception");
if (!(days >= 1 && days <= MAX_WAIVER_DAYS))
  fail(`--days must be 1 to ${MAX_WAIVER_DAYS}`);
if (!(process.stdin.isTTY && process.stdout.isTTY))
  fail("waivers are human-only: run this in an interactive terminal", 2);

let text;
try {
  text = fs.readFileSync(path.join(ROOT, target), "utf8").split(/\r?\n/)[
    line - 1
  ];
} catch {
  fail(`cannot read ${target}`);
}
if (text === undefined) fail(`${target} has no line ${line}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ok = (
  await rl.question(
    `Waive ${rule} for ${days} day(s), owner ${owner}:\n  ${target}:${line}  ${text.trim()}\n  reason: ${reason}\nType "approved": `,
  )
).trim();
rl.close();
if (ok !== "approved") fail("not approved");

const approvedAt = new Date();
const entry = {
  rule,
  file: target,
  line,
  fingerprint: fingerprint(rule, target, text),
  reason,
  owner,
  approvedBy: process.env.USERNAME || process.env.USER || "unknown",
  approvedAt: approvedAt.toISOString(),
  expires: new Date(approvedAt.getTime() + days * 86400000).toISOString(),
};
data.waivers = [
  ...data.waivers.filter((w) => w.fingerprint !== entry.fingerprint),
  entry,
];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  `[waive] ${rule} waived at ${target}:${line} until ${entry.expires.slice(0, 10)}. Commit ${WAIVER_FILE} with the change.`,
);
