import { isDeepStrictEqual } from "node:util";

// The delivery pipeline every test-development task runs, as data. The generated instructions, the
// conformance check, and the approval kinds task control records are all derived from this one
// object, so they cannot describe different workflows.
//
// A stage with `approval` is a gate: a human approves its artifacts before the next stage starts. The
// gates are G0-G5, recorded as a hash ledger per phase (scripts/gates.mjs) and, for task control,
// under the same ids (APPROVAL_KINDS in lib/task-protocol.mjs). `gatePoint` is the GSD Core loop point
// where the installed capability checks the gate; harness/capability/ is generated from it.
export const GSD_WORKFLOW = {
  version: 2,
  model: "gsd",
  // The GSD Core release the harness runs on. Pinned, never "latest": a GSD change that moves a gate
  // point must arrive as a deliberate engine release, not on the next npx run.
  gsd: {
    package: "@opengsd/gsd-core",
    version: "1.14.0",
    capability: "qa-harness",
  },
  planningRoot: ".planning",
  artifacts: {
    project: "PROJECT.md",
    requirements: "REQUIREMENTS.md",
    roadmap: "ROADMAP.md",
    state: "STATE.md",
    phases: "phases",
  },
  pipeline: [
    {
      id: "prd",
      title: "Requirements and scope",
      artifact: "PRD.md",
      sources: ["tickets", "confluence", "figma", "documentation", "api"],
      does: "Collect the product requirements from every declared source and reconcile them into one PRD that fixes the scope. Record conflicts and gaps between sources instead of resolving them silently.",
      approval: "G0",
      gatePoint: "discuss:post",
    },
    {
      id: "scenarios",
      title: "Scenarios",
      artifact: "SCENARIOS.md",
      does: "From the approved scope, list the happy, negative, and edge scenarios. Each one cites its acceptance criterion and the source that shows the behavior.",
      approval: "G1",
      gatePoint: "plan:pre",
    },
    {
      id: "test-plan",
      title: "Test plan",
      artifact: "TEST-PLAN.md",
      formats: [
        "backend",
        "frontend",
        "functional",
        "integration",
        "regression",
        "smoke",
      ],
      does: "From the approved scenarios, plan the testing in sections by format. For each section say what it covers, which lane owns it, what is out of scope, and the environment and data it needs.",
      approval: "G2",
      gatePoint: "plan:post",
    },
    {
      id: "test-cases",
      title: "Test cases",
      artifact: "TEST-CASES.md",
      inputs: ["specs", "codebase", "existing automation coverage"],
      does: "From the approved plan, write detailed cases that cover each flow end to end. Read the specs and the code, and check existing automation first: mark every case new, extended, or already covered, and never duplicate coverage.",
      approval: "G3",
      gatePoint: "plan:post",
    },
    {
      id: "implementation",
      title: "Implementation",
      standards: [
        "framework standard",
        "well structured",
        "reusable",
        "maintainable",
        "readable",
      ],
      does: "Implement only approved cases, following the framework's architecture and rules. Reuse existing commands, helpers, and fixtures before adding new ones. A human approves the exact diff, every changed file, before any test runs against it.",
      approval: "G4",
      gatePoint: "execute:wave:post",
    },
    {
      id: "execution",
      title: "Execution",
      does: "With G4 holding, run the focused tests first, then the impacted regression checks, using the project's own commands.",
    },
    {
      id: "debugging",
      title: "Debugging",
      does: "Diagnose each failure from its evidence and fix the root cause, not the symptom. A fix changes the approved diff, so G4 is approved again before the rerun.",
    },
    {
      id: "evidence",
      title: "Evidence",
      does: "Record the runs as evidence and link every case to its requirement. A human approves the evidence; without it the work is not complete.",
      approval: "G5",
      gatePoint: "ship:pre",
    },
    {
      id: "validation",
      title: "Validation",
      does: "Reconcile the results against the approved scope, scenarios, plan, and cases, and list every gap. An independent reviewer judges this stage, not the author.",
    },
    {
      id: "release",
      title: "Release",
      does: "With G5 holding, prepare release material only. A human decides, performs, or authorises the release: an agent never publishes, merges, or deploys.",
    },
  ],
  // The dev team's pipeline (lanes on the `source` adapter). Same gate ids at the same GSD points as
  // `pipeline`, so the one capability and the one ledger govern both teams; only the artifacts differ.
  devPipeline: [
    {
      id: "prd",
      title: "Requirements and scope",
      artifact: "PRD.md",
      sources: ["tickets", "confluence", "figma", "documentation", "api"],
      does: "Collect the requirements from every declared source into one PRD that fixes the scope and the acceptance criteria. Record conflicts and gaps between sources instead of resolving them silently.",
      approval: "G0",
      gatePoint: "discuss:post",
    },
    {
      id: "design",
      title: "Design",
      artifact: "DESIGN.md",
      does: "From the approved scope, decide the approach: components touched, interfaces and contracts, data and migration changes, security and performance impact, rollout and rollback. Reuse what exists before adding anything new.",
      approval: "G1",
      gatePoint: "plan:pre",
    },
    {
      id: "plan",
      title: "Plan",
      artifact: "PLAN.md",
      does: "From the approved design, list the tasks and, for each acceptance criterion, the behaviors to prove (B-1, B-2, ...) with the test that proves each one and the regression area it touches.",
      approval: "G2",
      gatePoint: "plan:post",
    },
    {
      id: "tests-first",
      title: "Tests first",
      artifact: "TESTS.md",
      does: "Write the failing test for each planned behavior before any implementation and record the red run (commit trailer `Harness-Phase: red B-n`). The human approves the tests and their failure output.",
      approval: "G3",
      gatePoint: "plan:post",
    },
    {
      id: "implementation",
      title: "Implementation",
      standards: [
        "project lint and type-check clean",
        "smallest change that turns each test green",
        "no new suppression, debugger or ticketless TODO",
        "reusable",
        "readable",
      ],
      does: "Make each failing test pass (`Harness-Phase: green B-n`), then refactor with the tests green. A human approves the exact diff, every changed file, before verification runs against it.",
      approval: "G4",
      gatePoint: "execute:wave:post",
    },
    {
      id: "verification",
      title: "Verification",
      does: "With G4 holding, run the project's own standard (lint, type-check, unit, integration) and the impacted regression checks, using the project's commands.",
    },
    {
      id: "debugging",
      title: "Debugging",
      does: "Diagnose each failure from its evidence and fix the root cause, not the symptom. A fix changes the approved diff, so G4 is approved again before the rerun.",
    },
    {
      id: "evidence",
      title: "Evidence",
      does: "Record the verification runs and link every behavior to its requirement and its test. A human approves the evidence; without it the work is not complete.",
      approval: "G5",
      gatePoint: "ship:pre",
    },
    {
      id: "review",
      title: "Review",
      does: "An independent reviewer reconciles the diff against the approved scope, design, and plan, and lists every gap. The author never reviews their own change.",
    },
    {
      id: "release",
      title: "Release",
      does: "With G5 holding, prepare release material only. A human decides, performs, or authorises the release: an agent never publishes, merges, or deploys.",
    },
  ],
  taskTypes: {
    feature: [
      "acceptance criteria",
      "source context",
      "dependency-aware plan",
      "focused tests",
      "regression impact",
      "verification evidence",
    ],
    defect: [
      "reproduction evidence",
      "source context",
      "regression test",
      "root-cause fix",
      "verification evidence",
    ],
    refactor: [
      "behavior baseline",
      "bounded scope",
      "dependency-aware plan",
      "regression tests",
      "verification evidence",
    ],
    test: [
      "requirement mapping",
      "scenario and test plan",
      "test implementation",
      "focused execution",
      "coverage evidence",
    ],
    "docs-config": [
      "scope and owner",
      "source-of-truth mapping",
      "schema or link validation",
      "verification evidence",
    ],
    research: [
      "bounded question",
      "source-backed context",
      "findings and uncertainty",
      "no implementation without a follow-up plan",
    ],
  },
  invariants: {
    planBeforeImplementation: true,
    humanApprovalAtEveryGate: true,
    verifyBeforeShip: true,
    upstreamChangesInvalidateDownstream: true,
    evidenceRequiredForCompletion: true,
    repairAttemptsPerFailure: 2,
    autoShip: false,
  },
};

export function workflowIssues(workflow) {
  if (!isDeepStrictEqual(workflow, GSD_WORKFLOW)) {
    return [
      "harness.config.json workflow does not match the canonical GSD workflow; re-compose it",
    ];
  }
  return [];
}

const stage = (workflow, id) => workflow.pipeline.find((s) => s.id === id);

/** The approval artifact kinds the pipeline's gates are recorded under, in pipeline order. */
export const approvalKinds = (workflow = GSD_WORKFLOW) =>
  workflow.pipeline.filter((s) => s.approval).map((s) => s.approval);

/** Gate checks as the GSD capability declares them: `{ gate, point }` in pipeline order. */
export const gatePoints = (workflow = GSD_WORKFLOW) =>
  workflow.pipeline
    .filter((s) => s.approval)
    .map((s) => ({ gate: s.approval, point: s.gatePoint }));

const GATE_COMMAND = (gate) =>
  `node scripts/gates.mjs check --phase-dir "\${PHASE_DIR}" --need ${gate}`;

// The GSD capability that makes GSD Core enforce the gates: every approval stage becomes a blocking
// command-exit-zero gate at its loop point. Generated, so the gates GSD runs cannot drift from the
// pipeline agents read; harness/capability/<id>/capability.json is this object, checked by the tests.
export function gsdCapability(workflow = GSD_WORKFLOW, version) {
  const id = workflow.gsd.capability;
  return {
    id,
    role: "feature",
    version,
    title: "QA harness gates",
    description:
      "The QA harness human approval gates G0-G5 as blocking GSD loop gates. A gate passes only while its approved artifacts still hash the same.",
    tier: "full",
    requires: [],
    engines: { gsd: `>=${workflow.gsd.version}` },
    runtimeCompat: { supported: ["*"], unsupported: [] },
    skills: [],
    agents: [],
    hooks: [],
    config: {
      "workflow.harness_gates": {
        type: "boolean",
        default: true,
        description:
          "Block the GSD loop until the QA harness approval gates (G0-G5) hold for the phase.",
      },
    },
    steps: [],
    contributions: [
      {
        point: "discuss:pre",
        into: "orchestrator",
        fragment: {
          inline:
            'QA harness: follow the "GSD workflow — required for every task" section of CLAUDE.md (or AGENTS.md). Each approval gate is a checkpoint:human-verify with gate="blocking-human"; show the artifacts and the `node scripts/gates.mjs card --phase-dir <phase>` output, then wait. An agent never approves a gate.',
        },
        produces: [],
        consumes: [],
        when: "workflow.harness_gates",
        onError: "halt",
      },
    ],
    gates: gatePoints(workflow).map(({ gate, point }) => ({
      point,
      check: {
        predicate: { kind: "command-exit-zero", command: GATE_COMMAND(gate) },
      },
      when: "workflow.harness_gates",
      blocking: true,
      onError: "halt",
    })),
  };
}

/** Where a project's PRD material can live; the keys a profile's `sources` block may declare. */
export const sourceKinds = (workflow = GSD_WORKFLOW) =>
  stage(workflow, "prd").sources;

// Locations only (a board, a space, a file, a spec URL). Never a credential.
export function sourcesIssues(sources, workflow = GSD_WORKFLOW) {
  if (sources === undefined) return [];
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    return ["profile.sources must be an object"];
  }
  const known = sourceKinds(workflow);
  const issues = [];
  for (const [key, value] of Object.entries(sources)) {
    if (key.startsWith("$")) continue;
    if (!known.includes(key)) {
      issues.push(
        `profile.sources.${key} is not a known source. Known: ${known.join(", ")}`,
      );
      continue;
    }
    const items = Array.isArray(value) ? value : [value];
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          typeof item !== "string" ||
          item.trim() === "" ||
          /^<.*>$/.test(item.trim()),
      )
    ) {
      issues.push(
        `profile.sources.${key} must name where it lives (a string or list of strings); delete the key if this project has none`,
      );
    }
  }
  return issues;
}

const taskList = (workflow) =>
  Object.entries(workflow.taskTypes)
    .map(([type, obligations]) => `- **${type}:** ${obligations.join("; ")}.`)
    .join("\n");

/** The pipeline a lane's team runs: `devPipeline` for dev lanes, `pipeline` (QA) otherwise. */
export const pipelineFor = (workflow = GSD_WORKFLOW, team = "qa") =>
  team === "dev" ? workflow.devPipeline : workflow.pipeline;

const stageNames = (workflow, team) =>
  pipelineFor(workflow, team)
    .map((s) => s.title.toUpperCase())
    .join(" -> ");

const LIST_LABELS = {
  sources: "Sources",
  formats: "Plan sections",
  inputs: "Inputs",
  standards: "Standards",
};

function stageLine(workflow, s, index) {
  const lists = Object.entries(LIST_LABELS)
    .filter(([key]) => s[key])
    .map(([key, label]) => ` ${label}: ${s[key].join(", ")}.`)
    .join("");
  const gate = s.approval
    ? ` **Gate ${s.approval}:** stop for human approval before the next stage. The human records it in an interactive terminal with \`node scripts/gates.mjs approve --phase-dir <phase> ${s.approval} <artifact>...\`; GSD checks it at \`${s.gatePoint}\`.`
    : "";
  const artifact = s.artifact
    ? ` (\`${workflow.planningRoot}/${workflow.artifacts.phases}/<phase>/${s.artifact}\`)`
    : "";
  return `${index + 1}. **${s.title}**${artifact} — ${s.does}${lists}${gate}`;
}

export function workflowGuidance(workflow = GSD_WORKFLOW, team = "qa") {
  return `## GSD workflow — required for every task

Work state lives in \`${workflow.planningRoot}/\` (${Object.values(workflow.artifacts).join(", ")}). Keep one bounded outcome per phase, and keep that phase's stage documents under \`${workflow.planningRoot}/${workflow.artifacts.phases}/<phase>/\`.

Run the ${team === "dev" ? "development" : "test-development"} pipeline in order, one stage at a time: **${stageNames(workflow, team)}**. Scale each stage to the task — a small change gets a short section — but never skip a stage or a gate.

${pipelineFor(workflow, team)
  .map((s, i) => stageLine(workflow, s, i))
  .join("\n")}

GSD Core ${workflow.gsd.version} runs this pipeline (\`/gsd-discuss-phase\` → \`/gsd-plan-phase\` → \`/gsd-execute-phase\` → \`/gsd-verify-work\` → \`/gsd-ship\`), and its \`${workflow.gsd.capability}\` capability blocks the loop at each gate. \`node scripts/gates.mjs status --phase-dir <phase>\` shows every gate and the next command.

Never infer approval from an agent response or from green tests. Changing an approved artifact reopens its gate and every gate after it; re-check it.

Classify each task before planning. Apply every obligation for mixed tasks; if the classification changes scope or risk, stop and clarify rather than dropping a workflow:

${taskList(workflow)}

Repair a repeated failure at most ${workflow.invariants.repairAttemptsPerFailure} times without new evidence, then stop and report the blocker. Completion requires recorded verification evidence. Never auto-publish, merge, or perform external side effects.`;
}

// The read-only evaluator cannot write documents, implement, run, or release, so handing it the
// builder's pipeline contradicts its role. It gets the same proof obligations, framed as what to demand.
export function evaluatorGuidance(workflow = GSD_WORKFLOW, team = "qa") {
  return `## GSD workflow — your role as the independent evaluator

The delivery pipeline is ${stageNames(workflow, team)}. You work the EVIDENCE review and ${team === "dev" ? "REVIEW" : "VALIDATION"} only: you cannot edit files or run commands, so you never write a PRD, scenarios, plan, or cases, implement, execute, approve, or release. Read \`${workflow.planningRoot}/\` (requirements, roadmap, state, the phase's PRD, scenarios, test plan, and test cases, and its APPROVALS.json gate ledger G0-G5) as the record of what was approved, and judge the supplied change against it and the proof its task type requires:

${taskList(workflow)}

Check that every gate has a recorded human approval, every case traces to the approved plan, existing coverage was reused rather than duplicated, and the implementation meets the stated standards. Missing evidence, a departure from the approved documents, or a skipped stage or gate is a finding to report, never something to assume. Approval is a human decision: do not grant it, and never imply that a PASS is one.`;
}

// What the declared sources say, restated where agents read it, so they collect from real places
// and ask about the rest instead of inventing them.
export function sourcesGuidance(sources, workflow = GSD_WORKFLOW) {
  const known = sourceKinds(workflow);
  const declared = known.filter((key) => sources?.[key] !== undefined);
  const undeclared = known.filter((key) => !declared.includes(key));
  const lines = declared.map(
    (key) => `- **${key}:** ${[].concat(sources[key]).join("; ")}`,
  );
  return `## PRD sources for this project

${lines.length ? lines.join("\n") : "- none declared"}

Collect the PRD from these.${undeclared.length ? ` Not declared: ${undeclared.join(", ")} — ask the owner whether they exist rather than guessing where they are.` : ""}`;
}

const SCAFFOLD = {
  project: `# Project

<!-- Team-owned. Created once by \`npm run harness:sync\` and never overwritten. -->

What this project tests, who owns it, and what "done" means for the suite. Keep it to one page:
agents load it as context for every task.
`,
  requirements: `# Requirements

<!-- Team-owned. Created once by \`npm run harness:sync\` and never overwritten. -->

Requirements in scope for the current roadmap. Do not copy acceptance criteria here: point each
item at its \`id\` in \`evidence/requirements.json\`, which stays the single registry.
`,
  roadmap: `# Roadmap

<!-- Team-owned. Created once by \`npm run harness:sync\` and never overwritten. -->

Ordered phases, one bounded outcome each. A phase keeps its PRD, test plan, test cases, and
executable plans in its own directory under \`phases/\`.
`,
  state: `# State

<!-- Team-owned. Created once by \`npm run harness:sync\` and never overwritten. -->

- Current phase: none
- Current stage: none
- Last verified: never
- Blockers: none
`,
};

// What harness:sync creates when absent and conformance I8 expects to find. Team-owned: sync
// never rewrites an existing file, and phases/ only has to exist.
export function planningScaffold(workflow = GSD_WORKFLOW) {
  const { planningRoot, artifacts } = workflow;
  return {
    files: Object.fromEntries(
      Object.keys(SCAFFOLD).map((key) => [
        `${planningRoot}/${artifacts[key]}`,
        SCAFFOLD[key],
      ]),
    ),
    directory: `${planningRoot}/${artifacts.phases}`,
  };
}
