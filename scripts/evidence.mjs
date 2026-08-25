import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson, readJsonLines } from "./lib/cli.mjs";

const ACTIVE = new Set(["active"]);
const ACCEPTED = new Set(["PASS", "PASS_WITH_ACTIONS"]);
const REQUIREMENT_VALUES = {
  type: new Set(["SMOKE", "REGRESSION"]),
  priority: new Set(["P0", "P1", "P2"]),
  tier: new Set(["smoke", "e2e", "ddt"]),
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function walkFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walkFiles(fullPath, predicate)
      : predicate(fullPath)
        ? [fullPath]
        : [];
  });
}

function validateRequirements(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.requirements)) {
    throw new Error(
      "evidence/requirements.json must contain version 1 and requirements[]",
    );
  }
  const ids = new Set();
  for (const requirement of registry.requirements) {
    if (!requirement.id || ids.has(requirement.id)) {
      throw new Error(
        `Requirement ids must be present and unique: ${requirement.id ?? "<missing>"}`,
      );
    }
    ids.add(requirement.id);
    if (ACTIVE.has(requirement.status)) {
      for (const field of ["module", "title", "expectedOutcome", "source"]) {
        if (
          typeof requirement[field] !== "string" ||
          !requirement[field].trim()
        ) {
          throw new Error(
            `Active requirement ${requirement.id} is missing ${field}`,
          );
        }
      }
      for (const field of ["acceptanceCriteria", "preconditions"]) {
        if (
          !Array.isArray(requirement[field]) ||
          requirement[field].length === 0
        ) {
          throw new Error(
            `Active requirement ${requirement.id} needs at least one ${field} entry`,
          );
        }
      }
      for (const [field, allowed] of Object.entries(REQUIREMENT_VALUES)) {
        if (!allowed.has(requirement[field])) {
          throw new Error(
            `Active requirement ${requirement.id} has invalid ${field}: ${requirement[field]}`,
          );
        }
      }
    }
  }
  return registry.requirements;
}

function requirementForTitle(title, activeRequirements) {
  const matches = activeRequirements.filter((requirement) =>
    title.startsWith(`[${requirement.id}]`),
  );
  return matches.length === 1 ? matches[0].id : null;
}

function normalizeCypress(report, activeRequirements) {
  const tests = [];
  const visit = (suite, inheritedFile = "") => {
    const file = suite.file || suite.fullFile || inheritedFile;
    for (const test of suite.tests ?? []) {
      const attempts = Array.isArray(test.attempts) ? test.attempts : [];
      const state =
        test.pending || test.skipped
          ? "skipped"
          : test.fail
            ? "failed"
            : "passed";
      const status =
        state === "passed" && attempts.length > 1 ? "flaky" : state;
      tests.push({
        requirement: requirementForTitle(test.title, activeRequirements),
        title: test.title,
        file,
        status,
        durationMs: test.duration ?? 0,
        retries: Math.max(0, attempts.length - 1),
        failureClass: null,
      });
    }
    for (const child of suite.suites ?? []) visit(child, file);
  };
  for (const result of report.results ?? []) visit(result);
  return tests;
}

function normalizePlaywright(report, activeRequirements) {
  const tests = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const statuses = results.map((result) => result.status);
        let status = "passed";
        if (test.status === "skipped" || results.length === 0)
          status = "skipped";
        else if (test.status === "unexpected" || statuses.at(-1) === "failed")
          status = "failed";
        else if (
          test.status === "flaky" ||
          statuses.slice(0, -1).some((value) => value !== "passed")
        ) {
          status = "flaky";
        }
        tests.push({
          requirement: requirementForTitle(spec.title, activeRequirements),
          title: spec.title,
          file: spec.file || suite.file || "",
          status,
          durationMs: results.reduce(
            (total, result) => total + (result.duration ?? 0),
            0,
          ),
          retries: Math.max(0, results.length - 1),
          failureClass: null,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return tests;
}

function ratio(numerator, denominator, unavailableReason) {
  return denominator === 0
    ? {
        value: null,
        numerator,
        denominator,
        status: "unavailable",
        reason: unavailableReason,
      }
    : {
        value: numerator / denominator,
        numerator,
        denominator,
        status: "available",
      };
}

function loadRunSummaries(evidenceRoot) {
  return walkFiles(path.join(evidenceRoot, "runs"), (file) =>
    file.endsWith("run-summary.json"),
  )
    .map(readJson)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

function flakeMetric(runSummaries, now) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const history = new Map();
  for (const run of runSummaries) {
    for (const test of run.tests ?? []) {
      const key = `${test.file}::${test.title}`;
      const entries = history.get(key) ?? [];
      entries.push({
        status: test.status,
        commit: run.commit,
        startedAt: run.startedAt,
      });
      history.set(key, entries);
    }
  }
  const eligible = [...history.values()].filter((entries) => {
    const lastFive = entries.slice(-5);
    return (
      new Date(entries[0].startedAt) >= cutoff &&
      lastFive.length === 5 &&
      new Set(lastFive.map((entry) => entry.commit)).size === 1
    );
  });
  const flaky = eligible.filter((entries) => {
    const statuses = entries.slice(-5).map((entry) => entry.status);
    return statuses.includes("flaky") || new Set(statuses).size > 1;
  }).length;
  return ratio(
    flaky,
    eligible.length,
    "Needs five runs on unchanged code for a test first seen in 30 days",
  );
}

function gitCommit(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function totals(tests) {
  return {
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    flaky: tests.filter((test) => test.status === "flaky").length,
    skipped: tests.filter((test) => test.status === "skipped").length,
  };
}

export function buildEvidence({
  root = process.cwd(),
  framework,
  reportPath,
  runId,
  now = new Date().toISOString(),
}) {
  if (!["cypress", "playwright"].includes(framework)) {
    throw new Error("--framework must be cypress or playwright");
  }

  const evidenceRoot = path.join(root, "evidence");
  const requirements = validateRequirements(
    readJson(path.join(evidenceRoot, "requirements.json")),
  );
  const activeRequirements = requirements.filter((requirement) =>
    ACTIVE.has(requirement.status),
  );
  const testRoot = path.join(
    root,
    framework === "cypress" ? "cypress/tests" : "playwright/tests",
  );
  const testSuffix = framework === "cypress" ? ".cy.js" : ".spec.ts";
  const testFiles = walkFiles(testRoot, (file) => file.endsWith(testSuffix));
  const absoluteReport = path.resolve(root, reportPath);

  let tests = [];
  let executionStatus = "not-run";
  let startedAt = now;
  let durationMs = 0;
  if (fs.existsSync(absoluteReport)) {
    const report = readJson(absoluteReport);
    tests =
      framework === "cypress"
        ? normalizeCypress(report, activeRequirements)
        : normalizePlaywright(report, activeRequirements);
    executionStatus = "completed";
    startedAt = report.stats?.start ?? report.stats?.startTime ?? now;
    durationMs = report.stats?.duration ?? 0;
  } else if (testFiles.length > 0) {
    throw new Error(
      `Report is missing while ${testFiles.length} test file(s) exist: ${reportPath}`,
    );
  }

  const resolvedRunId = runId ?? `${now.replace(/[:.]/g, "-")}-${framework}`;
  const summary = {
    runId: resolvedRunId,
    framework,
    executionStatus,
    tier: process.env.TEST_TIER ?? "all",
    trigger: process.env.RUN_TRIGGER ?? (process.env.CI ? "ci" : "local"),
    commit: process.env.GITHUB_SHA?.slice(0, 7) ?? gitCommit(root),
    startedAt,
    durationMs,
    totals: totals(tests),
    tests,
    traceabilityGaps: tests
      .filter((test) => !test.requirement)
      .map((test) => ({ file: test.file, title: test.title })),
  };

  const runDirectory = path.join(evidenceRoot, "runs", resolvedRunId);
  writeJson(path.join(runDirectory, "run-summary.json"), summary);

  const coverage = activeRequirements.map((requirement) => {
    const mapped = tests.filter((test) => test.requirement === requirement.id);
    return {
      requirement: requirement.id,
      module: requirement.module,
      priority: requirement.priority,
      tests: mapped.map((test) => ({
        title: test.title,
        file: test.file,
        status: test.status,
      })),
      passing: mapped.some((test) => test.status === "passed"),
    };
  });
  writeJson(path.join(evidenceRoot, "coverage-computed.json"), {
    runId: resolvedRunId,
    requirements: coverage,
  });

  const gateEntries = readJsonLines(
    path.join(evidenceRoot, "gate-log.jsonl"),
  ).filter((entry) => entry.attempt === 1);
  // Accepted-scenario effort feeds M4. Only accepted rows with a finite duration count, so a
  // dropped or malformed entry lowers the denominator rather than skewing the mean.
  const effortEntries = readJsonLines(
    path.join(evidenceRoot, "effort-log.jsonl"),
  ).filter(
    (entry) => entry.accepted === true && Number.isFinite(entry.minutes),
  );
  const ciEntries = readJsonLines(
    path.join(evidenceRoot, "ci-history.jsonl"),
  ).filter(
    (entry) =>
      entry.trigger === "pr" &&
      entry.attempt === 1 &&
      entry.failureClass !== "ENV",
  );
  const covered = coverage.filter((entry) => entry.passing).length;
  const runSummaries = loadRunSummaries(evidenceRoot);

  // Named follow-ups from PASS_WITH_ACTIONS rows. Preserved for audit; they do not affect M1
  // (PASS_WITH_ACTIONS already counts as accepted). resolution is an optional human note.
  const gateFollowUps = gateEntries
    .filter(
      (entry) =>
        entry.verdict === "PASS_WITH_ACTIONS" &&
        Array.isArray(entry.actions) &&
        entry.actions.length > 0,
    )
    .map((entry) => ({
      requirementId: entry.requirementId,
      attempt: entry.attempt,
      actions: entry.actions,
      resolution:
        typeof entry.resolution === "string" && entry.resolution.trim()
          ? entry.resolution
          : null,
    }));
  const incompleteGateFollowUps = gateEntries
    .filter(
      (entry) =>
        entry.verdict === "PASS_WITH_ACTIONS" &&
        (!Array.isArray(entry.actions) || entry.actions.length === 0),
    )
    .map((entry) => entry.requirementId);

  const metrics = {
    generatedAt: now,
    runId: resolvedRunId,
    status:
      activeRequirements.length === 0 && tests.length === 0
        ? "bootstrap"
        : tests.some((test) => !test.requirement)
          ? "partial"
          : "ready",
    metrics: {
      M1: {
        name: "accepted-test rate",
        ...ratio(
          gateEntries.filter((entry) => ACCEPTED.has(entry.verdict)).length,
          gateEntries.length,
          "No first-submission gate evidence",
        ),
      },
      M2: {
        name: "first-pass CI rate",
        ...ratio(
          ciEntries.filter((entry) => entry.outcome === "passed").length,
          ciEntries.length,
          "No first-attempt PR CI evidence",
        ),
      },
      M3: { name: "new-test flake rate", ...flakeMetric(runSummaries, now) },
      M4: {
        name: "QA effort per accepted scenario",
        value:
          effortEntries.length === 0
            ? null
            : effortEntries.reduce((total, entry) => total + entry.minutes, 0) /
              effortEntries.length,
        unit: "person-minutes",
        denominator: effortEntries.length,
        status: effortEntries.length === 0 ? "unavailable" : "available",
        ...(effortEntries.length === 0
          ? { reason: "No accepted-scenario effort evidence" }
          : {}),
      },
      M5: {
        name: "requirement-to-test coverage",
        ...ratio(covered, activeRequirements.length, "No active requirements"),
      },
    },
    gateFollowUps,
    gaps: [
      ...(summary.traceabilityGaps.length > 0
        ? [
            `${summary.traceabilityGaps.length} executed test(s) lack a requirement id prefix`,
          ]
        : []),
      ...(executionStatus === "not-run"
        ? ["No test files exist yet; execution was not started"]
        : []),
      ...(gateFollowUps.length > 0
        ? [
            `${gateFollowUps.length} accepted gate verdict(s) carry named follow-up actions`,
          ]
        : []),
      ...(incompleteGateFollowUps.length > 0
        ? [
            `${incompleteGateFollowUps.length} legacy PASS_WITH_ACTIONS verdict(s) lack named actions: ${incompleteGateFollowUps.join(", ")}`,
          ]
        : []),
    ],
  };
  writeJson(path.join(evidenceRoot, "metrics.json"), metrics);
  return { summary, coverage, metrics };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildEvidence({
      framework: args.framework,
      reportPath: args.report,
      runId: args["run-id"],
    });
    console.log(
      `[evidence] ${result.metrics.status}: ${result.summary.totals.passed} passed, ${result.summary.totals.failed} failed, ${result.summary.traceabilityGaps.length} traceability gap(s)`,
    );
  } catch (error) {
    console.error(`[evidence] ${error.message}`);
    process.exit(1);
  }
}
