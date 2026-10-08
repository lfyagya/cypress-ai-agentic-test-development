#!/usr/bin/env node
/**
 * Is this clone's project profile complete and locked?
 * Source of truth is harness/profiles/projects/<key>.json — not invented facts.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  laneModelIssues,
  laneProfile,
  profileBlockIssues,
  selectLane,
} from "../../harness/lane-model.mjs";
import {
  sourcesIssues,
  workflowIssues,
} from "../../harness/workflow-model.mjs";

export const CONFIGURE_RE =
  /harness:init|harness:check|harness:ready|harness:lock|harness:compose|harness:sync|configure\.prompt|configure the (\w+ )?harness|(fill( in)?|edit|fix) (the )?(harness (config|profile)|harness\.config|project profile)/i;

const REQUIRED_PROFILE = ["key", "displayName", "owner", "projectName"];
const LEGACY_REQUIRED_PROFILE = ["repo", "adapter", "pattern"];
const REQUIRED_BLOCKS = {
  paths: ["testRoot", "configRoot", "commandRoot", "specGlob"],
  wiring: ["packageManager", "workspacePackage", "verifyScript"],
  strategy: ["auth", "testData", "credentialSource"],
};

// Datastore access is a project fact, not harness policy — the same reason `adapter` and `language`
// live in the profile. The engine does not pick a driver or ship one; it records which the project
// declared so the adapter can wire it and the rules can key on it.
//
// Optional: a project with no datastore access omits the block entirely and nothing changes. But a
// block that IS present must be complete, because a half-declared datastore is how a suite ends up
// pointing at the wrong database.
const DATASTORE_DRIVERS = new Set([
  "postgres",
  "mysql",
  "mssql",
  "oracle",
  "mongodb",
  "none",
]);
// How tests reach the data layer. `direct` asserts what was actually persisted and needs a
// least-privilege credential; `test-api` asks the service what it stored, which needs no credential
// but verifies a report rather than the store; `both` seeds through the application's own API so
// business rules run, then asserts the row directly.
const DATASTORE_ACCESS = new Set(["direct", "test-api", "both", "none"]);

function isPlaceholder(value) {
  if (value == null || String(value).trim() === "") return true;
  const t = String(value).trim();
  return t.startsWith("<") && t.endsWith(">");
}

function adaptersOn(adapters) {
  if (!adapters || typeof adapters !== "object") return false;
  return Object.values(adapters).some((a) => a === true || a?.enabled === true);
}

export function findProfile(root, projectName) {
  const dir = join(root, "harness", "profiles", "projects");
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const path = join(dir, file);
    try {
      const profile = JSON.parse(readFileSync(path, "utf8"));
      if (
        profile.projectName === projectName ||
        (!projectName && profile.key)
      ) {
        return { path, profile };
      }
    } catch {
      /* skip broken sibling profiles */
    }
  }
  return null;
}

function profileIssues(profile, laneId) {
  const issues = [];
  for (const field of REQUIRED_PROFILE) {
    if (isPlaceholder(profile[field])) {
      issues.push(
        `profile.${field} is missing or still a template placeholder`,
      );
    }
  }
  if (profile.lanes === undefined) {
    for (const field of LEGACY_REQUIRED_PROFILE) {
      if (isPlaceholder(profile[field])) {
        issues.push(
          `profile.${field} is missing or still a template placeholder`,
        );
      }
    }
    for (const [block, fields] of Object.entries(REQUIRED_BLOCKS)) {
      if (!profile[block] || typeof profile[block] !== "object") {
        issues.push(`profile.${block} is required`);
        continue;
      }
      for (const field of fields) {
        if (isPlaceholder(profile[block][field])) {
          issues.push(
            `profile.${block}.${field} is missing or still a template placeholder`,
          );
        } else if (
          typeof profile[block][field] !== "string" &&
          block !== "wiring"
        ) {
          issues.push(`profile.${block}.${field} must be a string`);
        }
      }
      if (block === "wiring" || block === "strategy") {
        issues.push(
          ...profileBlockIssues(`profile.${block}`, profile[block], block),
        );
      }
    }
  } else {
    issues.push(...laneModelIssues(profile));
    try {
      const lane = selectLane(profile, laneId);
      const facts = laneProfile(profile, lane);
      if (laneId === undefined) {
        issues.push(
          "harness.config.json project.laneId is required for a lane-based profile",
        );
      }
      for (const [block, fields] of Object.entries(REQUIRED_BLOCKS)) {
        const value = facts[block];
        for (const field of fields) {
          if (isPlaceholder(value?.[field])) {
            issues.push(
              `selected lane ${lane.id} ${block}.${field} is missing or still a template placeholder`,
            );
          }
        }
      }
    } catch (error) {
      issues.push(error.message);
    }
  }
  if (!adaptersOn(profile.adapters)) {
    issues.push("profile.adapters must enable at least one AI tool");
  }
  issues.push(...datastoreIssues(profile.datastore));
  return issues;
}

export function datastoreIssues(datastore) {
  if (datastore === undefined) return [];
  const issues = [];
  if (!datastore || typeof datastore !== "object") {
    return ["profile.datastore must be an object when present"];
  }
  if (
    datastore.readOnly !== undefined &&
    typeof datastore.readOnly !== "boolean"
  ) {
    issues.push("profile.datastore.readOnly must be a boolean when present");
  }
  if (
    datastore.writeApproval !== undefined &&
    (typeof datastore.writeApproval !== "string" ||
      isPlaceholder(datastore.writeApproval))
  ) {
    issues.push(
      "profile.datastore.writeApproval must name the person who approved writes",
    );
  }
  if (!DATASTORE_DRIVERS.has(datastore.driver)) {
    issues.push(
      `profile.datastore.driver must be one of ${[...DATASTORE_DRIVERS].join(", ")} ` +
        `(got ${JSON.stringify(datastore.driver)})`,
    );
  }
  if (!DATASTORE_ACCESS.has(datastore.access)) {
    issues.push(
      `profile.datastore.access must be one of ${[...DATASTORE_ACCESS].join(", ")} ` +
        `(got ${JSON.stringify(datastore.access)})`,
    );
  }
  const reaches =
    datastore.driver &&
    datastore.driver !== "none" &&
    datastore.access !== "none";
  if (reaches && isPlaceholder(datastore.credentialSource)) {
    issues.push(
      "profile.datastore.credentialSource is required once a datastore is reachable — name the " +
        "env var or secret holding a least-privilege connection string. Never the value itself.",
    );
  }
  const hasWriteApproval =
    typeof datastore.writeApproval === "string" &&
    !isPlaceholder(datastore.writeApproval);
  if (reaches && datastore.readOnly !== true && !hasWriteApproval) {
    issues.push(
      "profile.datastore declares write-capable access with no writeApproval — record who approved " +
        "tests writing to this datastore, or set readOnly: true.",
    );
  }
  return issues;
}

export function evaluateConfigReady(root) {
  const configPath = join(root, "harness.config.json");
  if (!existsSync(configPath)) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "missing",
      issues: [
        "harness.config.json is missing — compose the project profile first",
      ],
    };
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "broken",
      issues: [`harness.config.json is not valid JSON (${err.message})`],
    };
  }

  if (!config?.project?.name || !config.version || !config.hooks) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "broken",
      issues: [
        "harness.config.json is missing project.name, version, or hooks — re-compose",
      ],
    };
  }

  const workflowProblems = workflowIssues(config.workflow);
  if (workflowProblems.length > 0) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "unconfigured",
      issues: workflowProblems,
    };
  }

  if (!adaptersOn(config.adapters)) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "unconfigured",
      issues: ["harness.config.json has no enabled adapters"],
    };
  }

  const found = findProfile(root, config.project.name);
  if (!found) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "unconfigured",
      issues: [
        `no project profile matches project.name "${config.project.name}" under harness/profiles/projects/`,
      ],
    };
  }

  const issues = profileIssues(found.profile, config.project.laneId);
  issues.push(...sourcesIssues(found.profile.sources));
  if (!isDeepStrictEqual(config.project.sources, found.profile.sources)) {
    issues.push(
      "harness.config.json project.sources does not match the profile's sources; re-compose it",
    );
  }
  if (Array.isArray(found.profile.lanes)) {
    try {
      const lane = selectLane(found.profile, config.project.laneId);
      const facts = laneProfile(found.profile, lane);
      if (lane.adapter !== config.framework) {
        issues.push(
          `harness.config.json framework "${config.framework}" does not match lane "${lane.id}" adapter "${lane.adapter}"`,
        );
      }
      if (config.project.laneKind !== lane.kind) {
        issues.push(
          `harness.config.json project.laneKind does not match lane "${lane.id}"`,
        );
      }
      if (config.project.laneName !== lane.name) {
        issues.push(
          `harness.config.json project.laneName does not match lane "${lane.id}"`,
        );
      }
      if (config.project.repo !== (lane.repo ?? found.profile.repo)) {
        issues.push(
          `harness.config.json project.repo does not match lane "${lane.id}"`,
        );
      }
      if (config.project.pattern !== facts.pattern) {
        issues.push(
          `harness.config.json project.pattern does not match lane "${lane.id}"`,
        );
      }
      if (!isDeepStrictEqual(config.project.safety, lane.safety)) {
        issues.push(
          `harness.config.json project.safety does not match lane "${lane.id}" safety declaration`,
        );
      }
      for (const field of Object.keys(facts.paths ?? {})) {
        if (config.project[field] !== facts.paths[field]) {
          issues.push(
            `harness.config.json project.${field} does not match lane "${lane.id}" paths`,
          );
        }
      }
      for (const block of ["wiring", "strategy"]) {
        for (const field of Object.keys(facts[block] ?? {})) {
          if (config[block]?.[field] !== facts[block][field]) {
            issues.push(
              `harness.config.json ${block}.${field} does not match lane "${lane.id}"`,
            );
          }
        }
      }
    } catch {
      // profileIssues already reports an invalid or unselected lane.
    }
  } else if (found.profile.adapter !== config.framework) {
    issues.push(
      `harness.config.json framework "${config.framework}" does not match profile adapter "${found.profile.adapter}"`,
    );
  }
  if (issues.length) {
    return {
      ok: false,
      complete: false,
      locked: false,
      status: "unconfigured",
      issues,
      ...found,
    };
  }

  if (found.profile.locked !== true) {
    return {
      ok: false,
      complete: true,
      locked: false,
      status: "unlocked",
      issues: ["profile is complete but not locked — npm run harness:lock"],
      ...found,
    };
  }

  return {
    ok: true,
    complete: true,
    locked: true,
    status: "ready",
    issues: [],
    ...found,
  };
}

export function lockProjectProfile(root) {
  const result = evaluateConfigReady(root);
  if (
    result.status === "missing" ||
    result.status === "broken" ||
    result.status === "unconfigured"
  ) {
    return { ...result, lockedNow: false };
  }
  const profile = { ...result.profile, locked: true };
  writeFileSync(result.path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return { ...evaluateConfigReady(root), lockedNow: true };
}

export function formatReadyMessage(result, { allowConfigure = false } = {}) {
  const head = allowConfigure
    ? "[harness-config] Profile is not ready. This turn may ONLY fill or lock the project profile."
    : result.status === "unlocked"
      ? "[harness-config] BLOCKED: profile is complete but not locked. A lead must lock it before the team uses it."
      : "[harness-config] BLOCKED: harness config is missing, broken, or still the template.";
  const pipeline =
    "npm run harness:compose && npm run harness:sync && npm run harness:check && npm run harness:lock";
  const next =
    result.status === "unlocked"
      ? "Then: npm run harness:lock"
      : result.issues.some((issue) => /canonical GSD workflow/.test(issue))
        ? `The engine's GSD workflow is newer than this config. The profile needs no edits; regenerate:\n  ${pipeline}`
        : `Fill harness/profiles/projects/<key>.json (see harness/profiles/configure.prompt.md), then:\n  ${pipeline}`;
  const issues = result.issues.map((i) => `  - ${i}`).join("\n");
  return `${head}\n${next}${issues ? `\nIssues:\n${issues}` : ""}`.trim();
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const result = evaluateConfigReady(root);
  if (result.ok) {
    console.log("harness profile is complete and locked.");
    process.exit(0);
  }
  if (result.complete && !result.locked) {
    console.log("harness profile is complete.");
    console.error("Not locked — a lead must run: npm run harness:lock");
    process.exit(1);
  }
  console.error(formatReadyMessage(result));
  process.exit(1);
}
