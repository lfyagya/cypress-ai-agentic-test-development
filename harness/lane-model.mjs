import { PATTERNS, patternsForTeam } from "./patterns.mjs";

// pytest is declarable so a profile can state every lane it has; composing a pytest lane needs an
// adapters/pytest.json (L2) that does not exist yet, and compose says so instead of guessing.
// `source` is the engine's own language-neutral adapter for product code: a lane on it belongs to the
// dev team, every other adapter to QA. Both teams share the gates, the git gate and the rule checker.
export const LANE_ADAPTERS = new Set([
  "cypress",
  "playwright",
  "pytest",
  "source",
]);
export const laneTeam = (lane) => (lane?.adapter === "source" ? "dev" : "qa");
const SPEC_MARKER = { cypress: ".cy.", playwright: ".spec.", pytest: "test_" };
// What a lane tests. Layer (frontend, backend, e2e), type (functional, integration, regression,
// smoke), or anything else a team needs: `other` is the escape hatch, so no kind of test is
// unrepresentable. A project declares as many lanes as it has kinds of tests.
export const LANE_KINDS = new Set([
  "e2e",
  "frontend",
  "backend",
  "functional",
  "regression",
  "smoke",
  "api",
  "contract",
  "integration",
  "component",
  "performance",
  "accessibility",
  "other",
]);
export const LANE_ENVIRONMENTS = new Set([
  "local",
  "dev",
  "qa",
  "staging",
  "production",
]);
export const LANE_MUTATION_MODES = new Set([
  "read-only",
  "allowlisted",
  "approved",
]);

const REQUIRED_PATHS = {
  qa: ["testRoot", "configRoot", "commandRoot", "specGlob"],
  // Product code and its tests; specGlob names the test files.
  dev: ["sourceRoot", "testRoot", "specGlob"],
};
const REQUIRED_WIRING = ["packageManager", "workspacePackage", "verifyScript"];
const REQUIRED_STRATEGY = ["auth", "testData", "credentialSource"];
const SAFETY_KEYS = new Set([
  "targets",
  "mutation",
  "allowedOperations",
  "approver",
  "reason",
]);
export const PROFILE_BLOCK_SCHEMAS = {
  wiring: {
    packageManager: ["npm", "yarn", "pnpm", "pip", "maven", "gradle"],
    workspacePackage: "boolean",
    verifyScript: "string",
  },
  strategy: {
    auth: [
      "cached-session",
      "storage-state",
      "per-test-login",
      "token-injection",
    ],
    testData: ["fresh", "seeded", "cached-fixture"],
    credentialSource: ["vault", "env", "ci-secret"],
  },
};

function present(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !/^<.*>$/.test(value.trim())
  );
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A lane overrides the shared block field-by-field. Absent on both sides stays `undefined`, and a
// malformed value is returned as written: spreading either into `{}` would make an undeclared block
// appear (changing every composed config) and a bad one (`[]`) pass for an empty valid one.
function mergeProfileBlock(lane, profile, key) {
  const parts = [profile[key], lane[key]].filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;
  const bad = parts.findIndex((part) => !isPlainObject(part));
  return bad === -1 ? Object.assign({}, ...parts) : parts[bad];
}

export function profileBlockIssues(name, block, blockType = name) {
  const schema = PROFILE_BLOCK_SCHEMAS[blockType];
  if (block === undefined) return [];
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return [`${name} must be an object`];
  }
  const issues = [];
  for (const [key, value] of Object.entries(block)) {
    if (key.startsWith("$")) continue;
    const expected = schema?.[key];
    if (!expected) {
      issues.push(
        `${name}.${key} is not a known key. Known: ${Object.keys(schema ?? {}).join(", ")}`,
      );
    } else if (Array.isArray(expected)) {
      if (!expected.includes(value)) {
        issues.push(
          `${name}.${key} is "${value}"; expected one of ${expected.join(", ")}`,
        );
      }
    } else if (typeof value !== expected) {
      issues.push(`${name}.${key} must be a ${expected}, got ${typeof value}`);
    }
    // A free-form string (verifyScript) may still be a <placeholder> here: composing a template or
    // an in-progress example must work, and readiness is the gate that flags it as unfinished.
  }
  return issues;
}

export function profileLanes(profile) {
  if (profile.lanes === undefined) {
    return [
      {
        ...profile,
        id: "default",
        name: profile.displayName ?? profile.projectName ?? "Default lane",
        kind: "e2e",
        repo: profile.repo,
      },
    ];
  }
  return Array.isArray(profile.lanes) ? profile.lanes : [];
}

export function laneModelIssues(profile) {
  if (profile.lanes === undefined) return [];
  if (!Array.isArray(profile.lanes) || profile.lanes.length === 0) {
    return ["profile.lanes must be a non-empty array when present"];
  }

  const issues = [];
  const ids = new Set();
  for (const [index, lane] of profile.lanes.entries()) {
    const at = `profile.lanes[${index}]`;
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) {
      issues.push(`${at} must be an object`);
      continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lane.id ?? "")) {
      issues.push(`${at}.id must be a unique kebab-case lane id`);
    } else if (ids.has(lane.id)) {
      issues.push(`${at}.id duplicates lane "${lane.id}"`);
    } else {
      ids.add(lane.id);
    }
    if (!present(lane.name)) issues.push(`${at}.name is required`);
    if (!LANE_ADAPTERS.has(lane.adapter)) {
      issues.push(
        `${at}.adapter must be one of ${[...LANE_ADAPTERS].join(", ")}`,
      );
    }
    if (!LANE_KINDS.has(lane.kind)) {
      issues.push(`${at}.kind must be one of ${[...LANE_KINDS].join(", ")}`);
    }
    const team = laneTeam(lane);
    const pattern =
      lane.pattern ?? (team === "dev" ? undefined : profile.pattern);
    if (pattern !== undefined && !patternsForTeam(team).includes(pattern)) {
      issues.push(
        `${at}.pattern must be one of ${patternsForTeam(team).join(", ")} for a ${team} lane`,
      );
    }
    if (!present(lane.repo ?? profile.repo)) {
      issues.push(`${at}.repo or profile.repo must identify its repository`);
    }

    for (const [block, fields] of [
      ["paths", REQUIRED_PATHS[team]],
      ["wiring", REQUIRED_WIRING],
      ["strategy", REQUIRED_STRATEGY],
    ]) {
      const value = mergeProfileBlock(lane, profile, block);
      if (value === undefined) {
        issues.push(`${at}.${block} is required`);
        continue;
      }
      if (!isPlainObject(value)) {
        issues.push(`${at}.${block} must be an object`);
        continue;
      }
      for (const field of fields) {
        if (value[field] === undefined || value[field] === null) {
          issues.push(`${at}.${block}.${field} is required`);
        } else if (typeof value[field] !== "string" && block !== "wiring") {
          issues.push(`${at}.${block}.${field} must be a string`);
        } else if (typeof value[field] === "string" && !present(value[field])) {
          issues.push(`${at}.${block}.${field} is required`);
        }
      }
      if (block === "paths" && typeof value.specGlob === "string") {
        const marker = SPEC_MARKER[lane.adapter];
        if (marker && !value.specGlob.includes(marker)) {
          issues.push(
            `${at}.paths.specGlob must use "${marker}" for the ${lane.adapter} adapter`,
          );
        }
      }
      if (block === "wiring" || block === "strategy") {
        issues.push(...profileBlockIssues(`${at}.${block}`, value, block));
      }
    }

    const safety = lane.safety;
    if (!safety || typeof safety !== "object" || Array.isArray(safety)) {
      issues.push(`${at}.safety is required`);
      continue;
    }
    for (const key of Object.keys(safety)) {
      if (!key.startsWith("$") && !SAFETY_KEYS.has(key)) {
        issues.push(
          `${at}.safety.${key} is not a known key. Known: ${[...SAFETY_KEYS].join(", ")}`,
        );
      }
    }
    if (
      !Array.isArray(safety.targets) ||
      safety.targets.length === 0 ||
      safety.targets.some((target) => !LANE_ENVIRONMENTS.has(target)) ||
      new Set(safety.targets).size !== safety.targets.length
    ) {
      issues.push(
        `${at}.safety.targets must be a non-empty, unique list of ${[...LANE_ENVIRONMENTS].join(", ")}`,
      );
    }
    if (!LANE_MUTATION_MODES.has(safety.mutation)) {
      issues.push(
        `${at}.safety.mutation must be one of ${[...LANE_MUTATION_MODES].join(", ")}`,
      );
      continue;
    }
    if (
      (lane.kind === "smoke" || safety.targets?.includes("production")) &&
      safety.mutation !== "read-only"
    ) {
      issues.push(
        `${at}.safety.mutation must be read-only for smoke or production-targeting lanes`,
      );
    }
    if (
      safety.mutation === "allowlisted" &&
      (!Array.isArray(safety.allowedOperations) ||
        safety.allowedOperations.length === 0 ||
        new Set(safety.allowedOperations).size !==
          safety.allowedOperations.length ||
        safety.allowedOperations.some((operation) => !present(operation)))
    ) {
      issues.push(
        `${at}.safety.allowedOperations must name the permitted writes for allowlisted lanes`,
      );
    }
    if (
      safety.mutation === "approved" &&
      (!present(safety.approver) || !present(safety.reason))
    ) {
      issues.push(
        `${at}.safety.approver and safety.reason are required for approved writes`,
      );
    }
  }
  return issues;
}

export function selectLane(profile, laneId) {
  const lanes = profileLanes(profile);
  if (lanes.length === 0) {
    throw new Error("profile.lanes must contain at least one lane");
  }
  if (laneId === undefined || laneId === null || laneId === "") {
    if (lanes.length > 1) {
      throw new Error(
        `profile "${profile.key}" defines multiple lanes; select one with --lane <id>: ` +
          lanes.map((lane) => lane.id).join(", "),
      );
    }
    return lanes[0];
  }
  const lane = lanes.find((candidate) => candidate.id === laneId);
  if (!lane) {
    throw new Error(
      `unknown lane "${laneId}" in profile "${profile.key}". Known: ` +
        lanes.map((candidate) => candidate.id).join(", ") +
        ". Pass --lane <id>.",
    );
  }
  return lane;
}

export function laneProfile(profile, lane) {
  return {
    ...profile,
    ...lane,
    adapter: lane.adapter ?? profile.adapter,
    // A dev lane never inherits the profile's test architecture; it falls back to its adapter's own.
    pattern:
      lane.pattern ?? (laneTeam(lane) === "dev" ? undefined : profile.pattern),
    paths: mergeProfileBlock(lane, profile, "paths"),
    wiring: mergeProfileBlock(lane, profile, "wiring"),
    strategy: mergeProfileBlock(lane, profile, "strategy"),
    ruleOverrides: mergeProfileBlock(lane, profile, "ruleOverrides"),
  };
}

// The declared mutation boundary, restated where agents read it. The safety block is validated and
// drift-checked, but nothing hooks it at runtime; without this, no instruction says what a lane may write.
export function laneSafetyGuidance(project) {
  const safety = project?.safety;
  if (!safety) return "";
  const readOnly =
    "**read-only** — tests must not create, change, or delete data.";
  const policy =
    {
      "read-only": readOnly,
      allowlisted: `**allowlisted** — writes are limited to: ${(safety.allowedOperations ?? []).join("; ")}. Every other write is out of bounds.`,
      approved: `**approved** — writes were approved by ${safety.approver}: ${safety.reason}. Stay within that reason.`,
    }[safety.mutation] ?? readOnly;
  return `## Lane safety boundary

This repository serves lane \`${project.laneId}\` (${project.laneName}, ${project.laneKind}) and may only target: ${(safety.targets ?? []).join(", ")}. Mutation policy: ${policy}

Plan sections whose format belongs to another lane are recorded in the test plan for that lane, not implemented here. Stop and ask rather than touch a target or perform a write outside this declaration. It changes only through the project profile, never inside a task.`;
}

const REPO_ACCESS = new Set(["write", "read"]);
const isRegex = (source) => {
  try {
    new RegExp(source);
    return typeof source === "string" && source !== "";
  } catch {
    return false;
  }
};
const stringList = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.trim() !== "");

// The optional multi-repo and git-gate blocks. `workspace.repos` lists every clone a workspace holds
// (lanes write, product source reads); `git` feeds scripts/engine/git-gate.mjs; `gates` the phase
// ledger's marker prefix and ticket key. All three are project data, so none of them is an engine change.
export function workspaceIssues(profile) {
  const issues = [];
  const { workspace, git, gates } = profile;
  let repos;
  if (workspace !== undefined) {
    if (
      !isPlainObject(workspace) ||
      !isPlainObject(workspace.repos) ||
      !Object.keys(workspace.repos).length
    ) {
      issues.push(
        "profile.workspace.repos must be a non-empty object of <folder>: { branch, access }",
      );
    } else {
      repos = workspace.repos;
      for (const [name, repo] of Object.entries(repos)) {
        const at = `profile.workspace.repos.${name}`;
        if (!/^[A-Za-z0-9._-]+$/.test(name))
          issues.push(`${at}: the key must be a folder name`);
        if (!isPlainObject(repo)) {
          issues.push(`${at} must be an object`);
          continue;
        }
        if (!present(repo.branch)) issues.push(`${at}.branch is required`);
        if (!REPO_ACCESS.has(repo.access))
          issues.push(`${at}.access must be write or read`);
        if (repo.url !== undefined && !present(repo.url))
          issues.push(`${at}.url must name the remote`);
      }
      for (const [index, lane] of profileLanes(profile).entries()) {
        const repo = lane.repo ?? profile.repo;
        if (!repos[repo])
          issues.push(
            `profile.lanes[${index}].repo "${repo}" is not in profile.workspace.repos`,
          );
        else if (repos[repo].access !== "write")
          issues.push(
            `profile.lanes[${index}].repo "${repo}" is read-only in profile.workspace.repos; a lane writes tests`,
          );
      }
    }
  }
  if (git !== undefined) {
    if (!isPlainObject(git)) issues.push("profile.git must be an object");
    else {
      for (const key of Object.keys(git).filter((k) => !k.startsWith("$"))) {
        if (!["protectedBranches", "secretFiles", "blockedPaths"].includes(key))
          issues.push(
            `profile.git.${key} is not a known key. Known: protectedBranches, secretFiles, blockedPaths`,
          );
        else if (!stringList(git[key]))
          issues.push(`profile.git.${key} must be a non-empty list of strings`);
        else if (key !== "secretFiles" && !git[key].every(isRegex))
          issues.push(
            `profile.git.${key} entries must be valid regular expressions`,
          );
      }
    }
  }
  if (gates !== undefined) {
    if (!isPlainObject(gates)) issues.push("profile.gates must be an object");
    else {
      if (
        gates.markerPrefix !== undefined &&
        !/^[A-Za-z][A-Za-z0-9 _-]*$/.test(gates.markerPrefix)
      )
        issues.push(
          "profile.gates.markerPrefix must be a plain word, e.g. ACME",
        );
      if (gates.ticketPattern !== undefined && !isRegex(gates.ticketPattern))
        issues.push(
          "profile.gates.ticketPattern must be a valid regular expression",
        );
    }
  }
  return issues;
}
