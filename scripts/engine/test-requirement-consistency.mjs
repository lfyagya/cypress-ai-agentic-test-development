#!/usr/bin/env node
// Focused coverage for cross-file and cross-branch requirement consistency.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  findDivergentRequirements,
  findUnknownSpecRequirementIds,
  loadBaseRequirements,
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

  const hooksDirectory = path.join(temporaryRoot, ".claude", "hooks");
  fs.mkdirSync(hooksDirectory, { recursive: true });
  for (const file of [`${framework}.patterns.mjs`, "rule-engine.mjs"]) {
    fs.copyFileSync(
      path.join(liveRoot, ".claude", "hooks", file),
      path.join(hooksDirectory, file),
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
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "[requirements:test] base divergence, duplicates, active ids, and offline behavior verified",
);
