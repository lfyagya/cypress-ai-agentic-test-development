#!/usr/bin/env node
// Composes a project profile + its adapter baseline into a repo's harness.config.json.
//
//   node compose-harness-config.mjs --profile <profile.json> --out <repo>/harness.config.json
//   node compose-harness-config.mjs --profile <profile.json> --verify <repo>/harness.config.json
//
// --verify deep-compares instead of writing, so you can prove the profile layer reproduces a
// working config before adopting it. Exits 1 on any difference and prints the differing paths.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson } from "../../../scripts/lib/cli.mjs";
import { CONCERNS, CONCERN_IDS } from "../../concerns.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS = path.join(HERE, "..", "adapters");

// Which AI tools a team uses is a project fact, so it belongs at the top level of the profile beside
// `owner` and `language` — not buried in `overrides`, which reads as "an exception to policy".
// `overrides.adapters` is still honoured so existing profiles keep working.
function resolveAdapters(profile, base) {
  const resolved =
    profile.adapters ?? profile.overrides?.adapters ?? base.defaults.adapters;
  const enabled = Object.entries(resolved).filter(([, v]) => v?.enabled);
  if (enabled.length === 0) {
    throw new Error(
      `profile "${profile.key}" enables no AI adapter. That composes a harness with no agents, ` +
        `no generated instructions, and no write-time hooks wired to any tool — every rule would ` +
        `still be declared and none would reach anything. Enable at least one of: ` +
        `${Object.keys(resolved).join(", ")}.`,
    );
  }
  return resolved;
}

/**
 * Resolves the rule set for one project: Tier 2 concerns selected by the declared architecture,
 * Tier 1 severities adjusted by recorded overrides, Tier 0 untouchable.
 *
 * This is where the tier model stops being metadata. Before it, `rules` was copied from the adapter
 * baseline verbatim, so every project got every rule the framework had an opinion about — including
 * the architecture rules that made the harness unadoptable for a POM codebase.
 */
export function resolveRules(base, profile) {
  const pattern = profile.pattern ?? base.pattern;
  if (!pattern) {
    throw new Error(
      `no architecture pattern: profile "${profile.key}" declares none and adapter ` +
        `"${profile.adapter}" has no native pattern. Tier 2 concerns are selected by pattern, so ` +
        `without one the engine cannot tell which apply.`,
    );
  }

  const overrides = profile.ruleOverrides ?? {};
  for (const [concernId, override] of Object.entries(overrides)) {
    const concern = CONCERNS[concernId];
    if (!concern) {
      throw new Error(
        `ruleOverrides names unknown concern "${concernId}". Known: ${CONCERN_IDS.join(", ")}`,
      );
    }
    if (concern.tier === 0) {
      throw new Error(
        `ruleOverrides cannot touch "${concernId}": it is Tier 0, a trust boundary. ` +
          `No project may downgrade it by any mechanism.`,
      );
    }
    if (concern.tier === 2) {
      throw new Error(
        `ruleOverrides cannot set "${concernId}": it is Tier 2 and selected by the declared ` +
          `pattern, not negotiated. Change "pattern" if this concern does not describe your ` +
          `architecture.`,
      );
    }
    if (override.severity === "off") {
      throw new Error(
        `ruleOverrides cannot switch "${concernId}" off. Tier 1 downgrades to "review", which ` +
          `still scores at the gate; off would mean the declared rule reaches nothing.`,
      );
    }
    if (!["block", "review"].includes(override.severity)) {
      throw new Error(
        `ruleOverrides."${concernId}".severity must be "block" or "review", got ` +
          `"${override.severity}"`,
      );
    }
    if (override.severity === "review" && !override.reason) {
      throw new Error(
        `ruleOverrides."${concernId}" downgrades to review with no reason. An unrecorded ` +
          `exception is indistinguishable from a mistake, so the reason is required and is ` +
          `carried into the generated instructions.`,
      );
    }
  }

  return base.rules
    .filter((rule) => {
      const concern = CONCERNS[rule.concern];
      if (!concern) {
        throw new Error(
          `adapter rule "${rule.id}" names unknown concern "${rule.concern}"`,
        );
      }
      if (concern.tier < 2) return true;
      return (concern.patterns ?? []).includes(pattern);
    })
    .map((rule) => {
      const override = overrides[rule.concern];
      if (!override) return rule;
      return {
        ...rule,
        severity: override.severity,
        ...(override.reason ? { overrideReason: override.reason } : {}),
        ...(override.ratchetBy ? { ratchetBy: override.ratchetBy } : {}),
      };
    });
}

export function compose(profile, adaptersDir = ADAPTERS) {
  if (!profile.adapter) throw new Error("profile.adapter is required");
  const baselineFile = path.join(adaptersDir, `${profile.adapter}.json`);
  if (!fs.existsSync(baselineFile)) {
    throw new Error(
      `Unknown adapter "${profile.adapter}" — no ${baselineFile}`,
    );
  }
  const base = readJson(baselineFile);
  const over = profile.overrides ?? {};

  if (!profile.projectName) throw new Error("profile.projectName is required");

  const config = {
    $comment:
      `GENERATED from docs/harness/profiles by compose-harness-config.mjs. ` +
      `Policy lives in the adapter baseline (${profile.adapter}.json); project facts live in ` +
      `the profile (${profile.key}). Re-compose after editing either, then run npm run harness:sync.`,
    version: base.version,
    framework: base.framework,
    ...(base.agentFileExtension
      ? { agentFileExtension: base.agentFileExtension }
      : {}),
    adapters: resolveAdapters(profile, base),
    project: {
      name: profile.projectName,
      architecture: base.architecture,
      pattern: profile.pattern ?? base.pattern,
      testRoot: base.paths.testRoot,
      configRoot: base.paths.configRoot,
      commandRoot: base.paths.commandRoot,
      specGlob: base.paths.specGlob,
    },
    context: { ...base.defaults.context, ...(over.context ?? {}) },
    ...(base.defaults.env || over.env
      ? { env: { ...(base.defaults.env ?? {}), ...(over.env ?? {}) } }
      : {}),
    loops: { ...base.defaults.loops, ...(over.loops ?? {}) },
    qaFoundations: base.qaFoundations,
    rules: resolveRules(base, profile),
    agents: base.agents,
    hooks: base.hooks,
    ...(base.skills ? { skills: base.skills } : {}),
    permissions: over.permissions ?? base.permissions,
  };
  return config;
}

// Deep diff that reports paths, not just "not equal".
function diff(a, b, at = "", out = []) {
  const bothObjects =
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b);
  if (bothObjects) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff(a[k], b[k], at ? `${at}.${k}` : k, out);
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(at || "<root>");
  return out;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.profile) throw new Error("--profile is required");
    const composed = compose(readJson(args.profile));

    if (args.verify) {
      const live = readJson(args.verify);
      // $comment is provenance text, not policy — never a real difference.
      const differences = diff(
        { ...composed, $comment: 0 },
        { ...live, $comment: 0 },
      );
      if (differences.length > 0) {
        console.error(`[profile] MISMATCH vs ${args.verify}:`);
        for (const d of differences) console.error(`  ${d}`);
        process.exit(1);
      }
      console.log(
        `[profile] ${path.basename(args.profile)} reproduces ${args.verify} exactly.`,
      );
      process.exit(0);
    }

    if (!args.out) throw new Error("--out or --verify is required");
    fs.writeFileSync(
      args.out,
      `${JSON.stringify(composed, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `[profile] wrote ${args.out} from ${path.basename(args.profile)}`,
    );
  } catch (error) {
    console.error(`[profile] ${error.message}`);
    process.exit(1);
  }
}
