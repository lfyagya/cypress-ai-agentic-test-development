#!/usr/bin/env node
/**
 * Does this repository satisfy the seven conformance invariants?
 *
 *   node scripts/engine/conformance.mjs
 *
 * Reports gaps. Fixes nothing, deliberately: this is the negotiation surface with a team, and
 * seven items each defensible on its own merits is a conversation. A tool that silently repaired
 * them would be making commitments on the team's behalf.
 *
 * Three outcomes per invariant. `ok` is satisfied. `ramping` is a legitimate onboarding state with a
 * recorded end date — currently only traceability, which an existing untagged suite cannot satisfy
 * on day one. `gap` is unsatisfied, and any gap exits non-zero.
 *
 * Conformance spec §3 for the invariants, §8 step 3 for where this sits in adoption.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONCERNS } from "../../harness/concerns.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

const results = [];
const record = (id, title, state, detail) =>
  results.push({ id, title, state, detail });

let config;
try {
  config = JSON.parse(read("harness.config.json"));
} catch {
  console.error(
    "[conformance] harness.config.json is missing or unreadable. Nothing else can be assessed: " +
      "every invariant is expressed relative to the composed policy.",
  );
  process.exit(1);
}
const { project, rules = [], agents = [], adapters = {}, hooks = {} } = config;

// I1 — one generated source of policy, composed rather than hand-written, and provably reproducible
// from its inputs.
{
  const generated = /GENERATED/.test(config.$comment ?? "");
  const profileDirectory = path.join(root, "harness", "profiles", "projects");
  let reproduces = false;
  let profileKey = null;
  try {
    const { compose } = await import(
      pathToFileURL(
        path.join(
          root,
          "harness",
          "profiles",
          "bin",
          "compose-harness-config.mjs",
        ),
      ).href
    );
    for (const file of fs.readdirSync(profileDirectory)) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      const profile = JSON.parse(
        fs.readFileSync(path.join(profileDirectory, file), "utf8"),
      );
      if (profile.projectName !== project.name) continue;
      profileKey = profile.key;
      const composed = { ...compose(profile), $comment: 0 };
      reproduces =
        JSON.stringify(composed) === JSON.stringify({ ...config, $comment: 0 });
      break;
    }
  } catch {
    reproduces = false;
  }
  if (generated && reproduces) {
    record(
      "I1",
      "One generated source of policy",
      "ok",
      `composed from ${profileKey}`,
    );
  } else if (!profileKey) {
    record(
      "I1",
      "One generated source of policy",
      "gap",
      "no profile matches project.name",
    );
  } else if (!reproduces) {
    record(
      "I1",
      "One generated source of policy",
      "gap",
      `${profileKey} does not reproduce harness.config.json — it has been hand-edited, so the ` +
        `profile is no longer the source of truth`,
    );
  } else {
    record(
      "I1",
      "One generated source of policy",
      "gap",
      "config carries no GENERATED marker",
    );
  }
}

// I2 — the same rules reach the writer and the pipeline. §3.1: for advisory-only tooling, CI is the
// real gate and the report must say so rather than implying write-time refusal.
{
  const enabled = Object.entries(adapters)
    .filter(([, value]) => value?.enabled)
    .map(([name]) => name);
  const blocking = enabled.filter(
    (name) => name === "claude" || name === "cursor",
  );
  const writeHooks =
    (hooks.preWrite ?? []).length + (hooks.postWrite ?? []).length;
  // Look for the pipeline in reality before asking the profile to describe it. A repo that owns its
  // own package.json — every boilerplate, and some overlaid repos — wires the rules check into a
  // script, and that is the fact. `wiring.verifyScript` matters for the case the harness cannot
  // see: an overlaid repo whose package.json the overlay must not touch.
  let pipeline = null;
  try {
    const scripts = JSON.parse(read("package.json")).scripts ?? {};
    const found = Object.entries(scripts).find(([, command]) =>
      /check-drift|validate-.*-rules|check:rules/.test(command),
    );
    if (found) pipeline = `npm run ${found[0]}`;
  } catch {
    pipeline = null;
  }
  const declared = config.wiring?.verifyScript;
  if (!pipeline && declared && !declared.startsWith("<")) pipeline = declared;

  if (writeHooks === 0) {
    record(
      "I2",
      "Rules reach writer and pipeline",
      "gap",
      "no write-time hooks declared",
    );
  } else if (!pipeline) {
    record(
      "I2",
      "Rules reach writer and pipeline",
      "gap",
      "write-time hooks present, but no script runs the rules check and wiring.verifyScript names " +
        "no entry point either — so nothing enforces the same rules in the pipeline",
    );
  } else if (blocking.length === 0) {
    record(
      "I2",
      "Rules reach writer and pipeline",
      "ok",
      `advisory-only tooling (${enabled.join(", ")}): rules are advice at write time, so ` +
        `${pipeline} is the real gate`,
    );
  } else {
    record(
      "I2",
      "Rules reach writer and pipeline",
      "ok",
      `${writeHooks} write-time hook(s) via ${blocking.join(", ")}; pipeline: ${pipeline}`,
    );
  }
}

// I3 — declared equals enforced. A block rule needs a pattern behind it, and a declared root must
// be a real directory or the scanner's scope silently collapses.
{
  const problems = [];
  try {
    const patterns = await import(
      pathToFileURL(
        path.join(root, ".claude", "hooks", `${config.framework}.patterns.mjs`),
      ).href
    );
    const implemented = new Set(patterns.rules.map((rule) => rule.ruleId));
    for (const rule of rules) {
      if (rule.severity !== "block") continue;
      if (!implemented.has(rule.id)) {
        problems.push(`${rule.id} is declared block with no pattern`);
      }
    }
  } catch (error) {
    problems.push(`cannot load the adapter's rule patterns: ${error.message}`);
  }
  for (const key of ["testRoot", "configRoot", "commandRoot"]) {
    if (project[key] && !exists(project[key])) {
      problems.push(`project.${key} "${project[key]}" does not exist`);
    }
  }
  record(
    "I3",
    "Declared equals enforced",
    problems.length ? "gap" : "ok",
    problems.length
      ? problems.join("; ")
      : `${rules.filter((r) => r.severity === "block").length} block rule(s) backed by patterns`,
  );
}

// I4 — the gate that grades output cannot write files or run commands.
{
  const gate = agents.find((agent) => agent.role === "EVALUATE");
  const allowed = new Set(["Read", "Grep", "Glob"]);
  if (!gate) {
    record(
      "I4",
      "Independent read-only evaluator",
      "gap",
      "no EVALUATE-role agent",
    );
  } else {
    const extra = (gate.tools ?? []).filter((tool) => !allowed.has(tool));
    if (gate.permissionMode !== "plan" || extra.length > 0) {
      record(
        "I4",
        "Independent read-only evaluator",
        "gap",
        `${gate.name} must be permissionMode plan with Read/Grep/Glob only` +
          (extra.length ? `; it also has ${extra.join(", ")}` : ""),
      );
    } else {
      record(
        "I4",
        "Independent read-only evaluator",
        "ok",
        `${gate.name}, read-only`,
      );
    }
  }
}

// I5 — trust boundaries, never relaxed. Tier 0 must be present and blocking.
{
  const tier0 = Object.keys(CONCERNS).filter((id) => CONCERNS[id].tier === 0);
  const problems = [];
  for (const concernId of tier0) {
    const owned = rules.filter((rule) => rule.concern === concernId);
    if (owned.length === 0) {
      problems.push(`${concernId} is not declared at all`);
    } else if (owned.some((rule) => rule.severity !== "block")) {
      problems.push(`${concernId} is declared but not blocking`);
    }
  }
  const source = config.strategy?.credentialSource;
  record(
    "I5",
    "Trust boundaries never relaxed",
    problems.length ? "gap" : "ok",
    problems.length
      ? problems.join("; ")
      : `${tier0.join(", ")} blocking` +
          (source
            ? `; credentials from ${source}`
            : "; credential source not declared"),
  );
}

// I6 — traceability, with the ramp the spec allows. An existing untagged suite cannot satisfy this
// on day one, so `review` with a reason and an end date is a legitimate state, and an open-ended
// one is not.
{
  const trace = rules.find((rule) => rule.concern === "TRACE");
  if (!trace) {
    record(
      "I6",
      "Traceability",
      "gap",
      "TRACE is not declared, so coverage is not computable",
    );
  } else if (trace.severity === "block") {
    record("I6", "Traceability", "ok", `${trace.id} blocking`);
  } else if (trace.overrideReason && trace.ratchetBy) {
    record(
      "I6",
      "Traceability",
      "ramping",
      `${trace.id} at review until ${trace.ratchetBy} — ${trace.overrideReason}`,
    );
  } else {
    record(
      "I6",
      "Traceability",
      "gap",
      `${trace.id} is downgraded with no ${trace.overrideReason ? "ratchet date" : "recorded reason"}, ` +
        `so the ramp has no end`,
    );
  }
}

// I7 — an evidence ledger, present and reachable.
{
  const tooling = [
    "scripts/evidence.mjs",
    "scripts/record-evidence.mjs",
  ].filter((file) => !exists(file));
  const registry = exists("evidence/requirements.json");
  if (tooling.length > 0) {
    record("I7", "Evidence ledger", "gap", `missing ${tooling.join(", ")}`);
  } else if (!registry) {
    record(
      "I7",
      "Evidence ledger",
      "gap",
      "evidence/requirements.json is absent, so no verdict can name a requirement",
    );
  } else {
    record(
      "I7",
      "Evidence ledger",
      "ok",
      "evidence tooling and requirement registry present",
    );
  }
}

const width = Math.max(...results.map((result) => result.title.length));
const label = { ok: "ok     ", ramping: "ramping", gap: "GAP    " };
console.log(
  `[conformance] ${project.name} — ${config.framework} / ${project.pattern}\n`,
);
for (const result of results) {
  console.log(
    `  ${result.id}  ${label[result.state]}  ${result.title.padEnd(width)}  ${result.detail}`,
  );
}

const gaps = results.filter((result) => result.state === "gap");
const ramping = results.filter((result) => result.state === "ramping");
console.log("");
if (gaps.length === 0) {
  console.log(
    `[conformance] ${results.length - ramping.length} of ${results.length} satisfied` +
      (ramping.length
        ? `, ${ramping.length} ramping with a recorded end date.`
        : "."),
  );
  process.exit(0);
}
console.log(
  `[conformance] ${gaps.length} gap(s): ${gaps.map((gap) => gap.id).join(", ")}. ` +
    `Each is a decision for this project's owner, not something this tool should quietly fix.`,
);
process.exit(1);
