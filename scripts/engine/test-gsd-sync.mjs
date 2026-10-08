#!/usr/bin/env node
// GSD end to end in a clone: run the real sync.mjs from a sandbox holding only what the overlay
// manifest ships. Two things are checked that no unit test sees:
//   - an engine import the manifest forgot fails HERE, not in a consumer's own sandbox test;
//   - the scaffold, projections, and role-scoped agent guidance that sync actually writes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GSD_WORKFLOW } from "../../harness/workflow-model.mjs";
import { RULES_END, RULES_START } from "./templates.mjs";

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// The manifest is the installer's own list, read from its source so this cannot drift from it.
// Framework-templated entries (template literals) are adapter payload, not engine, and are skipped.
const installer = fs.readFileSync(
  path.join(SRC, "scripts", "engine", "install-overlay.mjs"),
  "utf8",
);
const manifestBody = installer.slice(
  installer.indexOf("function manifest(framework)"),
  installer.indexOf(
    "\n  ];",
    installer.indexOf("function manifest(framework)"),
  ),
);
const shipped = [...manifestBody.matchAll(/^\s*"([^"]+)",/gm)].map(
  (match) => match[1],
);
assert.ok(
  shipped.includes("harness/workflow-model.mjs") &&
    shipped.includes("harness/lane-model.mjs"),
  "the overlay manifest must ship the GSD and lane models",
);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-sync-"));
try {
  for (const entry of shipped) {
    const from = path.join(SRC, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(sandbox, entry);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }

  const write = (relative, content) => {
    const target = path.join(sandbox, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const read = (relative) =>
    fs.readFileSync(path.join(sandbox, relative), "utf8");
  const exists = (relative) => fs.existsSync(path.join(sandbox, relative));

  write(
    "harness.config.json",
    JSON.stringify({
      version: 1,
      framework: "cypress",
      workflow: structuredClone(GSD_WORKFLOW),
      adapters: { claude: { enabled: true }, codex: { enabled: true } },
      project: {
        name: "sandbox",
        architecture: "Config → Commands → Tests",
        pattern: "command-first",
        laneId: "ui-e2e",
        laneName: "UI E2E",
        laneKind: "e2e",
        safety: {
          targets: ["dev", "qa"],
          mutation: "allowlisted",
          allowedOperations: ["create synthetic test data"],
        },
        sources: {
          tickets: "PAY board",
          api: ["https://example.test/openapi.json"],
        },
        testRoot: "cypress",
        configRoot: "cypress/configs",
        commandRoot: "cypress/support/commands",
        specGlob: "cypress/tests/**/*.cy.js",
      },
      loops: { gateRepairLimit: 2 },
      qaFoundations: "harness/qa-automation-foundations.md",
      rules: [
        {
          id: "no-hard-wait",
          concern: "WAIT",
          severity: "block",
          enforcement: "CI",
          never: "cy.wait(<number>)",
          instead: "a state-based assertion",
          why: "A fixed wait masks the real timing bug.",
          message: "Hard wait detected.",
        },
      ],
      agents: [
        {
          name: "builder",
          description: "Writes the change.",
          role: "GENERATE",
          tools: ["Read", "Edit", "Bash"],
        },
        {
          name: "gate",
          description: "Grades the change.",
          role: "EVALUATE",
          permissionMode: "plan",
          tools: ["Read", "Grep", "Glob"],
        },
      ],
      hooks: {},
    }),
  );
  write("harness/qa-automation-foundations.md", "# Foundations\n");
  write("harness/agents/builder.md", "You are the builder.\n");
  write("harness/agents/gate.md", "You are the gate.\n");
  write("CLAUDE.md", `# Sandbox\n\n${RULES_START}\n${RULES_END}\n`);

  const sync = () =>
    execFileSync(
      process.execPath,
      [path.join(sandbox, "scripts", "engine", "sync.mjs")],
      { cwd: sandbox, encoding: "utf8" },
    );
  const output = sync();

  // GSD work state is scaffolded, and only when absent.
  for (const file of ["PROJECT", "REQUIREMENTS", "ROADMAP", "STATE"]) {
    assert.ok(exists(`.planning/${file}.md`), `${file}.md must be scaffolded`);
  }
  assert.ok(exists(".planning/phases/.gitkeep"));
  assert.match(output, /created \.planning\/STATE\.md/);

  write(".planning/STATE.md", "# State\n\nCurrent phase: 02-checkout\n");
  fs.rmSync(path.join(sandbox, ".planning", "ROADMAP.md"));
  const second = sync();
  assert.match(
    read(".planning/STATE.md"),
    /02-checkout/,
    "sync must never overwrite team-owned GSD state",
  );
  assert.ok(exists(".planning/ROADMAP.md"), "a deleted artifact is recreated");
  assert.doesNotMatch(second, /created \.planning\/STATE\.md/);

  // Every enabled projection carries the workflow and the lane's declared boundary.
  for (const projection of ["CLAUDE.md", "AGENTS.md"]) {
    assert.match(read(projection), /## GSD workflow — required for every task/);
    assert.match(read(projection), /## Lane safety boundary/);
    assert.match(read(projection), /create synthetic test data/);
    assert.match(read(projection), /## PRD sources for this project/);
    assert.match(read(projection), /\*\*tickets:\*\* PAY board/);
    assert.match(
      read(projection),
      /Not declared: confluence, figma, documentation/,
    );
  }

  // Role-scoped: the builder gets the lifecycle after its role; the read-only gate gets the
  // evaluator stanza and never the instruction to plan, execute, or ship.
  const builder = read(".claude/agents/builder.md");
  assert.match(builder, /required for every task/);
  assert.ok(
    builder.indexOf("You are the builder.") <
      builder.indexOf("required for every task"),
    "the role statement must lead",
  );
  const gate = read(".claude/agents/gate.md");
  assert.match(gate, /your role as the independent evaluator/);
  assert.doesNotMatch(gate, /required for every task/);
  assert.match(gate, /never write a PRD, plan, or cases/);
  assert.doesNotMatch(
    gate,
    /Gate:/,
    "the evaluator is not handed the builder's gates",
  );

  console.log(
    "test-gsd-sync: manifest closure, scaffold, projections, and role scoping passed",
  );
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
