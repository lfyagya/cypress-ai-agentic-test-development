import { isDeepStrictEqual } from "node:util";

// The delivery pipeline every test-development task runs, as data. The generated instructions, the
// conformance check, and the approval kinds task control records are all derived from this one
// object, so they cannot describe different workflows.
//
// A stage with `approval` is a gate: a human approves its document before the next stage starts, and
// the approval is recorded under that artifact kind (see APPROVAL_KINDS in lib/task-protocol.mjs).
export const GSD_WORKFLOW = {
  version: 1,
  model: "gsd",
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
      title: "PRD",
      artifact: "PRD.md",
      sources: ["tickets", "confluence", "figma", "documentation", "api"],
      does: "Collect the product requirements from every declared source and reconcile them into one PRD. Record conflicts and gaps between sources instead of resolving them silently.",
      approval: "prd",
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
      does: "From the approved PRD, plan the testing in sections by format. For each section say what it covers, which lane owns it, what is out of scope, and the environment and data it needs.",
      approval: "plan",
    },
    {
      id: "test-cases",
      title: "Test cases",
      artifact: "TEST-CASES.md",
      inputs: ["specs", "codebase", "existing automation coverage"],
      does: "From the approved plan, write detailed cases that cover each flow end to end. Read the specs and the code, and check existing automation first: mark every case new, extended, or already covered, and never duplicate coverage.",
      approval: "test-cases",
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
      does: "Implement only approved cases, following the framework's architecture and rules. Reuse existing commands, helpers, and fixtures before adding new ones.",
    },
    {
      id: "execution",
      title: "Execution",
      does: "Run the focused tests first, then the impacted regression checks, using the project's own commands.",
    },
    {
      id: "debugging",
      title: "Debugging",
      does: "Diagnose each failure from its evidence and fix the root cause, not the symptom.",
    },
    {
      id: "evidence",
      title: "Evidence",
      does: "Record the runs as evidence and link every case to its requirement. Without recorded evidence the work is not complete.",
    },
    {
      id: "validation",
      title: "Validation",
      does: "Reconcile the results against the approved PRD, plan, and cases, and list every gap. An independent reviewer judges this stage, not the author.",
      approval: "verification",
    },
    {
      id: "release",
      title: "Release",
      does: "Prepare release material only. A human decides, performs, or authorises the release: an agent never publishes, merges, or deploys.",
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

const stageNames = (workflow) =>
  workflow.pipeline.map((s) => s.title.toUpperCase()).join(" -> ");

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
    ? ` **Gate:** stop for human approval, recorded with \`approve --artifact ${s.approval}\`, before the next stage.`
    : "";
  const artifact = s.artifact
    ? ` (\`${workflow.planningRoot}/${workflow.artifacts.phases}/<phase>/${s.artifact}\`)`
    : "";
  return `${index + 1}. **${s.title}**${artifact} — ${s.does}${lists}${gate}`;
}

export function workflowGuidance(workflow = GSD_WORKFLOW) {
  return `## GSD workflow — required for every task

Work state lives in \`${workflow.planningRoot}/\` (${Object.values(workflow.artifacts).join(", ")}). Keep one bounded outcome per phase, and keep that phase's stage documents under \`${workflow.planningRoot}/${workflow.artifacts.phases}/<phase>/\`.

Run the delivery pipeline in order, one stage at a time: **${stageNames(workflow)}**. Scale each stage to the task — a small change gets a short section — but never skip a stage or a gate.

${workflow.pipeline.map((s, i) => stageLine(workflow, s, i)).join("\n")}

Never infer approval from an agent response or from green tests. Changing an approved upstream document (PRD, plan, or cases) invalidates the downstream work and its approvals; re-check it.

Classify each task before planning. Apply every obligation for mixed tasks; if the classification changes scope or risk, stop and clarify rather than dropping a workflow:

${taskList(workflow)}

Repair a repeated failure at most ${workflow.invariants.repairAttemptsPerFailure} times without new evidence, then stop and report the blocker. Completion requires recorded verification evidence. Never auto-publish, merge, or perform external side effects.`;
}

// The read-only evaluator cannot write documents, implement, run, or release, so handing it the
// builder's pipeline contradicts its role. It gets the same proof obligations, framed as what to demand.
export function evaluatorGuidance(workflow = GSD_WORKFLOW) {
  return `## GSD workflow — your role as the independent evaluator

The delivery pipeline is ${stageNames(workflow)}. You work the EVIDENCE review and VALIDATION only: you cannot edit files or run commands, so you never write a PRD, plan, or cases, implement, execute, approve, or release. Read \`${workflow.planningRoot}/\` (requirements, roadmap, state, and the phase's PRD, test plan, and test cases) as the record of what was approved, and judge the supplied change against it and the proof its task type requires:

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
