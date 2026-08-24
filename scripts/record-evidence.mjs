#!/usr/bin/env node
// Appends validated entries to the evidence ledgers that feed M1, M2, and M4.
// scripts/evidence.mjs READS these; nothing else writes them.
//
//   node scripts/record-evidence.mjs gate   --requirement <id> --attempt 1 --verdict PASS
//   node scripts/record-evidence.mjs gate   --requirement <id> --attempt 1 --verdict PASS_WITH_ACTIONS \
//        --actions "named follow-up|another follow-up" [--resolution "optional note"]
//   node scripts/record-evidence.mjs ci     --pipeline <id> --trigger pr --attempt 1 --outcome passed
//   node scripts/record-evidence.mjs effort --requirement <id> --minutes 45
//
// Validation is the point. A typo'd requirement id or an out-of-range verdict would not crash
// evidence.mjs — it would silently drop the row and quietly understate the metric. Garbage in a
// ledger is worse than an empty ledger, because an empty one reports `null` and says why.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJsonLines } from "./lib/cli.mjs";

const VERDICTS = new Set(["PASS", "PASS_WITH_ACTIONS", "BLOCK"]);
const TRIGGERS = new Set(["pr", "push", "manual", "schedule"]);
const OUTCOMES = new Set(["passed", "failed"]);

const LEDGERS = {
  gate: "gate-log.jsonl",
  ci: "ci-history.jsonl",
  effort: "effort-log.jsonl",
};

function requirementIds(root) {
  const file = path.join(root, "evidence", "requirements.json");
  if (!fs.existsSync(file)) return null;
  const registry = JSON.parse(fs.readFileSync(file, "utf8"));
  return new Set((registry.requirements ?? []).map((r) => r.id));
}

function positiveInteger(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--${field} must be an integer >= 1`);
  return n;
}

function knownRequirement(root, id) {
  if (!id) throw new Error("--requirement is required");
  const ids = requirementIds(root);
  // No registry yet is a valid bootstrap state; an id absent from an existing registry is not.
  if (ids && ids.size > 0 && !ids.has(id)) {
    throw new Error(
      `Unknown requirement "${id}". It must exist in evidence/requirements.json, ` +
        `or the row will be silently ignored when metrics are computed.`,
    );
  }
  return id;
}

/** Pipe-separated named follow-ups for PASS_WITH_ACTIONS. Empty / missing → []. */
export function parseNamedActions(raw) {
  if (raw === undefined || raw === null || raw === true || raw === false) {
    return [];
  }
  return String(raw)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildEntry(
  kind,
  args,
  root = process.cwd(),
  now = new Date().toISOString(),
) {
  if (kind === "gate") {
    const verdict = String(args.verdict ?? "").toUpperCase();
    if (!VERDICTS.has(verdict)) {
      throw new Error(`--verdict must be one of ${[...VERDICTS].join(" | ")}`);
    }
    const actions = parseNamedActions(args.actions);
    const resolution =
      args.resolution === undefined ||
      args.resolution === true ||
      args.resolution === false
        ? null
        : String(args.resolution).trim() || null;

    // PASS_WITH_ACTIONS is merge-ready with named non-blocking follow-ups. Actions that would
    // block merge belong under BLOCK, not here — so the ledger requires the names.
    if (verdict === "PASS_WITH_ACTIONS" && actions.length === 0) {
      throw new Error(
        'PASS_WITH_ACTIONS requires --actions "follow-up one|follow-up two"',
      );
    }
    if (verdict !== "PASS_WITH_ACTIONS" && actions.length > 0) {
      throw new Error(
        "--actions is only valid with --verdict PASS_WITH_ACTIONS",
      );
    }
    if (verdict !== "PASS_WITH_ACTIONS" && resolution) {
      throw new Error(
        "--resolution is only valid with --verdict PASS_WITH_ACTIONS",
      );
    }

    const entry = {
      requirementId: knownRequirement(root, args.requirement),
      attempt: positiveInteger(args.attempt ?? 1, "attempt"),
      verdict,
      timestamp: args.timestamp ?? now,
    };
    if (verdict === "PASS_WITH_ACTIONS") {
      entry.actions = actions;
      entry.resolution = resolution;
    }
    return entry;
  }

  if (kind === "ci") {
    const trigger = String(args.trigger ?? "").toLowerCase();
    const outcome = String(args.outcome ?? "").toLowerCase();
    if (!TRIGGERS.has(trigger))
      throw new Error(`--trigger must be one of ${[...TRIGGERS].join(" | ")}`);
    if (!OUTCOMES.has(outcome))
      throw new Error(`--outcome must be one of ${[...OUTCOMES].join(" | ")}`);
    if (!args.pipeline) throw new Error("--pipeline is required");
    const failureClass = args["failure-class"] ?? null;
    if (outcome === "passed" && failureClass) {
      throw new Error(
        "--failure-class is only meaningful with --outcome failed",
      );
    }
    return {
      pipelineId: String(args.pipeline),
      trigger,
      attempt: positiveInteger(args.attempt ?? 1, "attempt"),
      outcome,
      failureClass,
      timestamp: args.timestamp ?? now,
    };
  }

  if (kind === "effort") {
    const minutes = Number(args.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0)
      throw new Error("--minutes must be a number > 0");
    return {
      requirementId: knownRequirement(root, args.requirement),
      minutes,
      accepted: args.accepted === undefined ? true : args.accepted !== "false",
      timestamp: args.timestamp ?? now,
    };
  }

  throw new Error(
    `Unknown ledger "${kind}". Use: ${Object.keys(LEDGERS).join(" | ")}`,
  );
}

// A double-append would inflate M1/M2 with a row that looks like independent evidence.
export function findDuplicate(kind, entry, existing) {
  if (kind === "gate") {
    return existing.find(
      (e) =>
        e.requirementId === entry.requirementId && e.attempt === entry.attempt,
    );
  }
  if (kind === "ci") {
    return existing.find(
      (e) => e.pipelineId === entry.pipelineId && e.attempt === entry.attempt,
    );
  }
  return undefined;
}

export function record(kind, args, root = process.cwd()) {
  const entry = buildEntry(kind, args, root);
  const file = path.join(root, "evidence", LEDGERS[kind]);
  const existing = readJsonLines(file);

  const duplicate = findDuplicate(kind, entry, existing);
  if (duplicate && !args.force) {
    throw new Error(
      `Duplicate ${kind} entry already recorded: ${JSON.stringify(duplicate)}. ` +
        `Appending it again would inflate the metric. Pass --force only if this is genuinely a ` +
        `separate observation.`,
    );
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return { file, entry, total: existing.length + 1 };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const [kind, ...rest] = process.argv.slice(2);
    if (!kind || kind === "--help") {
      console.log(
        [
          "Usage:",
          "  record-evidence.mjs gate   --requirement <id> --attempt <n> --verdict PASS|PASS_WITH_ACTIONS|BLOCK",
          '                         [--actions "a|b" --resolution "note"]  # required/only for PASS_WITH_ACTIONS',
          "  record-evidence.mjs ci     --pipeline <id> --trigger pr|push|manual|schedule --attempt <n> --outcome passed|failed [--failure-class ENV]",
          "  record-evidence.mjs effort --requirement <id> --minutes <n> [--accepted false]",
          "",
          "PASS_WITH_ACTIONS means merge-ready now with named non-blocking follow-ups (preserved on",
          "the row). Only attempt 1 counts toward M1 and M2 — measuring after repairs measures",
          "persistence, not quality. M2 ignores rows with --failure-class ENV so outages are not",
          "test failures.",
        ].join("\n"),
      );
      process.exit(kind ? 0 : 2);
    }
    const result = record(kind, parseArgs(rest));
    console.log(
      `[record] ${kind} -> evidence/${LEDGERS[kind]} (${result.total} entr${result.total === 1 ? "y" : "ies"})`,
    );
  } catch (error) {
    console.error(`[record] ${error.message}`);
    process.exit(1);
  }
}
