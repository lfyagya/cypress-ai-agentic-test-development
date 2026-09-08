#!/usr/bin/env node
// Reconstructs evidence/ci-history.jsonl (M2) from the GitHub Actions API.
//
//   node scripts/backfill-ci-evidence.mjs --workflow cypress.yml --limit 100 [--dry-run]
//
// Why this exists: the in-workflow recorder writes to a throwaway checkout, so its row never reaches
// the tracked ledger. Worse, a job that never STARTS records nothing at all — a billing lock, a
// runner shortage, or a cancelled queue produces zero steps, so the recorder step itself never runs.
// The Actions API is the only source that sees those runs. It is also authoritative and idempotent,
// which a self-reporting pipeline is not.
//
// Requires the gh CLI, already authenticated. No write permissions, no paid plan: Actions history is
// readable on public repos and on private repos you can already clone.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { record } from "./record-evidence.mjs";
import { parseArgs } from "./lib/cli.mjs";

const TRIGGER_BY_EVENT = {
  pull_request: "pr",
  pull_request_target: "pr",
  push: "push",
  workflow_dispatch: "manual",
  schedule: "schedule",
};

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function classify(run) {
  const trigger = TRIGGER_BY_EVENT[run.event];
  if (!trigger) return null; // an event M2 does not model — skip rather than guess

  // A run whose jobs executed no steps never really ran: infrastructure, not a test signal.
  const ranSomething = (run.jobs ?? []).some(
    (job) => (job.steps ?? []).length > 0,
  );
  const outcome = run.conclusion === "success" ? "passed" : "failed";
  const infrastructure = outcome === "failed" && !ranSomething;

  return {
    pipeline: String(run.databaseId ?? run.id),
    trigger,
    attempt: run.runAttempt ?? run.run_attempt ?? 1,
    outcome,
    ...(infrastructure ? { "failure-class": "ENV" } : {}),
    timestamp: run.createdAt ?? run.created_at,
  };
}

/**
 * M2 counts attempt 1 only. `gh run list` (and an unscoped `gh run view`) report the
 * *latest* attempt: after a green retry the list conclusion is "success" even when
 * attempt 1 failed. Merging that conclusion with a guessed `runAttempt: 1` launders a
 * first-pass failure into a pass — the exact M2 failure the in-workflow recorder
 * exists to prevent.
 *
 * Hydrate from `gh run view --attempt 1`. If that view is unavailable, skip the run
 * rather than inventing attempt 1 or empty jobs (empty jobs would mark a real failure
 * as ENV and drop it from M2).
 */
export function firstAttemptRun(listRun, attempt1View) {
  if (!attempt1View || !attempt1View.conclusion) return null;
  return {
    ...listRun,
    conclusion: attempt1View.conclusion,
    jobs: attempt1View.jobs ?? [],
    runAttempt: 1,
  };
}

function fetchRuns(workflow, limit) {
  const listArgs = [
    "run",
    "list",
    "--limit",
    String(limit),
    "--json",
    "databaseId,event,conclusion,status,createdAt",
  ];
  if (workflow) listArgs.push("--workflow", workflow);
  const runs = JSON.parse(gh(listArgs)).filter(
    (run) => run.status === "completed",
  );

  // run list omits per-job steps, and steps are how we tell "never started" from "tests failed".
  // Always pin --attempt 1: an unscoped view returns the latest retry.
  return runs.map((run) => {
    try {
      const detail = JSON.parse(
        gh([
          "run",
          "view",
          String(run.databaseId),
          "--attempt",
          "1",
          "--json",
          "jobs,attempt,conclusion",
        ]),
      );
      return firstAttemptRun(run, detail);
    } catch {
      return null;
    }
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    try {
      gh(["auth", "status"]);
    } catch {
      throw new Error(
        "gh CLI is unavailable or not authenticated. Run: gh auth login",
      );
    }

    const runs = fetchRuns(args.workflow, Number(args.limit ?? 50));
    let added = 0;
    let skipped = 0;
    let ignored = 0;

    for (const run of runs) {
      if (!run) {
        ignored += 1;
        continue;
      }
      const entry = classify(run);
      if (!entry) {
        ignored += 1;
        continue;
      }
      if (args["dry-run"]) {
        console.log(
          `  [dry] ${entry.pipeline} ${entry.trigger} attempt=${entry.attempt} ` +
            `${entry.outcome}${entry["failure-class"] ? " ENV" : ""}`,
        );
        added += 1;
        continue;
      }
      try {
        record("ci", entry);
        added += 1;
      } catch (error) {
        // Already recorded is the expected case on a re-run over an overlapping window.
        if (/Duplicate/.test(error.message)) skipped += 1;
        else throw error;
      }
    }

    console.log(
      `[backfill] ${added} recorded, ${skipped} already present, ${ignored} skipped ` +
        `(unmodelled event or unavailable first-attempt view)` +
        `${args["dry-run"] ? " (dry run — nothing written)" : ""}`,
    );
  } catch (error) {
    console.error(`[backfill] ${error.message}`);
    process.exit(1);
  }
}
