#!/usr/bin/env node
// The overlay installer against a synthetic foreign repo.
//
// Four properties, and the last two are the ones that were broken before this test existed:
// a dry run writes nothing, a second apply is a no-op, a changed engine file UPGRADES rather than
// being refused as consumer-owned, and a file the consumer had first is never touched.
//
// The upgrade case is why the install record exists. Classifying overlay files by a GENERATED-marker
// heuristic called an installed engine file "the consumer's", so the second install of a changed
// engine file was reported as a conflict and refused — installable once, never updatable, which is
// the vendored-drift failure this extraction existed to prevent, one layer up.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "..", "..");
const INSTALLER = path.join(HERE, "install-overlay.mjs");
const config = JSON.parse(
  fs.readFileSync(path.join(SOURCE, "harness.config.json"), "utf8"),
);
const { framework } = config;

function install(target, profile, ...flags) {
  return execFileSync(
    process.execPath,
    [INSTALLER, "--target", target, "--profile", profile, ...flags],
    { encoding: "utf8", cwd: SOURCE },
  );
}

// A repo shaped like a real consumer: its own tree, its own runner config, its own CLAUDE.md.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-test-"));
  for (const directory of [
    "e2e/config",
    "e2e/pages",
    "e2e/tests",
    "e2e/support/steps",
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, "package.json"),
    '{ "name": "consumer", "scripts": { "verify": "yarn test" } }\n',
  );
  fs.writeFileSync(
    path.join(root, "CLAUDE.md"),
    "# Consumer\n\nOur own rules.\n",
  );
  const profile = path.join(root, "profile.json");
  fs.writeFileSync(
    profile,
    `${JSON.stringify(
      {
        key: "consumer",
        displayName: "Consumer",
        owner: "A Person",
        repo: root,
        adapter: framework,
        language: "typescript",
        projectName: "consumer-automation",
        pattern: "bdd-pom",
        paths: {
          testRoot: "e2e",
          configRoot: "e2e/config",
          commandRoot: "e2e/pages",
          specGlob: `e2e/tests/**/*.${framework === "cypress" ? "cy.js" : "spec.ts"}`,
          stepRoot: "e2e/support/steps",
        },
        adapters: { claude: { enabled: true } },
      },
      null,
      2,
    )}\n`,
  );
  return { root, profile };
}

const { root, profile } = fixture();
try {
  // 1. Dry run writes nothing at all.
  const dry = install(root, profile);
  assert.match(
    dry,
    /Dry run/,
    "the default run must announce itself as a dry run",
  );
  assert.ok(
    !fs.existsSync(path.join(root, ".claude", "hooks", "rule-engine.mjs")),
    "a dry run must not write",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"),
    "# Consumer\n\nOur own rules.\n",
    "a dry run must not touch CLAUDE.md",
  );

  // 2. Apply installs, and the consumer's own files survive.
  install(root, profile, "--apply");
  assert.ok(
    fs.existsSync(path.join(root, ".claude", "hooks", "rule-engine.mjs")),
    "apply must install the engine",
  );
  assert.match(
    fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"),
    /Our own rules[\s\S]*HARNESS:RULES:START/,
    "the consumer's CLAUDE.md content must survive, with the block appended after it",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
    '{ "name": "consumer", "scripts": { "verify": "yarn test" } }\n',
    "package.json is the consumer's verify chain and must never be edited",
  );

  // 3. A second apply is a no-op. Before the install record, this reported writing a file every
  //    time because the profile was rewritten unconditionally and always counted.
  const second = install(root, profile, "--apply");
  assert.match(
    second,
    /wrote 0 file\(s\)/,
    `a second apply must write nothing; got:\n${second}`,
  );
  assert.match(
    second,
    /already carries the markers/,
    "a second apply must leave CLAUDE.md alone",
  );

  // 4. Upgrade: an engine file that changed at source is the overlay's, and is replaced.
  const engineFile = path.join(root, ".claude", "hooks", "rule-engine.mjs");
  fs.writeFileSync(engineFile, "// stale copy\n", "utf8");
  const upgrade = install(root, profile, "--apply");
  assert.match(
    upgrade,
    /update .*rule-engine\.mjs/,
    "a recorded engine file must upgrade, not be refused as consumer-owned",
  );
  assert.equal(
    fs.readFileSync(engineFile, "utf8"),
    fs.readFileSync(
      path.join(SOURCE, ".claude", "hooks", "rule-engine.mjs"),
      "utf8",
    ),
    "the upgraded file must match source exactly",
  );

  // 5. A file the consumer had first, at a manifest path, is refused rather than overwritten.
  const { root: fresh, profile: freshProfile } = fixture();
  try {
    const claimed = path.join(fresh, "harness", "qa-automation-foundations.md");
    fs.mkdirSync(path.dirname(claimed), { recursive: true });
    fs.writeFileSync(claimed, "# ours, predating the harness\n", "utf8");
    let refused = false;
    try {
      install(fresh, freshProfile, "--apply");
    } catch (error) {
      refused = true;
      assert.match(
        `${error.stdout ?? ""}${error.stderr ?? ""}`,
        /refusing/,
        "the refusal must say why",
      );
    }
    assert.ok(
      refused,
      "an unrecorded consumer file at a manifest path must stop the install",
    );
    assert.equal(
      fs.readFileSync(claimed, "utf8"),
      "# ours, predating the harness\n",
      "and must be left exactly as it was",
    );
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }

  console.log(
    "[install:test] dry run, apply, idempotent re-apply, engine upgrade, and consumer-file " +
      "refusal all verified",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
