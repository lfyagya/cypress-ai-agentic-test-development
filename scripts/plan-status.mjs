#!/usr/bin/env node
/**
 * Regenerates the status block in docs/test-automation-plan.md from evidence.
 *
 * The plan's "where we actually are" table restates facts that already have an owner:
 * evidence/requirements.json owns status, and evidence/coverage-computed.json owns whether a
 * requirement has a passing test. Hand-maintaining a third copy is how a plan goes stale the first
 * time someone builds a requirement and forgets the doc.
 *
 * Same mechanism the harness already uses for the rules block in CLAUDE.md: markers delimit a
 * generated region, everything outside stays hand-written.
 *
 *   node scripts/plan-status.mjs           rewrite the block
 *   node scripts/plan-status.mjs --check   exit 1 if the block is stale
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const START = "<!-- PLAN:STATUS:START -->";
export const END = "<!-- PLAN:STATUS:END -->";
const NOTE =
  "<!-- Generated from evidence/requirements.json + evidence/coverage-computed.json — run `npm run plan:status`. Do not edit by hand. -->";

const PLAN = path.join("docs", "test-automation-plan.md");

function cell(value, width) {
  return String(value).padEnd(width);
}

export function renderStatus(requirements, coverage) {
  const passingIds = new Set(
    (coverage?.requirements ?? [])
      .filter((entry) => entry.passing)
      .map((entry) => entry.requirement),
  );

  const rows = requirements.map((requirement) => {
    const active = requirement.status === "active";
    return [
      `\`${requirement.id}\``,
      requirement.module,
      `${requirement.type} ${requirement.priority}`,
      requirement.tier,
      active ? "active" : `**${requirement.status}**`,
      passingIds.has(requirement.id) ? "passing" : "none",
    ];
  });

  const headers = [
    "Requirement",
    "Module",
    "Type / Pri",
    "Tier",
    "Status",
    "Test",
  ];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );

  const line = (cells) =>
    `| ${cells.map((value, column) => cell(value, widths[column])).join(" | ")} |`;

  const active = requirements.filter((r) => r.status === "active");
  const covered = active.filter((r) => passingIds.has(r.id));
  const held = requirements.filter((r) => r.status !== "active");

  const heldNote =
    held.length === 0
      ? "No requirement is held."
      : `${held.length} held: ${held.map((r) => `\`${r.id}\``).join(", ")}.`;

  return [
    START,
    NOTE,
    "",
    // Deliberately no runId. evidence:build stamps a fresh one every run, so embedding it here made
    // the block stale the moment it was generated — and `verify` runs evidence:build immediately
    // before plan:check, so verify could never go green. The block states what is covered; the
    // artifact it names holds when that was measured.
    "Measured, not asserted — from `evidence/coverage-computed.json`:",
    "",
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
    "",
    `${active.length} active, ${covered.length} covered and passing. ${heldNote} ` +
      `Coverage of _active_ requirements is ${active.length === 0 ? "n/a" : `${Math.round((covered.length / active.length) * 100)}%`}; ` +
      `coverage of _known verified behaviour_ is ${covered.length}/${requirements.length}.`,
    END,
  ].join("\n");
}

export function spliceBlock(document, block) {
  const start = document.indexOf(START);
  const end = document.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `${PLAN} is missing the ${START} / ${END} markers; add them around the status section.`,
    );
  }
  return document.slice(0, start) + block + document.slice(end + END.length);
}

export async function buildPlan(repoRoot = DEFAULT_ROOT) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, "evidence", file), "utf8"));
  const planPath = path.join(repoRoot, PLAN);
  const current = fs.readFileSync(planPath, "utf8");
  const spliced = spliceBlock(
    current,
    renderStatus(
      read("requirements.json").requirements,
      read("coverage-computed.json"),
    ),
  );
  // Format the result the same way the repo formats everything else. Without this the generated
  // block and `prettier --check` disagree over whitespace, and `plan:check` fails on a file it
  // just wrote.
  const next = await prettier.format(spliced, {
    ...(await prettier.resolveConfig(planPath)),
    filepath: planPath,
  });
  return { planPath, current, next };
}

async function main() {
  const check = process.argv.includes("--check");
  const { planPath, current, next } = await buildPlan();

  if (current === next) {
    console.log(`[plan] ${PLAN} status block is current.`);
    return;
  }
  if (check) {
    console.error(
      `[plan] ${PLAN} status block is stale. Run \`npm run plan:status\` and commit the result.`,
    );
    process.exit(1);
  }
  fs.writeFileSync(planPath, next);
  console.log(`[plan] rewrote the status block in ${PLAN}.`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
