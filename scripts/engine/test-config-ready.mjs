#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CONFIGURE_RE,
  datastoreIssues,
  evaluateConfigReady,
  lockProjectProfile,
} from "./config-ready.mjs";
import { GSD_WORKFLOW } from "../../harness/workflow-model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK = join(ROOT, ".claude", "hooks", "harness-config-gate.mjs");

function hook(dir, prompt) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CURSOR_PROJECT_DIR: dir },
    timeout: 10000,
  });
  return {
    code: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "harness-ready-"));
  mkdirSync(join(dir, "harness", "profiles", "projects"), { recursive: true });
  return dir;
}

function writeProfile(dir, profile, filename = `${profile.key}.json`) {
  writeFileSync(
    join(dir, "harness", "profiles", "projects", filename),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

const ADAPTER = "cypress";
const live = {
  $comment: "GENERATED test fixture",
  version: 1,
  framework: ADAPTER,
  workflow: structuredClone(GSD_WORKFLOW),
  adapters: { claude: { enabled: true } },
  hooks: {},
  project: { name: "payments-web" },
};

const completeProfile = {
  key: "payments",
  displayName: "Payments",
  owner: "QA Guild",
  adapter: ADAPTER,
  projectName: "payments-web",
  repo: "https://github.com/acme/payments",
  adapters: { claude: { enabled: true } },
  pattern: "command-first",
  paths: {
    testRoot: "tests",
    configRoot: "config",
    commandRoot: "support/commands",
    specGlob: "tests/**/*.cy.js",
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

const readyDir = tmp();
writeFileSync(
  join(readyDir, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(readyDir, {
  ...completeProfile,
  projectName: live.project.name,
  locked: true,
});

assert.equal(
  evaluateConfigReady(readyDir).status,
  "ready",
  "locked matching profile is ready",
);
assert.equal(
  hook(readyDir, "write a login smoke test").code,
  0,
  "ready: work prompt allowed",
);

const multiLane = {
  ...completeProfile,
  adapter: "cypress",
  pattern: "command-first",
  paths: {
    testRoot: "tests",
    configRoot: "config",
    commandRoot: "support/commands",
    specGlob: "tests/**/*.cy.js",
  },
  lanes: [
    {
      id: "browser-e2e",
      name: "Browser E2E",
      kind: "e2e",
      adapter: "playwright",
      pattern: "helper-first",
      paths: { specGlob: "tests/e2e/**/*.spec.ts" },
      safety: { targets: ["qa"], mutation: "read-only" },
    },
    {
      id: "production-smoke",
      name: "Production Smoke",
      kind: "smoke",
      adapter: "cypress",
      paths: { specGlob: "tests/smoke/**/*.cy.js" },
      safety: { targets: ["production"], mutation: "read-only" },
    },
  ],
  locked: true,
};
const laneDir = tmp();
const playwrightLane = multiLane.lanes[0];
const laneFacts = {
  ...multiLane,
  ...playwrightLane,
  paths: { ...multiLane.paths, ...playwrightLane.paths },
  wiring: { ...multiLane.wiring, ...playwrightLane.wiring },
  strategy: { ...multiLane.strategy, ...playwrightLane.strategy },
};
const multiLaneConfig = {
  ...live,
  framework: playwrightLane.adapter,
  project: {
    name: live.project.name,
    laneId: playwrightLane.id,
    laneName: playwrightLane.name,
    laneKind: playwrightLane.kind,
    repo: playwrightLane.repo ?? multiLane.repo,
    pattern: laneFacts.pattern,
    safety: { mutation: "read-only", targets: ["qa"] },
    ...laneFacts.paths,
  },
  wiring: laneFacts.wiring,
  strategy: laneFacts.strategy,
};
writeFileSync(
  join(laneDir, "harness.config.json"),
  `${JSON.stringify(multiLaneConfig, null, 2)}\n`,
);
writeProfile(laneDir, multiLane);
assert.equal(
  evaluateConfigReady(laneDir).status,
  "ready",
  "selected Playwright lane takes precedence over the conflicting legacy Cypress adapter",
);

const laneMismatches = [
  [
    "framework",
    (config) => (config.framework = "cypress"),
    /framework.*does not match lane/,
  ],
  [
    "lane ID",
    (config) => (config.project.laneId = "unknown-lane"),
    /unknown lane/,
  ],
  [
    "lane name",
    (config) => (config.project.laneName = "Wrong name"),
    /laneName.*does not match/,
  ],
  [
    "lane kind",
    (config) => (config.project.laneKind = "component"),
    /laneKind.*does not match/,
  ],
  [
    "repository",
    (config) => (config.project.repo = "https://example.test/other"),
    /project.repo.*does not match/,
  ],
  [
    "pattern",
    (config) => (config.project.pattern = "command-first"),
    /project.pattern.*does not match/,
  ],
  [
    "safety",
    (config) => (config.project.safety.targets = ["staging"]),
    /project.safety.*does not match/,
  ],
  [
    "PRD sources",
    (config) => (config.project.sources = { tickets: "SOMEWHERE-ELSE" }),
    /project.sources.*does not match/,
  ],
  [
    "paths",
    (config) => (config.project.specGlob = "tests/e2e/**/*.cy.js"),
    /project.specGlob.*does not match/,
  ],
  [
    "wiring",
    (config) => (config.wiring.verifyScript = "npm run other"),
    /wiring.verifyScript.*does not match/,
  ],
  [
    "strategy",
    (config) => (config.strategy.auth = "per-test-login"),
    /strategy.auth.*does not match/,
  ],
];
for (const [label, mutate, expectedIssue] of laneMismatches) {
  const mismatchDir = tmp();
  const mismatchedConfig = structuredClone(multiLaneConfig);
  mutate(mismatchedConfig);
  writeFileSync(
    join(mismatchDir, "harness.config.json"),
    `${JSON.stringify(mismatchedConfig, null, 2)}\n`,
  );
  writeProfile(mismatchDir, multiLane);
  const result = evaluateConfigReady(mismatchDir);
  assert.equal(result.status, "unconfigured", `${label} mismatch must block`);
  assert.ok(
    result.issues.some((issue) => expectedIssue.test(issue)),
    `${label} mismatch must be reported: ${result.issues.join("; ")}`,
  );
}

const driftedWorkflow = tmp();
writeFileSync(
  join(driftedWorkflow, "harness.config.json"),
  `${JSON.stringify(
    {
      ...live,
      workflow: {
        ...live.workflow,
        invariants: { ...live.workflow.invariants, autoShip: true },
      },
    },
    null,
    2,
  )}\n`,
);
writeProfile(driftedWorkflow, {
  ...completeProfile,
  projectName: live.project.name,
  locked: true,
});
assert.equal(
  evaluateConfigReady(driftedWorkflow).status,
  "unconfigured",
  "drifted GSD workflow must be blocked",
);

const missingWorkflow = tmp();
const configWithoutWorkflow = { ...live };
delete configWithoutWorkflow.workflow;
writeFileSync(
  join(missingWorkflow, "harness.config.json"),
  `${JSON.stringify(configWithoutWorkflow, null, 2)}\n`,
);
writeProfile(missingWorkflow, {
  ...completeProfile,
  projectName: live.project.name,
  locked: true,
});
assert.equal(
  evaluateConfigReady(missingWorkflow).status,
  "unconfigured",
  "missing GSD workflow must be blocked",
);

const missing = tmp();
assert.equal(evaluateConfigReady(missing).status, "missing");
assert.equal(
  hook(missing, "write a login smoke test").code,
  2,
  "missing: work blocked",
);

const broken = tmp();
writeFileSync(join(broken, "harness.config.json"), "{ not json", "utf8");
assert.equal(evaluateConfigReady(broken).status, "broken");
assert.equal(
  hook(broken, "write a smoke test").code,
  2,
  "broken JSON: work blocked",
);

const unlocked = tmp();
writeFileSync(
  join(unlocked, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(unlocked, {
  ...completeProfile,
  projectName: live.project.name,
  locked: false,
});
assert.equal(evaluateConfigReady(unlocked).status, "unlocked");
assert.equal(
  hook(unlocked, "write a login smoke test").code,
  2,
  "unlocked: work blocked",
);
assert.equal(
  hook(unlocked, "npm run harness:lock").code,
  0,
  "unlocked: lock prompt allowed",
);
assert.equal(
  lockProjectProfile(unlocked).ok,
  true,
  "lock signs off a complete profile",
);
assert.equal(evaluateConfigReady(unlocked).status, "ready");
assert.equal(
  hook(unlocked, "write a login smoke test").code,
  0,
  "after lock: work allowed",
);

const template = tmp();
writeFileSync(
  join(template, "harness.config.json"),
  `${JSON.stringify(live, null, 2)}\n`,
);
writeProfile(
  template,
  {
    key: "<short-kebab-key>",
    displayName: "<Project Name>",
    owner: "<a person, not a team — replace before compose>",
    adapter: ADAPTER,
    projectName: live.project.name,
    repo: "<path or URL of the repo this composes into>",
    adapters: { claude: { enabled: true } },
    locked: false,
  },
  "unfilled.json",
);
assert.equal(evaluateConfigReady(template).status, "unconfigured");
assert.equal(
  lockProjectProfile(template).ok,
  false,
  "lock refuses a template profile",
);
assert.equal(hook(template, "add a checkout spec").code, 2);
assert.equal(
  hook(template, `Configure the ${ADAPTER} harness for this project`).code,
  0,
);
// And with no framework name at all, since the phrase is optional in CONFIGURE_RE.
assert.equal(hook(template, "Configure the harness for this project").code, 0);

assert.equal(
  CONFIGURE_RE.test(
    "write a login smoke test and use the module from harness.config.json",
  ),
  false,
  "work prompt mentioning harness.config.json is not configure",
);
assert.equal(
  hook(
    template,
    "write a login smoke test and use the module from harness.config.json",
  ).code,
  2,
);

// Datastore block. Absent is fine — most projects have no datastore access and lose nothing.
assert.deepEqual(
  datastoreIssues(undefined),
  [],
  "a profile with no datastore block must stay valid",
);
assert.deepEqual(
  datastoreIssues({ driver: "none", access: "none" }),
  [],
  "an explicitly disabled datastore must be valid without a credential source",
);
assert.deepEqual(
  datastoreIssues({
    driver: "postgres",
    access: "direct",
    credentialSource: "DB_READONLY_URL",
    readOnly: true,
  }),
  [],
  "a read-only datastore naming its credential source must be valid",
);
assert.match(
  datastoreIssues({ driver: "postgres", access: "direct", readOnly: true })[0],
  /credentialSource is required/,
  "a reachable datastore with no named credential source must be refused",
);
assert.match(
  datastoreIssues({
    driver: "mssql",
    access: "both",
    credentialSource: "DB_URL",
  })[0],
  /writeApproval/,
  "write-capable datastore access must be approved or declared read-only",
);
assert.deepEqual(
  datastoreIssues({
    driver: "postgres",
    access: "direct",
    credentialSource: "DB_URL",
    writeApproval: "QA Platform Lead",
  }),
  [],
  "a named write approver must permit write-capable datastore access",
);
assert.ok(
  datastoreIssues({
    driver: "postgres",
    access: "direct",
    credentialSource: "DB_URL",
    readOnly: "false",
  }).some((issue) => /readOnly must be a boolean/.test(issue)),
  "string readOnly values must be rejected",
);
assert.ok(
  datastoreIssues({
    driver: "postgres",
    access: "direct",
    credentialSource: "DB_URL",
    writeApproval: true,
  }).some((issue) => /writeApproval must name/.test(issue)),
  "a boolean must not substitute for a named write approval",
);
assert.match(
  datastoreIssues({ driver: "sqlite", access: "direct" })[0],
  /driver must be one of/,
  "an unsupported driver must be refused rather than silently accepted",
);

console.log("test-config-ready: all use cases passed");
