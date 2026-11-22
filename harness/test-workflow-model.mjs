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
  gatePoints,
  gsdCapability,
  pipelineFor,
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
    "scenarios",
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
// Gates G0-G5: scope, scenarios, plan, cases, the implementation diff, and the evidence.
assert.deepEqual(approvalKinds(), ["G0", "G1", "G2", "G3", "G4", "G5"]);
// The GSD loop points each gate is checked at: the same points the FHF engine proved in production.
assert.deepEqual(gatePoints(), [
  { gate: "G0", point: "discuss:post" },
  { gate: "G1", point: "plan:pre" },
  { gate: "G2", point: "plan:post" },
  { gate: "G3", point: "plan:post" },
  { gate: "G4", point: "execute:wave:post" },
  { gate: "G5", point: "ship:pre" },
]);
assert.match(
  GSD_WORKFLOW.gsd.version,
  /^\d+\.\d+\.\d+$/,
  "GSD Core is pinned to an exact release",
);
// The capability GSD installs is generated from the pipeline; the shipped file must be exactly that.
const shipped = JSON.parse(
  fs.readFileSync(
    new URL(
      `./capability/${GSD_WORKFLOW.gsd.capability}/capability.json`,
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(
  shipped,
  gsdCapability(GSD_WORKFLOW, shipped.version),
  "harness/capability is stale: regenerate it from gsdCapability()",
);
assert.equal(shipped.gates.length, 6);
// Dev and QA run different stages under the same gate ids at the same GSD points, so the one installed
// capability and the one phase ledger govern both teams.
assert.deepEqual(
  pipelineFor(GSD_WORKFLOW, "dev")
    .filter((s) => s.approval)
    .map((s) => ({ gate: s.approval, point: s.gatePoint })),
  gatePoints(),
);
assert.deepEqual(
  pipelineFor(GSD_WORKFLOW, "dev").map((s) => s.id),
  [
    "prd",
    "design",
    "plan",
    "tests-first",
    "implementation",
    "verification",
    "debugging",
    "evidence",
    "review",
    "release",
  ],
);
assert.equal(pipelineFor(GSD_WORKFLOW, "qa"), GSD_WORKFLOW.pipeline);
assert.match(
  workflowGuidance(GSD_WORKFLOW, "dev"),
  /development pipeline[\s\S]*TESTS FIRST[\s\S]*Harness-Phase: red B-n/,
);
assert.match(
  evaluatorGuidance(GSD_WORKFLOW, "dev"),
  /EVIDENCE review and REVIEW only/,
);
assert.ok(shipped.gates.every((g) => g.blocking && g.onError === "halt"));
assert.equal(
  stageOf("validation").approval,
  undefined,
  "validation is the independent reviewer's, not a human gate",
);
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
  /REQUIREMENTS AND SCOPE -> SCENARIOS -> TEST PLAN -> TEST CASES -> IMPLEMENTATION -> EXECUTION -> DEBUGGING -> EVIDENCE -> VALIDATION -> RELEASE/,
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
assert.match(guidance, /gates\.mjs approve --phase-dir <phase> G0/);
assert.match(guidance, /GSD checks it at `execute:wave:post`/);
assert.match(guidance, /GSD Core \d+\.\d+\.\d+ runs this pipeline/);
assert.equal(
  (guidance.match(/\*\*Gate G\d:\*\*/g) ?? []).length,
  6,
  "exactly six stages are gates",
);
assert.match(guidance, /mixed tasks/);
assert.match(guidance, /defect:/);
assert.match(guidance, /at most 2 times/);
assert.match(guidance, /Never auto-publish/);

// The read-only evaluator is told what to demand, never to plan, execute, or ship.
const evaluator = evaluatorGuidance();
assert.match(evaluator, /EVIDENCE review and VALIDATION only/);
assert.match(evaluator, /never write a PRD, scenarios, plan, or cases/);
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
