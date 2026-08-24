#!/usr/bin/env node
// The concern registry must describe this adapter's rules completely, and the tier model must be
// consistent with the severities the adapter actually declares.
//
// Without this, the registry is documentation: a rule could name a concern that does not exist, or
// a Tier 0 trust boundary could be declared `review`, and everything would still report green. That
// is the failure mode the whole tier model exists to prevent, so it gets a test rather than a
// convention.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONCERNS,
  CONCERN_IDS,
  concernsForPattern,
  isInvariant,
} from "../../harness/concerns.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const config = JSON.parse(
  fs.readFileSync(path.join(root, "harness.config.json"), "utf8"),
);
const { framework, rules } = config;

// 1. Every rule names a concern, and every named concern exists.
for (const rule of rules) {
  assert.ok(
    rule.concern,
    `rule "${rule.id}" declares no concern. An adapter's rule id is its own name for a concern; ` +
      `without the mapping, the same concern under two names in two adapters goes unnoticed — ` +
      `which is exactly how storage-state-auth and require-auth-command drifted apart.`,
  );
  assert.ok(
    CONCERN_IDS.includes(rule.concern),
    `rule "${rule.id}" names unknown concern "${rule.concern}". Known: ${CONCERN_IDS.join(", ")}`,
  );
}

// 2. Tier 0 concerns must be declared `block` with write-time enforcement. A trust boundary that
//    only warns is not a trust boundary.
for (const rule of rules) {
  if (!isInvariant(rule.concern)) continue;
  assert.equal(
    rule.severity,
    "block",
    `rule "${rule.id}" carries Tier 0 concern ${rule.concern} but is declared "${rule.severity}". ` +
      `Tier 0 is non-negotiable and cannot be downgraded by an adapter, let alone a project.`,
  );
}

// 3. A Tier 1 rule is `block` or `review`, never anything else, and never absent from enforcement.
for (const rule of rules) {
  if (CONCERNS[rule.concern].tier !== 1) continue;
  assert.ok(
    ["block", "review"].includes(rule.severity),
    `rule "${rule.id}" (Tier 1) has severity "${rule.severity}"; Tier 1 allows block or review only`,
  );
}

// 4. Every Tier 2 concern declares which architecture patterns select it. A Tier 2 concern with no
//    patterns applies to nothing and would silently disappear from every project.
for (const id of CONCERN_IDS) {
  if (CONCERNS[id].tier !== 2) continue;
  assert.ok(
    Array.isArray(CONCERNS[id].patterns) && CONCERNS[id].patterns.length > 0,
    `Tier 2 concern ${id} declares no patterns, so nothing would ever select it`,
  );
}

// 5. Pattern selection behaves: Tier 0 and 1 always apply; Tier 2 depends on the pattern. This is
//    the mechanism that lets a POM project adopt the harness without the architecture rules that
//    made it unadoptable, so it is asserted rather than assumed.
const alwaysOn = CONCERN_IDS.filter((id) => CONCERNS[id].tier < 2);
for (const pattern of [
  "helper-first",
  "command-first",
  "pom",
  "bdd-pom",
  "data-driven",
]) {
  const selected = concernsForPattern(pattern);
  for (const id of alwaysOn) {
    assert.ok(
      selected.includes(id),
      `${pattern} must include Tier 0/1 concern ${id}`,
    );
  }
}
assert.ok(
  concernsForPattern("helper-first").includes("ARCH-BOUNDARY"),
  "helper-first rejects page objects, so ARCH-BOUNDARY must apply to it",
);
assert.ok(
  !concernsForPattern("bdd-pom").includes("ARCH-BOUNDARY"),
  "bdd-pom IS page objects, so ARCH-BOUNDARY must not apply to it — this is the mechanism that " +
    "makes the harness adoptable by the 11 of 22 surveyed projects that report POM",
);
assert.ok(
  !concernsForPattern("pom").includes("ARCH-BOUNDARY"),
  "pom must not carry ARCH-BOUNDARY either",
);
assert.ok(
  concernsForPattern("bdd-pom").includes("CRED"),
  "a POM project still gets every Tier 0 concern — pattern selection is not an escape hatch",
);

console.log(
  `[concerns] ${framework}: ${rules.length} rule(s) mapped to ${new Set(rules.map((r) => r.concern)).size} ` +
    `concern(s); tiers consistent; pattern selection verified`,
);
