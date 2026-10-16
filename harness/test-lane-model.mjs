#!/usr/bin/env node
import assert from "node:assert/strict";
import { laneModelIssues, laneProfile, selectLane } from "./lane-model.mjs";

const common = {
  key: "payments",
  projectName: "payments-web",
  repo: "https://example.test/payments",
  paths: {
    testRoot: "tests",
    configRoot: "config",
    commandRoot: "support",
    specGlob: "tests/**/*.spec.ts",
  },
  wiring: {
    packageManager: "npm",
    workspacePackage: false,
    verifyScript: "npm run verify",
  },
  strategy: {
    auth: "cached-session",
    testData: "fresh",
    credentialSource: "ci-secret",
  },
};

const profile = {
  ...common,
  lanes: [
    {
      id: "ui-e2e",
      name: "UI E2E",
      kind: "e2e",
      adapter: "playwright",
      paths: { testRoot: "playwright/tests" },
      safety: {
        targets: ["dev", "qa"],
        mutation: "allowlisted",
        allowedOperations: ["create-order"],
      },
    },
    {
      id: "ui-smoke",
      name: "UI smoke",
      kind: "smoke",
      adapter: "cypress",
      paths: { specGlob: "cypress/tests/**/*.cy.ts" },
      safety: { targets: ["staging"], mutation: "read-only" },
    },
  ],
};

assert.deepEqual(laneModelIssues(profile), []);
const e2e = selectLane(profile, "ui-e2e");
const facts = laneProfile(profile, e2e);
assert.equal(facts.adapter, "playwright");
assert.deepEqual(facts.paths, {
  testRoot: "playwright/tests",
  configRoot: "config",
  commandRoot: "support",
  specGlob: "tests/**/*.spec.ts",
});
assert.equal(facts.wiring.verifyScript, "npm run verify");
assert.equal(facts.repo, common.repo);
assert.throws(
  () => selectLane(profile),
  /select one with --lane <id>/,
  "multi-lane selection must be explicit",
);
assert.throws(
  () => selectLane(profile, "api"),
  /unknown lane "api"/,
  "unknown lane IDs must fail rather than silently choose a lane",
);

const duplicate = structuredClone(profile);
duplicate.lanes[1].id = duplicate.lanes[0].id;
assert.ok(
  laneModelIssues(duplicate).some((issue) => /duplicates lane/.test(issue)),
);

const unsafeSmoke = structuredClone(profile);
unsafeSmoke.lanes[1].safety.mutation = "approved";
unsafeSmoke.lanes[1].safety.approver = "QA Lead";
unsafeSmoke.lanes[1].safety.reason = "test";
assert.ok(
  laneModelIssues(unsafeSmoke).some((issue) => /read-only/.test(issue)),
  "smoke lanes must be read-only even when approval metadata is supplied",
);

const unsafeProduction = structuredClone(profile);
unsafeProduction.lanes[0].safety.targets.push("production");
assert.ok(
  laneModelIssues(unsafeProduction).some((issue) => /read-only/.test(issue)),
  "production-targeting lanes must be read-only",
);

const typo = structuredClone(profile);
typo.lanes[0].wiring = { packageManger: "npm" };
assert.ok(
  laneModelIssues(typo).some((issue) => /wiring.packageManger/.test(issue)),
  "unknown lane overrides must not be ignored",
);

const legacy = {
  ...common,
  adapter: "cypress",
};
assert.equal(selectLane(legacy).id, "default");
assert.deepEqual(laneModelIssues(legacy), []);

// Any kind of test can have a lane: layers, types, and the `other` escape hatch. Each lane is its
// own adapter, pattern, and safety declaration; nothing forces production-only or API-only lanes.
const kinds = [
  "e2e",
  "frontend",
  "backend",
  "functional",
  "integration",
  "regression",
  "smoke",
  "api",
  "contract",
  "component",
  "performance",
  "accessibility",
  "other",
];
const everyKind = {
  ...common,
  lanes: kinds.map((kind, index) => ({
    id: `lane-${kind}`,
    name: `Lane ${kind}`,
    kind,
    adapter: index % 2 === 0 ? "cypress" : "playwright",
    paths: {
      specGlob: index % 2 === 0 ? "tests/**/*.cy.ts" : "tests/**/*.spec.ts",
    },
    safety:
      kind === "smoke"
        ? { targets: ["production"], mutation: "read-only" }
        : { targets: ["dev", "qa"], mutation: "read-only" },
  })),
};
assert.deepEqual(laneModelIssues(everyKind), []);
assert.match(
  laneModelIssues({
    ...common,
    lanes: [{ ...everyKind.lanes[0], kind: "vibes" }],
  }).join(),
  /kind must be one of/,
);

console.log("test-lane-model: multi-lane and legacy cases passed");
