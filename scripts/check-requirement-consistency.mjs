#!/usr/bin/env node
/**
 * Requirement-registry consistency guard.
 *
 * `evidence:build` enforces uniqueness only inside one branch. This check also verifies that specs
 * reference active local ids and that an id already on the base branch is not redefined for a
 * different behavior.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, readJson } from "./lib/cli.mjs";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const COMPARED_FIELDS = [
  "module",
  "title",
  "expectedOutcome",
  "acceptanceCriteria",
  "preconditions",
];

export function canonical(requirement) {
  return JSON.stringify(
    Object.fromEntries(
      COMPARED_FIELDS.map((field) => [field, requirement[field] ?? null]),
    ),
  );
}

export function validateLocalRequirements(requirements) {
  const ids = new Set();
  const activeIds = new Set();
  for (const requirement of requirements) {
    if (!requirement.id || ids.has(requirement.id)) {
      throw new Error(
        `duplicate or missing id in evidence/requirements.json: ${requirement.id ?? "<missing>"}`,
      );
    }
    ids.add(requirement.id);
    if (requirement.status === "active") activeIds.add(requirement.id);
  }
  return activeIds;
}

export function findDivergentRequirements(local, base) {
  const baseById = new Map(
    base.map((requirement) => [requirement.id, requirement]),
  );
  return local
    .filter((requirement) => {
      const baseRequirement = baseById.get(requirement.id);
      return (
        baseRequirement && canonical(baseRequirement) !== canonical(requirement)
      );
    })
    .map((requirement) => requirement.id);
}

function git(args, repoRoot) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns the first base ref that actually resolves in this clone, or null.
 *
 * This used to be the literal string "origin/main". That is a guard that cannot fail: a clone whose
 * remote is named anything else — or a fresh clone with no remote at all — resolves nothing, the
 * cross-branch check reports "skipped", and the run goes green having compared nothing. This repo
 * was in exactly that state; its only remote is named `boilerplate`, so the divergence check had
 * never once executed.
 *
 * Order is merge-target first: the branch this work lands on is the one whose requirement meanings
 * must not be redefined. Remotes come last because a fork's upstream (a template or boilerplate) is
 * a different project whose registry is allowed to differ.
 */
export function resolveBaseRef(repoRoot = DEFAULT_ROOT, explicit = null) {
  const resolves = (ref) =>
    Boolean(
      git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoRoot),
    );

  // An explicitly named base is honoured or refused, never quietly replaced: falling back to `main`
  // after a typo would compare against something the caller did not ask for and still report success.
  const named = explicit || process.env.REQUIREMENTS_BASE_REF;
  if (named) {
    if (resolves(named)) return named;
    throw new Error(
      `base ref "${named}" does not resolve in this clone. Fetch it, or drop the override to let ` +
        "the check pick the merge target.",
    );
  }

  const remotes = (git(["remote"], repoRoot) || "")
    .split(/\r?\n/)
    .filter(Boolean);

  const candidates = [
    // GitHub Actions sets GITHUB_BASE_REF to the PR's target branch name.
    process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : null,
    process.env.GITHUB_BASE_REF || null,
    "main",
    "master",
    ...remotes.flatMap((remote) => [
      `${remote}/HEAD`,
      `${remote}/main`,
      `${remote}/master`,
    ]),
  ].filter(Boolean);

  return candidates.find(resolves) ?? null;
}

export function loadBaseRequirements(baseRef, repoRoot = DEFAULT_ROOT) {
  let raw;
  try {
    raw = execFileSync(
      "git",
      ["show", `${baseRef}:evidence/requirements.json`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return null;
  }
  try {
    const registry = JSON.parse(raw);
    return Array.isArray(registry?.requirements) ? registry.requirements : [];
  } catch {
    return [];
  }
}

// Framework couplings, all resolved from declared facts instead of hardcoded:
//   testRoot           <- harness.config.json project.testRoot
//   specFileRe         <- project.specGlob's declared suffix
//   adapterTestTitleRe <- the adapter's own patterns module
// Before this the check walked "cypress/tests" and matched it()/specify() literally, so in any
// other adapter it found zero specs and reported zero unknown ids -- which reads exactly like
// success. A guard that cannot fail is worse than an absent one.
function harnessConfig(repoRoot) {
  return readJson(path.join(repoRoot, "harness.config.json"));
}

function testRoot(repoRoot) {
  return harnessConfig(repoRoot).project.testRoot;
}

function specFileRe(repoRoot) {
  const glob = harnessConfig(repoRoot).project.specGlob;
  const suffix = path.basename(glob).match(/^\*\.([A-Za-z]+)\./)?.[1];
  if (!suffix) {
    throw new Error(
      `cannot derive the spec suffix from project.specGlob "${glob}" — expected a basename ` +
        `like "*.spec.ts" or "*.cy.{js,ts}"`,
    );
  }
  return new RegExp(`\\.${suffix}\\.(?:m|c)?[jt]s$`, "i");
}

async function adapterTestTitleRe(repoRoot) {
  const { framework } = harnessConfig(repoRoot);
  const mod = await import(
    pathToFileURL(
      path.join(repoRoot, ".claude", "hooks", framework + ".patterns.mjs"),
    ).href
  );
  if (!mod.testTitleRe) {
    throw new Error(framework + ".patterns.mjs must export testTitleRe");
  }
  return new RegExp(mod.testTitleRe.source, mod.testTitleRe.flags);
}

function walk(directory, isSpec) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, isSpec);
    return isSpec.test(entry.name) ? [fullPath] : [];
  });
}

export async function findUnknownSpecRequirementIds(
  repoRoot,
  activeIds,
  readFile = (file) => fs.readFileSync(file, "utf8"),
) {
  const unknown = new Set();
  const testTitle = await adapterTestTitleRe(repoRoot);
  const isSpec = specFileRe(repoRoot);
  const specs = walk(path.join(repoRoot, testRoot(repoRoot), "tests"), isSpec);
  for (const file of specs) {
    const content = readFile(file);
    let match;
    while ((match = testTitle.exec(content)) !== null) {
      if (!activeIds.has(match[2])) unknown.add(match[2]);
    }
  }
  return [...unknown].sort();
}

export async function checkRequirements({
  repoRoot = DEFAULT_ROOT,
  baseRef = null,
  // A skipped cross-branch check is acceptable on a laptop with no remote. In CI it means the guard
  // reported success without comparing anything, which is the failure this check exists to prevent.
  strict = Boolean(process.env.CI),
} = {}) {
  const registry = readJson(
    path.join(repoRoot, "evidence", "requirements.json"),
  );
  if (registry?.version !== 1 || !Array.isArray(registry.requirements)) {
    throw new Error(
      "evidence/requirements.json must contain version 1 and requirements[]",
    );
  }

  const local = registry.requirements;
  const activeIds = validateLocalRequirements(local);
  const unknown = await findUnknownSpecRequirementIds(repoRoot, activeIds);
  if (unknown.length > 0) {
    throw new Error(
      `spec requirement id(s) are not active in evidence/requirements.json: ${unknown.join(", ")}`,
    );
  }

  const resolvedRef = resolveBaseRef(repoRoot, baseRef);
  const base = resolvedRef ? loadBaseRequirements(resolvedRef, repoRoot) : null;
  if (base === null) {
    if (strict) {
      throw new Error(
        `no base ref resolved (tried an explicit --base-ref, $REQUIREMENTS_BASE_REF, ` +
          `$GITHUB_BASE_REF, main, master, and every remote's HEAD/main/master). ` +
          "Cross-branch requirement divergence went unchecked; fetch the merge target or set " +
          "REQUIREMENTS_BASE_REF.",
      );
    }
    return {
      localCount: local.length,
      baseAvailable: false,
      baseRef: resolvedRef,
    };
  }

  const divergent = findDivergentRequirements(local, base);
  if (divergent.length > 0) {
    throw new Error(
      `id(s) redefined versus ${resolvedRef}: ${divergent.join(", ")}. ` +
        "Give the new behavior a fresh requirement id instead of reusing one that already means " +
        "something else on the base branch.",
    );
  }

  return {
    localCount: local.length,
    baseAvailable: true,
    baseRef: resolvedRef,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await checkRequirements({
      baseRef: typeof args["base-ref"] === "string" ? args["base-ref"] : null,
    });
    if (!result.baseAvailable) {
      console.log(
        "[requirements] no base ref resolved; skipped cross-branch check " +
          "(in-file ids unique; spec ids active). This is an error under CI.",
      );
    } else {
      console.log(
        `[requirements] ${result.localCount} requirement(s) consistent with ${result.baseRef}; ` +
          "spec ids active and no id reused for a different behavior.",
      );
    }
  } catch (error) {
    console.error(`[requirements] ${error.message}`);
    process.exit(1);
  }
}
