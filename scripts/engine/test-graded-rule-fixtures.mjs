#!/usr/bin/env node
// Every rule declared `severity: "review"` must have a should-pass and a should-fail fixture, and
// every fixture must be able to reach the gate.
//
// The blocking rules already have this guard (test-block-rules-enforced.mjs): declare a block rule
// with no violating sample and the test fails. The graded rules had nothing. They are adjudicated by
// `pre-merge-qa-gate` — by model judgment — so a model upgrade or an edit to
// harness/qa-automation-foundations.md can silently change what the gate lets through, and no
// existing check would notice.
//
// This test cannot detect that drift; only running the gate can. What it does is keep the corpus
// honest so a gate run means something:
//
//   1. Coverage      — both polarities exist for every graded rule, and nothing stale lingers.
//   2. Reachability  — no fixture trips a BLOCKING rule at its declared path. This is the one that
//                      matters. A should-fail fixture that also contains, say, a hardcoded selector
//                      would be refused by the write-time hook and never reach the gate at all; the
//                      corpus would look populated and prove nothing.
//   3. Manifest ↔ disk — every entry has a file, every file has an entry.
//
// Run the corpus itself per harness/fixtures/graded-rules/README.md after any model or policy change.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanContent } from "../../.claude/hooks/shared-rules.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const corpus = path.join(root, "harness", "fixtures", "graded-rules");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "harness.config.json"), "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(corpus, "manifest.json"), "utf8"),
);
const allowlist = { selectors: new Set(), routes: new Set() };

const gradedRules = config.rules
  .filter((rule) => rule.severity === "review")
  .map((rule) => rule.id);

assert.ok(
  gradedRules.length > 0,
  "no graded rules found in harness.config.json",
);

// 1. Coverage: both polarities per graded rule, and no entry for a rule that is no longer graded.
for (const rule of gradedRules) {
  for (const polarity of ["pass", "fail"]) {
    const found = manifest.fixtures.some(
      (fixture) => fixture.rule === rule && fixture.polarity === polarity,
    );
    assert.ok(
      found,
      `graded rule "${rule}" has no ${polarity} fixture. Add one under ` +
        `harness/fixtures/graded-rules/${rule}/ and record its expected outcome in manifest.json — ` +
        "a graded rule with no corpus entry cannot be regression-tested after a model change.",
    );
  }
}
const stale = [
  ...new Set(manifest.fixtures.map((fixture) => fixture.rule)),
].filter((rule) => !gradedRules.includes(rule));
assert.deepEqual(
  stale,
  [],
  `manifest names rule(s) that are no longer "review" severity: ${stale.join(", ")}`,
);

// 2. Reachability: a fixture that a blocking rule would refuse never reaches the gate.
const unreachable = [];
for (const fixture of manifest.fixtures) {
  const file = path.join(corpus, fixture.file);
  assert.ok(
    fs.existsSync(file),
    `manifest lists a missing fixture: ${fixture.file}`,
  );
  const violations = scanContent(
    fixture.asIfPath,
    fs.readFileSync(file, "utf8"),
    allowlist,
    root,
  );
  if (violations.length > 0) {
    unreachable.push(
      `${fixture.file} → ${violations.length} blocking violation(s)`,
    );
  }
}
assert.deepEqual(
  unreachable,
  [],
  "fixture(s) trip a blocking rule and would be refused at write time, so the QA gate would never " +
    `grade them: ${unreachable.join("; ")}`,
);

// 3. Manifest <-> disk: an orphan fixture is one nobody diffs after a model change.
const onDisk = fs
  .readdirSync(corpus, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    fs
      .readdirSync(path.join(corpus, dir.name))
      .map((name) => `${dir.name}/${name}`),
  )
  .sort();
const listed = manifest.fixtures.map((fixture) => fixture.file).sort();
assert.deepEqual(
  onDisk,
  listed,
  "fixture files on disk and manifest entries disagree — every fixture needs a recorded expectation",
);

// 4. Each entry states an expectation the diff can actually compare.
for (const fixture of manifest.fixtures) {
  assert.ok(fixture.why, `${fixture.file} has no "why"`);
  assert.ok(
    ["PASS", "PASS_WITH_ACTIONS", "BLOCK"].includes(fixture.expect.verdict),
    `${fixture.file} has an unknown expected verdict: ${fixture.expect.verdict}`,
  );
  const expectedFinding = fixture.polarity === "fail" ? fixture.rule : null;
  assert.equal(
    fixture.expect.finding,
    expectedFinding,
    `${fixture.file} is a ${fixture.polarity} fixture, so expect.finding must be ` +
      `${expectedFinding === null ? "null" : `"${expectedFinding}"`}`,
  );
}

console.log(
  `[graded-fixtures] ${gradedRules.length} graded rule(s), ${manifest.fixtures.length} fixture(s); ` +
    "both polarities present, all reachable by the gate, manifest matches disk",
);
