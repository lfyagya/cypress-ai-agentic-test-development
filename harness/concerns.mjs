/**
 * L0/L1 — the concern registry. One entry per thing the harness cares about, independent of
 * framework and of what any adapter chooses to call its rule.
 *
 * Why this exists: an adapter's rule *id* is its own name for a concern, and the two adapters had
 * drifted apart on that. Playwright called cached authentication `storage-state-auth`; Cypress
 * called the same concern `require-auth-command`. Nothing tied them together, so a project that
 * migrated framework silently changed which concerns applied to it — and Laudio migrated Cypress to
 * Playwright. Stable concern ids above per-adapter rule ids is the fix.
 *
 * `tier` decides who may change a rule, per the conformance spec §6.2:
 *
 *   0  Invariant       nobody. Trust boundary. Composition rejects any override.
 *   1  Universal       default block; downgradeable to `review` with a recorded reason. Never off.
 *   2  Pattern-bound   not negotiated at all — selected by the project's declared architecture.
 *
 * A Tier 2 concern declares `patterns`: the architecture patterns it applies to. A project running
 * BDD with page objects does not get `ARCH-BOUNDARY`, not as a favour, but because the concern
 * describes an architecture that project is not using.
 */

export const CONCERNS = {
  CRED: {
    tier: 0,
    summary: "no credential literals in source",
    why: "A committed credential is a breach, not a style issue.",
  },
  "SMOKE-RO": {
    tier: 0,
    summary: "smoke suites stay read-only",
    why: "Smoke coverage runs against shared and production-like environments.",
  },

  WAIT: {
    tier: 1,
    summary: "no fixed-delay waits",
    why: "A fixed delay hides the real readiness condition and flakes in CI.",
  },
  SELECTOR: {
    tier: 1,
    summary: "no selector literals outside config",
    why: "A UI change should have one owner, not scattered copies.",
  },
  ROUTE: {
    tier: 1,
    summary: "no route or endpoint literals when config exists",
    why: "Routes and API contracts need one maintained registry.",
  },
  "SEARCH-FIRST": {
    tier: 1,
    summary: "search by value before creating a new asset",
    why: "Duplicate owners cause one app change to need multiple fixes.",
  },
  TRACE: {
    tier: 1,
    ratchet: true,
    summary: "exactly one known requirement id per test",
    why: "Without it, coverage is not computable and the rollout has no evidence.",
    ratchetNote:
      "Spec §6.4: onboard at `review` so an existing untagged suite can adopt at all, then ratchet " +
      "to `block` after the project's first clean sprint. The ratchet date is recorded in the profile.",
  },
  "FOCUSED-QUARANTINED": {
    tier: 1,
    summary: "no focused tests; skipped tests need a recorded quarantine",
    why: "A focused test can hide suite failures, while an unrecorded skip hides risk with no owner.",
  },
  "LOCATOR-PRIORITY": {
    tier: 1,
    summary: "prefer semantic locators over structural ones",
    why: "Semantic locators survive refactors and double as accessibility pressure.",
    gateOnly: true,
  },
  "LOCATOR-NARROW": {
    tier: 1,
    summary: "narrow with a filter before reaching for an index",
    why: "An index silently targets the wrong element and fails as a passing test.",
    gateOnly: true,
  },

  "CACHED-AUTH": {
    tier: 2,
    summary: "authentication is cached once, not replayed per test",
    why: "Authentication should be isolated and cached, not repeated in every test.",
    // Applies to every architecture: caching authentication is orthogonal to how the UI layer is
    // organised.
    //
    // Deliberately NOT conditional on the project's declared `strategy.auth`, though an earlier
    // version of this comment claimed it was. Tier 2 selection keys on architecture only, and
    // wiring it to D4 as well would make `strategy` a second route to switching a rule off — one
    // that bypasses the recorded-reason requirement that governs every other relaxation. A project
    // that genuinely must re-authenticate per test is a case for a new pattern or a spec change,
    // decided once for everyone, not a per-project escape hatch.
    patterns: [
      "helper-first",
      "command-first",
      "pom",
      "bdd-pom",
      "data-driven",
    ],
  },
  "ARCH-BOUNDARY": {
    tier: 2,
    summary: "one owner for the UI abstraction layer",
    why: "A second UI abstraction duplicates config and helper ownership.",
    // The concern that made the harness unadoptable for Laudio. It is real for the two
    // boilerplate architectures, which reject page objects on purpose, and meaningless for a
    // project whose architecture *is* page objects. 11 of 22 surveyed projects report POM.
    patterns: ["helper-first", "command-first"],
  },
};

/** Every concern id, for validation and reporting. */
export const CONCERN_IDS = Object.keys(CONCERNS);

/** Concerns that apply to a declared architecture pattern. Tier 0 and 1 always apply. */
export function concernsForPattern(pattern) {
  return CONCERN_IDS.filter((id) => {
    const concern = CONCERNS[id];
    if (concern.tier < 2) return true;
    return (concern.patterns ?? []).includes(pattern);
  });
}

/** True when a project may not change this concern's severity by any mechanism. */
export function isInvariant(concernId) {
  return CONCERNS[concernId]?.tier === 0;
}
