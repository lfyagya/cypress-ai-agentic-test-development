import crypto from "node:crypto";

export const TASK_VERSION = 1;
export const PROOF_MODES = new Set([
  "source-tdd",
  "automation-evidence",
  "no-test",
]);
export const TASK_STATES = new Set(["queued", "claimed", "verified", "landed"]);

const REQUIREMENT_DIGEST_FIELDS = [
  "id",
  "module",
  "title",
  "acceptanceCriteria",
  "preconditions",
  "expectedOutcome",
  "type",
  "priority",
  "tier",
  "path",
  "source",
];

export function contentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function createTask({
  id,
  requirements,
  proofMode,
  noTestReason = "",
  requirementDigests = null,
}) {
  const task = {
    version: TASK_VERSION,
    id,
    requirements: [...new Set(requirements)],
    ...(requirementDigests ? { requirementDigests } : {}),
    proofMode,
    noTestReason,
    dependencies: [],
    status: "queued",
    claim: null,
    approvals: {},
    evidence: null,
  };
  validateTask(task);
  return task;
}

export function validateTask(task) {
  if (task?.version !== TASK_VERSION) {
    throw new Error(`task version must be ${TASK_VERSION}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(task.id ?? "")) {
    throw new Error(
      "task id must contain only letters, numbers, '.', '_' or '-'",
    );
  }
  if (!Array.isArray(task.requirements) || task.requirements.length === 0) {
    throw new Error("task requires at least one harness requirement id");
  }
  if (new Set(task.requirements).size !== task.requirements.length) {
    throw new Error("task requirement ids must be unique");
  }
  if (task.requirementDigests !== undefined) {
    if (
      !task.requirementDigests ||
      typeof task.requirementDigests !== "object" ||
      Array.isArray(task.requirementDigests)
    ) {
      throw new Error("task requirementDigests must be an object");
    }
    const digestIds = Object.keys(task.requirementDigests).sort();
    const requirementIds = [...task.requirements].sort();
    if (
      digestIds.length !== requirementIds.length ||
      digestIds.some((id, index) => id !== requirementIds[index]) ||
      digestIds.some(
        (id) => !/^[0-9a-f]{64}$/i.test(task.requirementDigests[id]),
      )
    ) {
      throw new Error(
        "task requirementDigests must contain one SHA-256 digest per requirement",
      );
    }
  }
  if (!PROOF_MODES.has(task.proofMode)) {
    throw new Error(`proofMode must be one of: ${[...PROOF_MODES].join(", ")}`);
  }
  if (task.proofMode === "no-test" && !task.noTestReason?.trim()) {
    throw new Error("no-test tasks require a non-empty noTestReason");
  }
  if (
    task.proofMode === "source-tdd" &&
    task.sourceTdd &&
    typeof task.sourceTdd.testCommand !== "string"
  ) {
    throw new Error("source-tdd task testCommand must be a string");
  }
  if (!TASK_STATES.has(task.status)) {
    throw new Error(`unknown task status: ${task.status}`);
  }
  if (
    new Set(["verified", "landed"]).has(task.status) &&
    !/^[0-9a-f]{7,64}$/i.test(task.verifiedCommit ?? "")
  ) {
    throw new Error("verified tasks require a verification commit SHA");
  }
  if (
    new Set(["verified", "landed"]).has(task.status) &&
    task.requirementDigests === undefined
  ) {
    throw new Error("verified tasks require requirement digests");
  }
  if (!Array.isArray(task.dependencies)) {
    throw new Error("task dependencies must be an array");
  }
  return task;
}

export function activeRequirementIds(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.requirements)) {
    throw new Error(
      "evidence/requirements.json must contain version 1 and requirements[]",
    );
  }
  return new Set(
    registry.requirements
      .filter((requirement) => requirement.status === "active")
      .map((requirement) => requirement.id),
  );
}

export function requirementDigest(requirement) {
  return contentHash(
    JSON.stringify(
      Object.fromEntries(
        REQUIREMENT_DIGEST_FIELDS.map((field) => [
          field,
          requirement[field] ?? null,
        ]),
      ),
    ),
  );
}

function activeRequirementsById(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.requirements)) {
    throw new Error(
      "evidence/requirements.json must contain version 1 and requirements[]",
    );
  }
  return new Map(
    registry.requirements
      .filter((requirement) => requirement.status === "active")
      .map((requirement) => [requirement.id, requirement]),
  );
}

export function snapshotRequirementDigests(requirements, registry) {
  const active = activeRequirementsById(registry);
  const unknown = requirements.filter((id) => !active.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `task references inactive or unknown requirement id(s): ${unknown.join(", ")}`,
    );
  }
  return Object.fromEntries(
    requirements.map((id) => [id, requirementDigest(active.get(id))]),
  );
}

export function validateRequirementDigests(task, registry) {
  const expected = snapshotRequirementDigests(task.requirements, registry);
  if (!task.requirementDigests) {
    throw new Error("task has no requirement digest snapshot");
  }
  for (const id of task.requirements) {
    if (task.requirementDigests[id] !== expected[id]) {
      throw new Error(
        `requirement ${id} changed after task creation; create a new task from the approved requirement`,
      );
    }
  }
}

export function validateRequirementLinks(task, activeIds) {
  const unknown = task.requirements.filter((id) => !activeIds.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `task references inactive or unknown requirement id(s): ${unknown.join(", ")}`,
    );
  }
}

export function dependenciesReady(task, byId) {
  const blocked = task.dependencies.filter(
    (id) => byId.get(id)?.status !== "landed",
  );
  return { ready: blocked.length === 0, blocked };
}

export function approveArtifact(task, kind, path, content, by, at) {
  if (!/[A-Za-z0-9]/.test(by ?? "")) {
    throw new Error("approval requires an approver identity");
  }
  if (!content) throw new Error(`cannot approve empty ${kind} artifact`);
  return {
    ...task,
    approvals: {
      ...task.approvals,
      [kind]: { path, sha256: contentHash(content), by, at },
    },
  };
}

export function approvalState(task, kind, path, content) {
  const approval = task.approvals?.[kind];
  if (!approval) return { ok: false, reason: `${kind} is not approved` };
  if (approval.path !== path) {
    return {
      ok: false,
      reason: `${kind} approval belongs to ${approval.path}`,
    };
  }
  if (approval.sha256 !== contentHash(content)) {
    return { ok: false, reason: `${kind} changed after approval` };
  }
  return { ok: true, approval };
}

export function transition(task, to) {
  const allowed = {
    queued: new Set(["claimed"]),
    claimed: new Set(["verified"]),
    verified: new Set(["landed"]),
    landed: new Set(),
  };
  if (!allowed[task.status]?.has(to)) {
    throw new Error(`cannot move task from ${task.status} to ${to}`);
  }
  return { ...task, status: to };
}

export function isTestPath(file) {
  return (
    /(^|\/)(tests?|__tests__|spec)\//i.test(file) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(file) ||
    /_test\.[a-z0-9]+$/i.test(file) ||
    /(^|\/)test_[^/]+\.[a-z0-9]+$/i.test(file)
  );
}

export function isDocumentationPath(file) {
  return /\.(md|mdx)$/i.test(file);
}

/** Groups `Harness-Phase: red|green|refactor B-N` records in commit order. */
export function groupSourceTddPhases(phases) {
  const groups = new Map();
  for (const phase of phases) {
    const match = /^(red|green|refactor)\s+(B-\d+)$/.exec(phase.value.trim());
    if (!match)
      throw new Error(`invalid Harness-Phase trailer on ${phase.sha}`);
    const [, kind, behavior] = match;
    const group = groups.get(behavior) ?? {
      behavior,
      red: null,
      green: null,
      refactors: [],
    };
    if (kind === "red") {
      if (group.red || group.green)
        throw new Error(`${behavior} has more than one RED or RED after GREEN`);
      group.red = phase.sha;
    } else if (kind === "green") {
      if (!group.red || group.green)
        throw new Error(`${behavior} has no pending RED for GREEN`);
      group.green = phase.sha;
    } else {
      if (!group.green)
        throw new Error(`${behavior} has no GREEN for REFACTOR`);
      group.refactors.push(phase.sha);
    }
    groups.set(behavior, group);
  }
  const incomplete = [...groups.values()].filter(
    (group) => !group.red || !group.green,
  );
  if (incomplete.length) {
    throw new Error(
      `incomplete source-tdd behavior(s): ${incomplete.map((group) => group.behavior).join(", ")}`,
    );
  }
  return [...groups.values()];
}
