#!/usr/bin/env node
// The one rules check behind every surface that is not a write-time hook: the git gate (pre-commit,
// pre-push), CI and a person at a terminal. It runs the lane adapter's own scanner (shared-rules.mjs
// for test lanes, the engine's source-rules.mjs for dev lanes) through the engine's makeScanner, so
// the baseline ratchet, waivers and fix messages are identical on every surface.
//
//   --staged                 the index (pre-commit)
//   --range <from>..<to>     files changed in a commit range, read at <to> (pre-push)
//   --base <ref>             files changed since the merge base with <ref> (CI); also fails if the
//                            baseline grew or a waiver is malformed
//   --all                    every tracked file in scope
//   --repo <dir>             the git repo to read (a workspace lane); default: the project root
//   --write-baseline         human-only: record today's violations so legacy code passes until touched.
//                            Shrink-only once a baseline exists. Tier 0 findings are never recorded.
//   --json                   machine output (doctor, CI summaries)
//
// Exit 0 = clean, 1 = violations, 2 = usage or an internal error. Never allows on an error.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BASELINE_FILE,
  MAX_WAIVER_DAYS,
  WAIVER_FILE,
  formatViolation,
  loadAllowlist,
  loadRuleMeta,
} from "../../.claude/hooks/rule-engine.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const fail = (message, code = 2) => {
  console.error(`check-rules: ${message}`);
  process.exit(code);
};
const toPosix = (p) => p.replace(/\\/g, "/");

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function readConfig(root = ROOT) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, "harness.config.json"), "utf8"),
    );
  } catch (error) {
    throw new Error(
      `harness.config.json is missing or unreadable: ${error.message}`,
      { cause: error },
    );
  }
}

/** The lane adapter's scanner: the engine's source rules for dev lanes, the adapter's own otherwise. */
export async function loadScanner(root = ROOT, config = readConfig(root)) {
  const module =
    config.framework === "source" ? "source-rules.mjs" : "shared-rules.mjs";
  const file = path.join(root, ".claude", "hooks", module);
  if (!fs.existsSync(file))
    throw new Error(
      `${toPosix(path.relative(root, file))} is missing; the ${config.framework} adapter supplies it`,
    );
  const { scanContent } = await import(pathToFileURL(file));
  const allowlist = loadAllowlist(
    path.join(
      root,
      ".claude",
      "hooks",
      `${config.framework}-hook-allowlist.json`,
    ),
  );
  return (rel, content) => scanContent(rel, content, allowlist, root);
}

// [{ rel (to the project root), read: () => content }] for the selected files.
function selectFiles(opts, root) {
  const repo = path.resolve(opts.repo ?? root);
  const prefix = toPosix(path.relative(root, repo));
  const rel = (f) => (prefix ? `${prefix}/${f}` : f);
  const at = (ref) => (f) => () => git(["show", `${ref}:${f}`], repo);
  if (opts.staged) {
    const files = lines(
      git(["diff", "--cached", "--name-only", "--diff-filter=d"], repo),
    );
    return files.map((f) => ({
      rel: rel(f),
      read: () => git(["show", `:${f}`], repo),
    }));
  }
  if (opts.range) {
    const [from, to] = opts.range.split("..");
    const files = lines(
      git(["diff", "--name-only", "--diff-filter=d", `${from}..${to}`], repo),
    );
    return files.map((f) => ({ rel: rel(f), read: at(to)(f) }));
  }
  if (opts.base) {
    const mergeBase = git(["merge-base", opts.base, "HEAD"], repo).trim();
    const files = lines(
      git(
        ["diff", "--name-only", "--diff-filter=d", `${mergeBase}..HEAD`],
        repo,
      ),
    );
    return files.map((f) => ({ rel: rel(f), read: at("HEAD")(f) }));
  }
  return lines(git(["ls-files"], repo)).map((f) => ({
    rel: rel(f),
    read: () => fs.readFileSync(path.join(repo, f), "utf8"),
  }));
}

export async function scanFiles(files, root = ROOT) {
  const scan = await loadScanner(root);
  const violations = [];
  for (const file of files) {
    let content;
    try {
      content = file.read();
    } catch {
      continue; // not present at that ref (renamed away)
    }
    if (content.includes("\0")) continue; // binary
    violations.push(...scan(file.rel, content));
  }
  return violations;
}

/** Waiver entries that are malformed, too long, or try to waive a trust boundary. */
export function waiverIssues(root = ROOT) {
  const file = path.join(root, WAIVER_FILE);
  if (!fs.existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [`${WAIVER_FILE} is not valid JSON`];
  }
  const meta = loadRuleMeta(root);
  const issues = [];
  for (const [i, w] of (data.waivers ?? []).entries()) {
    const at = `${WAIVER_FILE} waivers[${i}] (${w.rule} ${w.file}:${w.line})`;
    for (const key of [
      "rule",
      "file",
      "fingerprint",
      "reason",
      "owner",
      "approvedBy",
      "approvedAt",
      "expires",
    ])
      if (!w[key]) issues.push(`${at}: ${key} is missing`);
    if (meta[w.rule]?.tier === 0)
      issues.push(`${at}: ${w.rule} is Tier 0 and can never be waived`);
    const days = (Date.parse(w.expires) - Date.parse(w.approvedAt)) / 86400000;
    if (!(days > 0 && days <= MAX_WAIVER_DAYS))
      issues.push(`${at}: a waiver lasts 1 to ${MAX_WAIVER_DAYS} days`);
  }
  return issues;
}

/** Baseline fingerprints present now but not at <ref>: the baseline may only shrink. */
export function baselineGrowth(ref, root = ROOT) {
  const now = fs.existsSync(path.join(root, BASELINE_FILE))
    ? (JSON.parse(fs.readFileSync(path.join(root, BASELINE_FILE), "utf8"))
        .entries ?? [])
    : [];
  let before;
  try {
    before =
      JSON.parse(git(["show", `${ref}:${BASELINE_FILE}`], root)).entries ?? [];
  } catch {
    return []; // no baseline at the base: this change is the adoption that records it
  }
  const known = new Set(before.map((e) => e.fingerprint));
  return now.filter((e) => !known.has(e.fingerprint));
}

async function writeBaseline(root) {
  if (!(process.stdin.isTTY && process.stdout.isTTY))
    fail("--write-baseline is human-only: run it in an interactive terminal");
  process.env.HARNESS_IGNORE_BASELINE = "1"; // see every current finding, not only the new ones
  const all = await scanFiles(selectFiles({}, root), root);
  const meta = loadRuleMeta(root);
  const tier0 = all.filter((v) => meta[v.ruleId]?.tier === 0);
  if (tier0.length)
    fail(
      `fix the Tier 0 findings first; they are never baselined:\n${tier0.map(formatViolation).join("\n")}`,
      1,
    );
  const entries = all.map((v) => ({
    rule: v.ruleId,
    file: v.filePath,
    line: v.lineNumber,
    fingerprint: v.fingerprint,
  }));
  const file = path.join(root, BASELINE_FILE);
  if (fs.existsSync(file)) {
    const known = new Set(
      (JSON.parse(fs.readFileSync(file, "utf8")).entries ?? []).map(
        (e) => e.fingerprint,
      ),
    );
    const grew = entries.filter((e) => !known.has(e.fingerprint));
    if (grew.length)
      fail(
        `the baseline may only shrink; these are new findings, fix them instead:\n${grew.map((e) => `- ${e.file}:${e.line} [${e.rule}]`).join("\n")}`,
        1,
      );
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const owner = (
    await rl.question(
      `Record ${entries.length} legacy finding(s) as the baseline. Owner who burns it down: `,
    )
  ).trim();
  const ok = (await rl.question('Type "approved": ')).trim();
  rl.close();
  if (!owner || ok !== "approved") fail("not recorded", 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ version: 1, owner, recordedBy: process.env.USERNAME || process.env.USER || "unknown", recordedAt: new Date().toISOString(), entries }, null, 2)}\n`,
  );
  console.log(
    `[rules] baseline recorded: ${entries.length} legacy finding(s). It may only shrink from here.`,
  );
}

function parse(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--range", "--base", "--repo"].includes(a))
      opts[a.slice(2)] = argv[++i];
    else if (["--staged", "--all", "--json", "--write-baseline"].includes(a))
      opts[a.slice(2).replace("-b", "B")] = true;
    else fail(`unknown argument ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  if (opts.writeBaseline) return writeBaseline(ROOT);
  if (!opts.staged && !opts.range && !opts.base && !opts.all)
    fail("choose --staged, --range <a>..<b>, --base <ref> or --all");
  const violations = await scanFiles(selectFiles(opts, ROOT), ROOT);
  const problems = [...waiverIssues(ROOT)];
  if (opts.base)
    for (const e of baselineGrowth(
      git(["merge-base", opts.base, "HEAD"], ROOT).trim(),
      ROOT,
    ))
      problems.push(
        `${BASELINE_FILE} grew (${e.rule} ${e.file}:${e.line}); the baseline may only shrink — fix the finding instead`,
      );
  if (opts.json) {
    console.log(JSON.stringify({ violations, problems }, null, 2));
  } else if (violations.length || problems.length) {
    console.error(
      [
        "❌ Rule check failed — fix these, then retry.",
        ...violations.map(formatViolation),
        ...problems.map((p) => `- ${p}`),
      ].join("\n"),
    );
  } else {
    console.log("[rules] clean");
  }
  process.exit(violations.length || problems.length ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => fail(error.message));
