#!/usr/bin/env node
/**
 * Install the harness into a repository that already has its own test suite.
 *
 *   node scripts/engine/install-overlay.mjs --target <repo> --profile <profile.json>
 *   node scripts/engine/install-overlay.mjs --target <repo> --profile <profile.json> --apply
 *
 * This is the thing whose absence caused the whole exercise. `sync.mjs` writes only into its own
 * repo, so the harness could be cloned or forked but never *added* — and adopting a fork meant
 * adopting a whole boilerplate's architecture with it. Laudio's five objections were all objections
 * to that, not to the harness.
 *
 * What it installs is the governance layer and nothing else: the engine, the adapter's rule
 * patterns and agent sources, the composed config, and the generated AI-tool projections. What it
 * must never install is anything that decides how the consumer's tests are written or run — no
 * runner config, no folder tree, no package.json, no lint or type-check config, no fixture, helper,
 * page object or spec. Conformance spec §5.
 *
 * Dry run by default. Every write is announced first, and a file the consumer owns is never
 * overwritten: only files carrying a GENERATED marker, plus marker-delimited blocks inside files
 * the consumer keeps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson } from "../lib/cli.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "..", "..");

const RULES_BEGIN = "<!-- HARNESS:RULES:START -->";
const RULES_END = "<!-- HARNESS:RULES:END -->";

/**
 * The overlay manifest. Directories are copied whole; files individually. `framework` is
 * substituted so an adapter's own names resolve.
 *
 * Deliberately absent: everything under the test root, the runner config, package.json, and every
 * formatting or type-check config. If a path here ever needs one of those, the layer boundary has
 * been crossed and the answer is not to add it.
 */
function manifest(framework) {
  return [
    // L1 engine, vendored.
    "scripts/engine/",
    "scripts/lib/",
    "scripts/evidence.mjs",
    "scripts/record-evidence.mjs",
    "scripts/backfill-ci-evidence.mjs",
    "scripts/check-requirement-consistency.mjs",
    "harness/concerns.mjs",
    "harness/patterns.mjs",
    "harness/engine-version.json",
    ".claude/hooks/rule-engine.mjs",
    ".claude/hooks/harness-config-gate.mjs",
    ".claude/hooks/prompt-duplication-guard.mjs",
    ".claude/hooks/session-end-reminder.mjs",
    // L2 adapter: rule patterns, wiring, and the agent sources sync projects.
    ".claude/hooks/shared-rules.mjs",
    `.claude/hooks/${framework}.patterns.mjs`,
    `.claude/hooks/${framework}-hook-allowlist.json`,
    `.claude/hooks/pre-validate-${framework}-rules.mjs`,
    `.claude/hooks/validate-${framework}-rules.mjs`,
    "harness/agents/",
    "harness/qa-automation-foundations.md",
    `harness/profiles/adapters/${framework}.json`,
    "harness/profiles/bin/",
    // Adapter skill canon, when the adapter has one. Cypress declares three skills whose sources
    // live here and which sync projects into .claude/skills; Playwright declares none.
    //
    // This line is the finding from the first second-adapter onboarding. The manifest had only ever
    // been exercised from Playwright, which declares no skills, so installing from Cypress produced
    // a config that referenced skill sources the overlay had not carried and `sync` failed
    // validating it. An adapter's optional payload is still its payload; walk() skips this when the
    // directory is absent.
    "harness/skills/",
  ];
}

function walk(absolute, base) {
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [base];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) =>
      walk(path.join(absolute, entry.name), path.join(base, entry.name)),
    );
}

/**
 * The install record: what this overlay put in the target, so a later run can tell its own files
 * from the consumer's.
 *
 * Without it there is no upgrade path. A GENERATED-marker heuristic classifies an engine file the
 * overlay installed as consumer-owned, so the second install of a *changed* engine file is reported
 * as a conflict and refused — the harness installs once and can never be updated, which is the
 * vendored-copies-drift failure this whole extraction existed to prevent, reintroduced one layer up.
 *
 * A path in the record is the overlay's and is overwritten. A path absent from the record but
 * present on disk is the consumer's and is never touched.
 */
const RECORD_PATH = path.join(".claude", "harness-overlay.json");

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function readRecord(root) {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(root, RECORD_PATH), "utf8"),
    );
    return new Set(record.installed ?? []);
  } catch {
    return new Set();
  }
}

const args = parseArgs(process.argv.slice(2));
const apply = process.argv.includes("--apply");
const target = args.target;
const profilePath = args.profile;

function fail(message) {
  console.error(`[install] ${message}`);
  process.exit(1);
}

if (!target) fail("--target <repo> is required");
if (!profilePath) {
  fail(
    "--profile <profile.json> is required. The overlay cannot invent the project's own facts: " +
      "its paths, architecture pattern, wiring and strategy are exactly what makes it adoptable.",
  );
}
const targetRoot = path.resolve(target);
if (!fs.existsSync(targetRoot)) fail(`target does not exist: ${targetRoot}`);
if (targetRoot === SOURCE)
  fail("target is the source repo; nothing to install");

const profile = readJson(path.resolve(profilePath));
const framework = readJson(path.join(SOURCE, "harness.config.json")).framework;
if (profile.adapter !== framework) {
  fail(
    `profile declares adapter "${profile.adapter}" but this source repo is the "${framework}" ` +
      `adapter. Install from the boilerplate matching the profile's adapter.`,
  );
}

// 1. Resolve the file list, and refuse up front if anything would clobber consumer-owned content.
const files = manifest(framework).flatMap((entry) =>
  walk(path.join(SOURCE, entry), entry.replace(/\/$/, "")),
);
if (files.length === 0) fail("manifest resolved to no files");

function engineVersion(root) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(root, "harness", "engine-version.json"),
        "utf8",
      ),
    ).version;
  } catch {
    return null;
  }
}

// Vendoring has no registry, so an upgrade is pull-based: whoever runs the installer from a current
// checkout is the one who moves the consumer forward. Naming both versions is what makes that an
// upgrade rather than an unexplained pile of file writes.
const sourceVersion = engineVersion(SOURCE);
const targetVersion = engineVersion(targetRoot);

const owned = readRecord(targetRoot);
const writes = [];
const conflicts = [];
for (const relative of files) {
  const from = path.join(SOURCE, relative);
  const to = path.join(targetRoot, relative);
  const next = fs.readFileSync(from, "utf8");
  if (!fs.existsSync(to)) {
    writes.push([relative, "new", next]);
    continue;
  }
  const current = fs.readFileSync(to, "utf8");
  if (current === next) continue;
  // Ours to replace if a previous install recorded it. Otherwise the consumer already had a file
  // at this path before the harness arrived, and that one is theirs.
  if (owned.has(toPosixPath(relative))) {
    writes.push([relative, "update", next]);
  } else {
    conflicts.push(relative);
  }
}

const profileTarget = path.join(
  "harness",
  "profiles",
  "projects",
  `${profile.key}.json`,
);
const profileText = `${JSON.stringify(profile, null, 2)}\n`;
const profileAbsolute = path.join(targetRoot, profileTarget);
const profileExists = fs.existsSync(profileAbsolute);
const profileChanged =
  !profileExists || fs.readFileSync(profileAbsolute, "utf8") !== profileText;

console.log(`[install] source   ${SOURCE}`);
console.log(`[install] target   ${targetRoot}`);
console.log(`[install] adapter  ${framework}`);
console.log(
  `[install] engine   ${sourceVersion ?? "unknown"}` +
    (targetVersion && targetVersion !== sourceVersion
      ? `  (upgrading target from ${targetVersion})`
      : targetVersion
        ? "  (target already at this version)"
        : "  (fresh install)"),
);
console.log(
  `[install] profile  ${profile.key} (pattern: ${profile.pattern ?? "adapter default"})`,
);
console.log("");
for (const [relative, kind] of writes)
  console.log(`  ${kind.padEnd(6)} ${relative}`);
if (profileChanged) {
  console.log(`  ${profileExists ? "update" : "new   "} ${profileTarget}`);
}
console.log(`  inject CLAUDE.md (between ${RULES_BEGIN} markers)`);

if (conflicts.length > 0) {
  console.error("");
  console.error(
    `[install] refusing: ${conflicts.length} file(s) exist in the target, differ from source, and ` +
      `are not listed in ${RECORD_PATH}. The overlay only replaces what it recorded installing, so ` +
      `these are treated as the consumer's and left alone:`,
  );
  for (const relative of conflicts) console.error(`    ${relative}`);
  console.error(
    `\nIf they really are yours, remove or rename them in the target. If a previous install put ` +
      `them there before ${RECORD_PATH} existed, delete them and re-run — the install is ` +
      `idempotent, so it will restore them and record them this time. If the overlay is claiming a ` +
      `path it should not own, the manifest is wrong.`,
  );
  process.exit(1);
}

console.log("");
if (!apply) {
  console.log(
    `[install] ${writes.length + (profileChanged ? 1 : 0)} file(s) to write. ` +
      `Dry run — pass --apply to write.`,
  );
  process.exit(0);
}

for (const [relative, , content] of writes) {
  const to = path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, content, "utf8");
}
if (profileChanged) {
  fs.mkdirSync(path.dirname(profileAbsolute), { recursive: true });
  fs.writeFileSync(profileAbsolute, profileText, "utf8");
}

// Record every path the overlay owns, so the next run upgrades them instead of mistaking them for
// the consumer's. This is what makes the install re-runnable at all.
const installed = [
  ...files.map(toPosixPath),
  toPosixPath(profileTarget),
  toPosixPath(RECORD_PATH),
].sort();
const recordAbsolute = path.join(targetRoot, RECORD_PATH);
fs.mkdirSync(path.dirname(recordAbsolute), { recursive: true });
fs.writeFileSync(
  recordAbsolute,
  `${JSON.stringify(
    {
      $comment:
        "GENERATED by scripts/engine/install-overlay.mjs. Lists the files this overlay owns, so a " +
        "later install upgrades them rather than treating them as yours. Do not edit by hand.",
      engineVersion: sourceVersion,
      adapter: framework,
      profile: profile.key,
      installed,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

// CLAUDE.md belongs to the consumer, so the rules block goes between markers and nothing else in
// the file is touched. A file with no markers gets the section appended; an absent file is created
// with just the section. `sync` fills the block from the composed config on every run afterwards.
const claudePath = path.join(targetRoot, "CLAUDE.md");
const section = [
  "## Harness rules",
  "",
  RULES_BEGIN,
  "<!-- Generated from harness.config.json — run the harness sync script. Do not edit by hand. -->",
  RULES_END,
  "",
].join("\n");

let claudeAction;
if (!fs.existsSync(claudePath)) {
  fs.writeFileSync(
    claudePath,
    `# ${profile.displayName ?? profile.key}\n\n${section}`,
    "utf8",
  );
  claudeAction = "created with a rules section";
} else {
  const current = fs.readFileSync(claudePath, "utf8");
  if (current.includes(RULES_BEGIN) && current.includes(RULES_END)) {
    claudeAction = "already carries the markers; left as-is";
  } else {
    fs.writeFileSync(claudePath, `${current.trimEnd()}\n\n${section}`, "utf8");
    claudeAction = "rules section appended; existing content untouched";
  }
}

console.log(
  `[install] wrote ${writes.length + (profileChanged ? 1 : 0)} file(s); ` +
    `${installed.length} path(s) recorded as overlay-owned.`,
);
console.log(`[install] CLAUDE.md: ${claudeAction}`);
console.log("");
console.log("Next, in the target repo:");
console.log(
  `  node harness/profiles/bin/compose-harness-config.mjs --profile ${profileTarget} --out harness.config.json`,
);
console.log(
  "  node scripts/engine/sync.mjs           # generate the AI-tool projections",
);
console.log(
  "  node scripts/engine/config-ready.mjs   # confirm the profile is complete",
);
console.log("  node scripts/engine/lock-profile.mjs   # then lock it");
console.log("");
console.log(
  "Then add one script entry and one CI step calling scripts/engine/check-drift.mjs and the " +
    "rules validator. The overlay does not edit package.json: the verify chain belongs to the " +
    "consumer, and one wrong edit there breaks a pipeline the harness does not own.",
);
