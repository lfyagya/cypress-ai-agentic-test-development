#!/usr/bin/env node
// Focused coverage for cross-file and cross-branch requirement consistency.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkRequirements,
  findDivergentRequirements,
  findUnknownSpecRequirementIds,
  loadBaseRequirements,
  resolveBaseRef,
  validateLocalRequirements,
} from "../check-requirement-consistency.mjs";

const requirement = (overrides = {}) => ({
  id: "AE-PRODUCTS-001",
  module: "products",
  title: "catalog API returns products",
  expectedOutcome: "products returned",
  acceptanceCriteria: ["HTTP 200"],
  preconditions: ["API reachable"],
  status: "active",
  ...overrides,
});

const original = requirement();
assert.deepEqual(
  findDivergentRequirements([original], [{ ...original }]),
  [],
  "an unchanged requirement id must be allowed",
);
assert.deepEqual(
  findDivergentRequirements(
    [requirement({ title: "UI grid renders" })],
    [original],
  ),
  ["AE-PRODUCTS-001"],
  "reusing an id for different behavior must be rejected",
);

assert.throws(
  () => validateLocalRequirements([original, { ...original }]),
  /duplicate or missing id/,
  "duplicate ids in one registry must be rejected",
);
assert.deepEqual(
  [...validateLocalRequirements([original])],
  ["AE-PRODUCTS-001"],
  "active ids must be returned for spec validation",
);

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "requirement-consistency-"),
);
try {
  assert.equal(
    loadBaseRequirements("origin/missing", temporaryRoot),
    null,
    "an unavailable base ref must return null for the offline-safe path",
  );

  // Base-ref resolution. The default used to be the literal "origin/main", so a clone whose remote
  // is named anything else resolved nothing and the cross-branch check reported "skipped" forever —
  // a guard that cannot fail. temporaryRoot is not a git repository, so every candidate misses.
  assert.equal(
    resolveBaseRef(temporaryRoot),
    null,
    "a directory with no resolvable ref must report no base rather than a fictional one",
  );
  assert.throws(
    () => resolveBaseRef(temporaryRoot, "typo/man"),
    /does not resolve/,
    "an explicitly named base ref must be refused, never silently replaced with a fallback",
  );

  // The live repo does have a merge target, so resolution must find one there.
  assert.ok(
    resolveBaseRef(),
    "the live repository must resolve a base ref for the cross-branch check",
  );

  // The fixture is a miniature clone of THIS adapter, not a hardcoded Cypress one: the check now
  // reads testRoot and the spec suffix from harness.config.json and imports the test-call idiom
  // from the adapter's patterns module, so the fixture has to carry both. Building it from the
  // live repo is also what makes this test prove something in either adapter — a hardcoded
  // cypress/tests fixture would have found zero specs elsewhere and passed while checking nothing.
  const liveRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const config = JSON.parse(
    fs.readFileSync(path.join(liveRoot, "harness.config.json"), "utf8"),
  );
  const { framework } = config;
  const { testRoot, specGlob } = config.project;
  const suffix = path.basename(specGlob).match(/^\*\.([A-Za-z]+)\./)?.[1];
  assert.ok(suffix, `cannot derive spec suffix from specGlob "${specGlob}"`);
  const extension = (
    specGlob.match(/\{([^}]+)\}/)?.[1] ?? specGlob.split(".").pop()
  )
    .split(",")[0]
    .trim();

  fs.writeFileSync(
    path.join(temporaryRoot, "harness.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  // Every declared root must exist: the patterns module refuses to build a scanner against a root
  // that is not on disk, because a scope that matches nothing reports a clean tree. A fixture that
  // only created testRoot was not a valid clone.
  for (const key of ["testRoot", "configRoot", "commandRoot"]) {
    if (config.project[key]) {
      fs.mkdirSync(path.join(temporaryRoot, config.project[key]), {
        recursive: true,
      });
    }
  }

  // What a scanner needs to load, as a list rather than as whatever happened to be enough last
  // time. The patterns module imports the L3 pattern layer, which imports nothing further; when
  // that dependency grows, this list is the one place to extend.
  const hooksDirectory = path.join(temporaryRoot, ".claude", "hooks");
  fs.mkdirSync(hooksDirectory, { recursive: true });
  for (const file of [`${framework}.patterns.mjs`, "rule-engine.mjs"]) {
    fs.copyFileSync(
      path.join(liveRoot, ".claude", "hooks", file),
      path.join(hooksDirectory, file),
    );
  }
  fs.mkdirSync(path.join(temporaryRoot, "harness"), { recursive: true });
  for (const file of ["patterns.mjs"]) {
    fs.copyFileSync(
      path.join(liveRoot, "harness", file),
      path.join(temporaryRoot, "harness", file),
    );
  }

  const specDirectory = path.join(
    temporaryRoot,
    testRoot,
    "tests",
    "products",
    "smoke",
  );
  fs.mkdirSync(specDirectory, { recursive: true });
  // The test-call keyword differs per framework, so take it from the same module the check does.
  const { testTitleRe } = await import(
    pathToFileURL(path.join(hooksDirectory, `${framework}.patterns.mjs`)).href
  );
  const call = testTitleRe.source.includes("it|specify") ? "it" : "test";
  fs.writeFileSync(
    path.join(specDirectory, `products.${suffix}.${extension}`),
    `${call}("[AE-PRODUCTS-002] grid renders", () => {});\n`,
  );
  assert.deepEqual(
    await findUnknownSpecRequirementIds(
      temporaryRoot,
      new Set(["AE-PRODUCTS-001"]),
    ),
    ["AE-PRODUCTS-002"],
    "a spec id that is not active in the registry must be rejected",
  );
  assert.deepEqual(
    await findUnknownSpecRequirementIds(
      temporaryRoot,
      new Set(["AE-PRODUCTS-002"]),
    ),
    [],
    "a spec id active in the registry must be allowed",
  );
  // Under CI, "no base resolved" must be an error. Reporting success without having compared
  // anything is the exact failure this check exists to prevent.
  fs.mkdirSync(path.join(temporaryRoot, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(temporaryRoot, "evidence", "requirements.json"),
    // Carries the id the fixture spec references, so the run reaches base-ref resolution instead of
    // stopping at the unknown-spec-id guard.
    `${JSON.stringify(
      {
        version: 1,
        requirements: [requirement({ id: "AE-PRODUCTS-002" })],
      },
      null,
      2,
    )}\n`,
  );
  await assert.rejects(
    checkRequirements({ repoRoot: temporaryRoot, strict: true }),
    /no base ref resolved/,
    "a strict run with no resolvable base must fail rather than report a skipped check",
  );
  assert.equal(
    (await checkRequirements({ repoRoot: temporaryRoot, strict: false }))
      .baseAvailable,
    false,
    "a non-strict run with no resolvable base stays offline-safe",
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "[requirements:test] base resolution, CI strictness, divergence, duplicates, active ids, and offline behavior verified",
);
