/**
 * L3 — the architecture pattern layer. What a project's *architecture* implies, independent of
 * framework and of any one project's paths.
 *
 * The layer the three-layer model was missing. It conflated framework with architecture, so
 * `Config → Helpers → Tests` was encoded at engine level as if it were a property of Playwright.
 * It is not: Laudio is Playwright too, and runs BDD over page objects.
 *
 * A pattern declares two things:
 *
 *   codeKinds   Which file kinds carry implementation, and therefore must be scanned by the rules
 *               that police selectors, routes and credentials. This is the half that is easy to get
 *               wrong: deselecting ARCH-BOUNDARY for a POM project makes `pages/` legitimate, but if
 *               page files are not also *code*, the selector rule is declared and never fires on the
 *               very files a POM project keeps its selectors in.
 *
 *   extraRoots  Declared path keys beyond testRoot that hold code for this architecture — a BDD
 *               project's step definitions, for instance. Without this, step files sit outside the
 *               scanner's scope entirely.
 *
 * Kinds are pattern-level tokens; the adapter maps them onto its own file suffixes, because
 * `.page.ts` and `.actions.js` are framework idioms and this layer must not know about them.
 */

const BASE_KINDS = ["spec", "fixture", "setup"];

export const PATTERNS = {
  "helper-first": {
    description:
      "Config → Helpers → Tests. Playwright boilerplate's native architecture; rejects page objects.",
    codeKinds: [...BASE_KINDS, "helpers"],
    extraRoots: [],
  },
  "command-first": {
    description:
      "Config → Commands → Tests. Cypress boilerplate's native architecture; rejects action classes.",
    codeKinds: [...BASE_KINDS, "commands"],
    extraRoots: [],
  },
  pom: {
    description:
      "Page Object Model. The modal architecture in the portfolio — 11 of 22 surveyed projects.",
    // Page objects ARE the implementation layer here, so they are code. Without this the selector
    // and route rules would be declared and never reach the files that hold selectors and routes.
    codeKinds: [...BASE_KINDS, "page", "helpers"],
    extraRoots: [],
  },
  "bdd-pom": {
    description:
      "Cucumber/Gherkin features over page objects. Laudio's architecture.",
    codeKinds: [...BASE_KINDS, "page", "steps", "helpers"],
    // Step definitions are implementation, and they live outside testRoot in most BDD layouts.
    extraRoots: ["stepRoot"],
  },
  "data-driven": {
    description:
      "Fixture- or table-driven cases over a shared implementation layer.",
    codeKinds: [...BASE_KINDS, "helpers", "data"],
    extraRoots: [],
  },
};

export const PATTERN_IDS = Object.keys(PATTERNS);

export function loadPattern(pattern) {
  const found = PATTERNS[pattern];
  if (!found) {
    throw new Error(
      `unknown architecture pattern "${pattern}". Known: ${PATTERN_IDS.join(", ")}. ` +
        `A pattern the spec does not describe is a missing dimension, not a project-specific ` +
        `branch — add it here once, for everyone.`,
    );
  }
  return found;
}

/**
 * The adapter's own file suffixes for every code kind this pattern implies.
 *
 * A kind the adapter has no convention for drops out rather than erroring: Cypress has no
 * `.fixture.` or `.setup.` file, so `command-first` resolves to `(cy|commands)` there and the scope
 * is not widened to files that framework never produces.
 */
export function codeSuffixesFor(pattern, kindSuffix) {
  const suffixes = loadPattern(pattern)
    .codeKinds.map((kind) => kindSuffix[kind])
    .filter(Boolean);
  if (suffixes.length === 0) {
    throw new Error(
      `pattern "${pattern}" resolves to no code suffixes for this adapter. Every implementation ` +
        `rule scopes on them, so an empty set means the selector, route and credential rules are ` +
        `declared and scan nothing.`,
    );
  }
  return [...new Set(suffixes)];
}

/**
 * Every root a scanner must cover for this pattern: the test root plus any architecture-specific
 * roots the project declared. A declared extra root that the project left unset is skipped rather
 * than failing — a BDD project that keeps steps inside testRoot is a legitimate layout.
 */
export function scanRootsFor(pattern, project) {
  const roots = [project.testRoot];
  for (const key of loadPattern(pattern).extraRoots) {
    const declared = project[key];
    if (declared && !declared.startsWith("<")) roots.push(declared);
  }
  return [...new Set(roots)];
}
