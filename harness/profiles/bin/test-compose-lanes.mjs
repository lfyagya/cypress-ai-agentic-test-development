#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compose, recordedLane } from "./compose-harness-config.mjs";
import { GSD_WORKFLOW } from "../../workflow-model.mjs";

const adaptersDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "harness-compose-adapters-"),
);

try {
  for (const framework of ["cypress", "playwright"]) {
    fs.writeFileSync(
      path.join(adaptersDir, `${framework}.json`),
      JSON.stringify({
        framework,
        version: 1,
        architecture: "adapter-default",
        pattern: framework === "cypress" ? "command-first" : "helper-first",
        paths: {
          testRoot: "adapter/tests",
          configRoot: "adapter/config",
          commandRoot: "adapter/support",
          specGlob:
            framework === "cypress"
              ? "adapter/tests/**/*.cy.js"
              : "adapter/tests/**/*.spec.ts",
        },
        defaults: { adapters: {}, context: {}, loops: { gateRepairLimit: 2 } },
        rules: [],
        agents: [],
        hooks: {},
        qaFoundations: "harness/qa-automation-foundations.md",
        permissions: {},
      }),
    );
  }

  const profile = {
    key: "multi-runner",
    projectName: "payments-web",
    adapter: "cypress",
    repo: "https://example.test/payments",
    adapters: { claude: { enabled: true } },
    pattern: "command-first",
    paths: {
      testRoot: "tests",
      configRoot: "config",
      commandRoot: "support",
      specGlob: "tests/**/*.cy.ts",
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
    lanes: [
      {
        id: "browser-e2e",
        name: "Browser E2E",
        kind: "e2e",
        adapter: "playwright",
        pattern: "pom",
        paths: { specGlob: "tests/e2e/**/*.spec.ts" },
        safety: { targets: ["qa"], mutation: "read-only" },
      },
      {
        id: "smoke",
        name: "Smoke",
        kind: "smoke",
        adapter: "cypress",
        paths: { specGlob: "tests/smoke/**/*.cy.ts" },
        safety: { targets: ["staging"], mutation: "read-only" },
      },
    ],
  };

  assert.throws(
    () => compose(profile, adaptersDir),
    /select one with --lane <id>/,
    "multi-lane composition must require an explicit lane",
  );

  const playwright = compose(profile, adaptersDir, "browser-e2e");
  assert.equal(playwright.framework, "playwright");
  assert.equal(playwright.project.laneId, "browser-e2e");
  assert.equal(playwright.project.pattern, "pom");
  assert.equal(playwright.project.specGlob, "tests/e2e/**/*.spec.ts");
  assert.equal(playwright.project.testRoot, "tests");
  assert.equal(playwright.project.repo, profile.repo);
  assert.deepEqual(playwright.project.safety, profile.lanes[0].safety);
  assert.deepEqual(playwright.wiring, profile.wiring);
  assert.deepEqual(playwright.strategy, profile.strategy);
  assert.deepEqual(playwright.workflow, GSD_WORKFLOW);

  const cypress = compose(profile, adaptersDir, "smoke");
  assert.equal(cypress.framework, "cypress");
  assert.equal(cypress.project.laneId, "smoke");
  assert.equal(cypress.project.specGlob, "tests/smoke/**/*.cy.ts");
  assert.deepEqual(cypress.workflow, GSD_WORKFLOW);

  // Regression: a block the profile never declared stays undeclared (existing configs stay
  // byte-identical), and a malformed one is rejected, not flattened into a valid-looking `{}`.
  const legacy = {
    key: "legacy",
    projectName: "legacy-app",
    adapter: "cypress",
    repo: "https://example.test/legacy",
    pattern: "command-first",
    adapters: { claude: { enabled: true } },
    paths: profile.paths,
  };
  const bare = compose(legacy, adaptersDir);
  assert.ok(
    !("wiring" in bare) && !("strategy" in bare),
    "a profile declaring no wiring or strategy must not gain the keys",
  );
  assert.equal(bare.project.laneId, "default");
  for (const block of ["wiring", "strategy"]) {
    for (const bad of [[], "yarn", 7]) {
      assert.throws(
        () => compose({ ...legacy, [block]: bad }, adaptersDir),
        /must be an object/,
        `${block}: ${JSON.stringify(bad)} must be refused`,
      );
    }
  }
  assert.throws(
    () =>
      compose(
        {
          ...profile,
          lanes: [{ ...profile.lanes[1], wiring: [] }],
        },
        adaptersDir,
        "smoke",
      ),
    /lanes\[0\]\.wiring must be an object/,
    "a lane-level malformed block is reported as malformed, not as missing",
  );
  const withoutWiring = structuredClone(profile);
  delete withoutWiring.wiring;
  assert.throws(
    () => compose(withoutWiring, adaptersDir, "smoke"),
    /lanes\[1\]\.wiring is required/,
    "a lane with no wiring anywhere is incomplete",
  );

  // Composing accepts an unfinished <placeholder> in a free-form field (a shipped template or
  // in-progress example must compose); readiness is what reports it as unfinished.
  assert.equal(
    compose(
      {
        ...legacy,
        wiring: {
          packageManager: "npm",
          workspacePackage: false,
          verifyScript: "<their existing pre-commit entry point>",
        },
      },
      adaptersDir,
    ).wiring.verifyScript,
    "<their existing pre-commit entry point>",
  );

  // Re-composing or verifying an existing config keeps its lane without repeating --lane.
  const recorded = path.join(adaptersDir, "recorded.json");
  fs.writeFileSync(recorded, JSON.stringify({ project: { laneId: "smoke" } }));
  assert.equal(recordedLane(recorded), "smoke");
  assert.equal(recordedLane(path.join(adaptersDir, "absent.json")), undefined);
  assert.equal(recordedLane(undefined), undefined);
  assert.equal(
    compose(profile, adaptersDir, recordedLane(recorded)).project.laneId,
    "smoke",
  );

  // PRD sources are optional, validated, and carried verbatim into the config.
  const sources = {
    tickets: "PAY board",
    api: ["https://example.test/openapi.json"],
  };
  assert.deepEqual(
    compose({ ...profile, sources }, adaptersDir, "smoke").project.sources,
    sources,
  );
  assert.ok(
    !("sources" in compose(profile, adaptersDir, "smoke").project),
    "an undeclared sources block must not appear in the config",
  );
  assert.throws(
    () => compose({ ...profile, sources: { jira: "x" } }, adaptersDir, "smoke"),
    /not a known source/,
  );
  assert.throws(
    () =>
      compose(
        { ...profile, sources: { figma: "<file>" } },
        adaptersDir,
        "smoke",
      ),
    /must name where/,
  );

  console.log(
    "test-compose-lanes: explicit routing and profile composition passed",
  );
} finally {
  fs.rmSync(adaptersDir, { recursive: true, force: true });
}
