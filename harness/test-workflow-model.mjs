#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { laneSafetyGuidance } from "./lane-model.mjs";
import { APPROVAL_KINDS } from "../scripts/lib/task-protocol.mjs";
import {
  GSD_WORKFLOW,
  approvalKinds,
  evaluatorGuidance,
  planningScaffold,
  sourcesGuidance,
  sourcesIssues,
  workflowGuidance,
  workflowIssues,
} from "./workflow-model.mjs";
import {
  codexInstructions,
  copilotInstructions,
  cursorRules,
  readConfig,
  rulesBlock,
} from "../scripts/engine/templates.mjs";

assert.deepEqual(workflowIssues(structuredClone(GSD_WORKFLOW)), []);
assert.equal(GSD_WORKFLOW.model, "gsd");
// The delivery pipeline, in the order the team approves it.
assert.deepEqual(
  GSD_WORKFLOW.pipeline.map((s) => s.id),
  [
    "prd",
    "test-plan",
    "test-cases",
    "implementation",
    "execution",
    "debugging",
    "evidence",
    "validation",
    "release",
  ],
);
const stageOf = (id) => GSD_WORKFLOW.pipeline.find((s) => s.id === id);
assert.deepEqual(stageOf("prd").sources, [
  "tickets",
  "confluence",
  "figma",
  "documentation",
  "api",
]);
assert.deepEqual(stageOf("test-plan").formats, [
  "backend",
  "frontend",
  "functional",
  "integration",
  "regression",
  "smoke",
]);
assert.deepEqual(stageOf("test-cases").inputs, [
  "specs",
  "codebase",
  "existing automation coverage",
]);
assert.deepEqual(stageOf("implementation").standards, [
  "framework standard",
  "well structured",
  "reusable",
  "maintainable",
  "readable",
]);
// Gates: PRD, plan, and cases are approved before the next stage; validation before release.
assert.deepEqual(approvalKinds(), [
  "prd",
  "plan",
  "test-cases",
  "verification",
]);
assert.deepEqual(
  approvalKinds(),
  APPROVAL_KINDS,
  "the kinds task control records must be exactly the kinds the pipeline gates on",
);
assert.equal(stageOf("release").approval, undefined, "release is a human act");
assert.deepEqual(
  Object.keys(GSD_WORKFLOW.taskTypes),
  ["feature", "defect", "refactor", "test", "docs-config", "research"],
  "all supported task types must route through the same GSD contract",
);
assert.equal(GSD_WORKFLOW.invariants.planBeforeImplementation, true);
assert.equal(GSD_WORKFLOW.invariants.verifyBeforeShip, true);
assert.equal(GSD_WORKFLOW.invariants.autoShip, false);

const changed = structuredClone(GSD_WORKFLOW);
changed.pipeline.splice(
  changed.pipeline.findIndex((s) => s.id === "validation"),
  1,
);
assert.match(workflowIssues(changed).join("\n"), /canonical GSD workflow/);

const guidance = workflowGuidance();
assert.match(
  guidance,
  /PRD -> TEST PLAN -> TEST CASES -> IMPLEMENTATION -> EXECUTION -> DEBUGGING -> EVIDENCE -> VALIDATION -> RELEASE/,
);
assert.match(
  guidance,
  /Sources: tickets, confluence, figma, documentation, api\./,
);
assert.match(
  guidance,
  /Plan sections: backend, frontend, functional, integration, regression, smoke\./,
);
assert.match(
  guidance,
  /Inputs: specs, codebase, existing automation coverage\./,
);
assert.match(guidance, /approve --artifact prd/);
assert.match(guidance, /approve --artifact test-cases/);
assert.equal(
  (guidance.match(/\*\*Gate:\*\*/g) ?? []).length,
  4,
  "exactly four stages are gates",
);
assert.match(guidance, /mixed tasks/);
assert.match(guidance, /defect:/);
assert.match(guidance, /at most 2 times/);
assert.match(guidance, /Never auto-publish/);

// The read-only evaluator is told what to demand, never to plan, execute, or ship.
const evaluator = evaluatorGuidance();
assert.match(evaluator, /EVIDENCE review and VALIDATION only/);
assert.match(evaluator, /never write a PRD, plan, or cases/);
assert.match(evaluator, /every gate has a recorded human approval/);
assert.doesNotMatch(evaluator, /Never auto-publish/);
for (const type of Object.keys(GSD_WORKFLOW.taskTypes)) {
  assert.ok(
    evaluator.includes(`**${type}:**`),
    `the evaluator must know the ${type} proof obligations`,
  );
}

const scaffold = planningScaffold();
assert.deepEqual(Object.keys(scaffold.files), [
  ".planning/PROJECT.md",
  ".planning/REQUIREMENTS.md",
  ".planning/ROADMAP.md",
  ".planning/STATE.md",
]);
assert.equal(scaffold.directory, ".planning/phases");

// PRD sources: where a project's requirements live. Locations only, every key optional.
assert.deepEqual(sourcesIssues(undefined), []);
assert.deepEqual(
  sourcesIssues({
    $comment: "documented inline",
    tickets: "PAY board",
    confluence: ["QA space", "PAY space"],
  }),
  [],
);
assert.match(sourcesIssues({ jira: "x" }).join(), /not a known source/);
assert.match(sourcesIssues({ figma: "<file>" }).join(), /must name where/);
assert.match(sourcesIssues({ api: [] }).join(), /must name where/);
assert.match(sourcesIssues({ api: [7] }).join(), /must name where/);
assert.match(sourcesIssues([]).join(), /must be an object/);
const declared = sourcesGuidance({
  tickets: "PAY board",
  api: ["https://example.test/openapi.json"],
});
assert.match(declared, /\*\*tickets:\*\* PAY board/);
assert.match(declared, /Not declared: confluence, figma, documentation/);
assert.match(sourcesGuidance(undefined), /none declared/);

assert.equal(
  laneSafetyGuidance({}),
  "",
  "a profile with no lanes states no boundary",
);
const smoke = { laneId: "prod-smoke", laneName: "Smoke", laneKind: "smoke" };
assert.match(
  laneSafetyGuidance({
    ...smoke,
    safety: { targets: ["production"], mutation: "read-only" },
  }),
  /may only target: production\. Mutation policy: \*\*read-only\*\*/,
);
assert.match(
  laneSafetyGuidance({
    ...smoke,
    safety: { targets: ["qa"], mutation: "no-such-mode" },
  }),
  /\*\*read-only\*\*/,
  "an unrecognised mutation mode must fall back to the strictest policy",
);

const projectionConfig = {
  workflow: GSD_WORKFLOW,
  framework: "playwright",
  project: {
    name: "payments-web",
    architecture: "helper-first",
    configRoot: "playwright/config",
    commandRoot: "playwright/helpers",
    specGlob: "playwright/tests/**/*.spec.ts",
  },
  rules: [
    {
      id: "no-hard-wait",
      enforcement: "CI",
      never: "use fixed delays",
      instead: "wait for a condition",
      why: "fixed delays are flaky",
    },
  ],
  agents: [],
};
for (const [tool, projection] of Object.entries({
  claude: rulesBlock(projectionConfig),
  copilot: copilotInstructions(projectionConfig),
  cursor: cursorRules(projectionConfig),
  codex: codexInstructions(projectionConfig),
})) {
  assert.ok(
    projection.includes(guidance),
    `${tool} must receive the identical canonical GSD guidance`,
  );
}

const configRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "harness-workflow-config-"),
);
try {
  const configPath = path.join(configRoot, "harness.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ version: 1 }));
  assert.throws(
    () => readConfig(configRoot),
    /canonical GSD workflow/,
    "sync must reject a config missing the canonical workflow",
  );

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      workflow: { ...GSD_WORKFLOW, model: "other" },
    }),
  );
  assert.throws(
    () => readConfig(configRoot),
    /canonical GSD workflow/,
    "sync must reject workflow drift rather than project a conflicting contract",
  );
} finally {
  fs.rmSync(configRoot, { recursive: true, force: true });
}

console.log("test-workflow-model: lifecycle and task routing passed");
