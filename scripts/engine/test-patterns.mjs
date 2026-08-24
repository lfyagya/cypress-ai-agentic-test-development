#!/usr/bin/env node
// The L3 pattern layer decides which files the implementation rules can see. That is the half of
// pattern selection which is easy to get wrong in the dangerous direction.
//
// Deselecting ARCH-BOUNDARY for a POM project makes `pages/` a legitimate place to keep code. If
// page files are not also counted as *code*, the selector and route rules stay declared and never
// fire on the files a POM project actually keeps selectors and routes in. That is the same
// declared-but-unenforced shape found six times over during P1 — this test exists so P2 does not
// add a seventh.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PATTERN_IDS,
  codeSuffixesFor,
  loadPattern,
  scanRootsFor,
} from "../../harness/patterns.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const config = JSON.parse(
  fs.readFileSync(path.join(root, "harness.config.json"), "utf8"),
);
const { framework, project } = config;

// This adapter's kind map, mirroring its patterns module. Kept here rather than imported so the
// test fails if the two ever disagree about what this framework calls things.
const KIND_SUFFIX =
  framework === "cypress"
    ? {
        spec: "cy",
        commands: "commands",
        helpers: "helpers",
        page: "page",
        steps: "steps",
        data: "data",
      }
    : {
        spec: "spec",
        helpers: "helpers",
        fixture: "fixture",
        setup: "setup",
        page: "page",
        steps: "steps",
        data: "data",
      };

// 1. Every declared pattern resolves to a non-empty code scope on this adapter. A pattern that
//    resolves to nothing would silently disable every implementation rule.
for (const pattern of PATTERN_IDS) {
  const suffixes = codeSuffixesFor(pattern, KIND_SUFFIX);
  assert.ok(
    suffixes.length > 0,
    `${pattern} resolves to no code suffixes on ${framework}`,
  );
}

// 2. The native pattern reproduces exactly what this adapter scanned before L3 existed.
const nativeSuffixes = codeSuffixesFor(project.pattern, KIND_SUFFIX);
const expectedNative =
  framework === "cypress"
    ? ["cy", "commands"]
    : ["spec", "fixture", "setup", "helpers"];
assert.deepEqual(
  [...nativeSuffixes].sort(),
  [...expectedNative].sort(),
  `${framework}'s native pattern must reproduce its historical code scope`,
);

// 3. The payoff: a POM architecture counts page objects as code, so the selector rule reaches them.
for (const pattern of ["pom", "bdd-pom"]) {
  assert.ok(
    codeSuffixesFor(pattern, KIND_SUFFIX).includes("page"),
    `${pattern} must count page files as code — a POM project keeps its selectors there, and a ` +
      `selector rule that cannot see them is declared and unenforced`,
  );
}

// 4. And the inverse: the boilerplate architectures do NOT count page files as code, because they
//    reject page objects outright via ARCH-BOUNDARY. Counting them would imply the file is a
//    legitimate place to work.
for (const pattern of ["helper-first", "command-first"]) {
  assert.ok(
    !codeSuffixesFor(pattern, KIND_SUFFIX).includes("page"),
    `${pattern} rejects page objects, so page files must not be treated as a legitimate code kind`,
  );
}

// 5. BDD adds step definitions as code, and pulls a declared stepRoot into scan scope.
assert.ok(
  codeSuffixesFor("bdd-pom", KIND_SUFFIX).includes("steps"),
  "bdd-pom must count step definitions as code",
);
assert.deepEqual(
  scanRootsFor("bdd-pom", { testRoot: "e2e", stepRoot: "e2e/support/steps" }),
  ["e2e", "e2e/support/steps"],
  "a declared stepRoot must join the scan scope",
);
assert.deepEqual(
  scanRootsFor("bdd-pom", { testRoot: "e2e" }),
  ["e2e"],
  "an unset stepRoot is a legitimate layout, not an error",
);
assert.deepEqual(
  scanRootsFor("bdd-pom", { testRoot: "e2e", stepRoot: "<theirs>" }),
  ["e2e"],
  "an unfilled placeholder must not become a scan root — it would match nothing and read as scope",
);
assert.deepEqual(
  scanRootsFor(project.pattern, project),
  [project.testRoot],
  "this adapter's native pattern declares no extra roots, so scope is unchanged",
);

// 6. An unknown pattern is a missing dimension, not a silent no-op.
assert.throws(
  () => loadPattern("no-such-pattern"),
  /unknown architecture pattern/,
  "an unknown pattern must fail loudly rather than resolving to an empty rule set",
);

console.log(
  `[patterns] ${framework}: ${PATTERN_IDS.length} pattern(s) resolve; native scope preserved; ` +
    `POM counts page files as code; bdd-pom adds steps and stepRoot`,
);
