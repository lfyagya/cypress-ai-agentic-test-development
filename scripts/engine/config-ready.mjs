#!/usr/bin/env node
/**
 * Is this clone's project profile complete and locked?
 * Source of truth is harness/profiles/projects/<key>.json — not invented facts.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIGURE_RE =
  /harness:init|harness:check|harness:ready|harness:lock|harness:compose|harness:sync|configure\.prompt|configure the (\w+ )?harness|(fill( in)?|edit|fix) (the )?(harness (config|profile)|harness\.config|project profile)/i;

const REQUIRED_PROFILE = [
  "key",
  "displayName",
  "owner",
  "projectName",
  "repo",
  "adapter",
];

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

function profileIssues(profile) {
  const issues = [];
  for (const field of REQUIRED_PROFILE) {
    if (isPlaceholder(profile[field])) {
      issues.push(
        `profile.${field} is missing or still a template placeholder`,
      );
    }
  }
  if (!adaptersOn(profile.adapters)) {
    issues.push("profile.adapters must enable at least one AI tool");
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

  const issues = profileIssues(found.profile);
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
  const next =
    result.status === "unlocked"
      ? "Then: npm run harness:lock"
      : "Fill harness/profiles/projects/<key>.json (see harness/profiles/configure.prompt.md), then:\n  npm run harness:compose && npm run harness:sync && npm run harness:check && npm run harness:lock";
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
