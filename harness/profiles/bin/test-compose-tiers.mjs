#!/usr/bin/env node
// Composition must honour the tier model, and every rejection must actually reject.
//
// The permissive half is the point of P2: a POM project composes without the architecture rules
// that made the harness unadoptable. The restrictive half is what keeps that from becoming a way to
// switch off anything inconvenient. Both halves are asserted, because a tier model that only ever
// permits is not a model.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONCERNS } from "../../concerns.mjs";
import { compose, resolveRules } from "./compose-harness-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, "..", "..", "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "harness.config.json"), "utf8"),
);
const base = JSON.parse(
  fs.readFileSync(
    path.join(HERE, "..", "adapters", `${config.framework}.json`),
    "utf8",
  ),
);

const profile = (extra = {}) => ({
  key: "tier-fixture",
  adapter: config.framework,
  projectName: "tier-fixture",
  ...extra,
});

const idsFor = (extra) => resolveRules(base, profile(extra)).map((r) => r.id);
const concernsFor = (extra) =>
  new Set(resolveRules(base, profile(extra)).map((r) => r.concern));

// 1. No pattern declared falls back to the adapter's native one, so every existing profile keeps
//    composing exactly as it did. Parity first: a dimension that breaks today's projects on the way
//    to serving tomorrow's is not worth having.
assert.deepEqual(
  idsFor({}),
  base.rules.map((r) => r.id),
  "with no declared pattern, the adapter's native pattern must reproduce the full rule set",
);

// 2. A POM project loses ARCH-BOUNDARY and nothing else. This is the whole mechanism.
const pomConcerns = concernsFor({ pattern: "bdd-pom" });
assert.ok(
  !pomConcerns.has("ARCH-BOUNDARY"),
  "bdd-pom must not carry ARCH-BOUNDARY — its architecture IS page objects",
);
for (const id of Object.keys(CONCERNS)) {
  if (CONCERNS[id].tier >= 2) continue;
  const declared = base.rules.some((r) => r.concern === id);
  if (!declared) continue;
  assert.ok(
    pomConcerns.has(id),
    `bdd-pom must keep Tier ${CONCERNS[id].tier} concern ${id}: pattern selection removes ` +
      `architecture rules, not safety or quality rules`,
  );
}
assert.ok(
  pomConcerns.has("CACHED-AUTH"),
  "bdd-pom still caches auth — CACHED-AUTH declares every pattern",
);

// 3. A Tier 1 downgrade with a recorded reason is honoured, and the reason survives into the rule
//    so the generated instructions can state it.
const downgraded = resolveRules(
  base,
  profile({
    ruleOverrides: {
      TRACE: {
        severity: "review",
        reason:
          "existing untagged suite; ratcheting after the first clean sprint",
        ratchetBy: "2026-10-01",
      },
    },
  }),
).find((r) => r.concern === "TRACE");
assert.ok(downgraded, "TRACE rule must survive an override");
assert.equal(downgraded.severity, "review");
assert.match(downgraded.overrideReason, /existing untagged suite/);
assert.equal(downgraded.ratchetBy, "2026-10-01");

// 4. Every rejection. Each of these would otherwise be a quiet way to disable enforcement.
const rejects = [
  [
    { CRED: { severity: "review", reason: "inconvenient" } },
    /Tier 0, a trust boundary/,
    "a Tier 0 trust boundary must not be downgradeable",
  ],
  [
    { "ARCH-BOUNDARY": { severity: "review", reason: "we use POM" } },
    /selected by the declared \n?pattern|selected by the declared pattern/,
    "Tier 2 must be changed via pattern, not via an override",
  ],
  [
    { WAIT: { severity: "off" } },
    /cannot switch "WAIT" off/,
    "off must be refused; review still scores at the gate",
  ],
  [
    { WAIT: { severity: "review" } },
    /no reason/,
    "a downgrade with no recorded reason must be refused",
  ],
  [
    { NOT_A_CONCERN: { severity: "review", reason: "x" } },
    /unknown concern/,
    "an unknown concern id must be refused rather than ignored",
  ],
  [
    { WAIT: { severity: "warn", reason: "x" } },
    /must be "block" or "review"/,
    "an invented severity must be refused",
  ],
];
for (const [ruleOverrides, expected, message] of rejects) {
  assert.throws(
    () => resolveRules(base, profile({ ruleOverrides })),
    expected,
    message,
  );
}

// 5. wiring and strategy: validated and carried, or rejected. These were declared in profiles and
//    silently dropped at composition until P2 -- a team could name a package manager and nothing
//    anywhere would carry it.
const withBlocks = compose({
  ...profile({}),
  wiring: {
    packageManager: "yarn",
    workspacePackage: true,
    verifyScript: "yarn verify",
  },
  strategy: {
    auth: "cached-session",
    testData: "seeded",
    credentialSource: "vault",
  },
});
assert.equal(withBlocks.wiring.packageManager, "yarn");
assert.equal(withBlocks.strategy.credentialSource, "vault");
assert.ok(
  !("wiring" in compose(profile({}))),
  "a profile declaring no wiring must not gain the key -- existing configs stay byte-identical",
);
for (const [block, expected, why] of [
  [
    { wiring: { packageManager: "bun" } },
    /expected one of npm, yarn, pnpm/,
    "an unknown enum value must be refused",
  ],
  [
    { wiring: { packageManger: "yarn" } },
    /is not a known key/,
    "a misspelled key must be refused rather than ignored",
  ],
  [
    { wiring: { workspacePackage: "true" } },
    /must be a boolean/,
    "a stringly-typed boolean must be refused",
  ],
  [
    { strategy: { auth: "sso" } },
    /expected one of cached-session/,
    "an unknown auth strategy must be refused",
  ],
  [
    { strategy: { testData: "random" } },
    /expected one of fresh, seeded/,
    "an unknown test-data strategy must be refused",
  ],
  [{ strategy: [] }, /must be an object/, "an array must be refused"],
]) {
  assert.throws(() => compose({ ...profile({}), ...block }), expected, why);
}

// 5. An adapter with no native pattern and a profile that declares none is an error, not a silent
//    "no Tier 2 concerns apply".
assert.throws(
  () => resolveRules({ ...base, pattern: undefined }, profile({})),
  /no architecture pattern/,
  "a missing pattern must fail loudly rather than silently dropping every Tier 2 concern",
);

console.log(
  `[compose:tiers] ${config.framework}: native pattern reproduces ${base.rules.length} rule(s); ` +
    `bdd-pom drops ARCH-BOUNDARY only; wiring and strategy validated and carried; ` +
    `${rejects.length + 6} rejection(s) verified`,
);
