/**
 * L2 — Cypress rule patterns. The engine (L1) owns the scan mechanism; this file owns what
 * "a violation" looks like in Cypress, and nothing else.
 *
 * Rule order is preserved from the pre-split scanner because it is the order violations are
 * reported.
 */

import {
  SCRIPT_EXT,
  extractBalancedObject,
  isAllowedLiteral,
  lineNumberForIndex,
} from "./rule-engine.mjs";

const SPEC_RE = new RegExp(String.raw`\.cy\.${SCRIPT_EXT}$`, "i");
const COMMANDS_RE = new RegExp(String.raw`\.commands\.${SCRIPT_EXT}$`, "i");
const ACTIONS_RE = new RegExp(String.raw`\.actions\.${SCRIPT_EXT}$`, "i");
const SPEC_OR_COMMANDS_RE = new RegExp(
  String.raw`\.(?:cy|commands)\.${SCRIPT_EXT}$`,
  "i",
);
const TESTS_SPEC_RE = new RegExp(
  String.raw`cypress[\\/]tests[\\/].*\.cy\.${SCRIPT_EXT}$`,
  "i",
);
const SMOKE_SPEC_RE = new RegExp(
  String.raw`cypress[\\/]tests[\\/].*[\\/]smoke[\\/].*\.cy\.${SCRIPT_EXT}$`,
  "i",
);
const TARGET_FILE_RE = new RegExp(
  String.raw`cypress[\\/].*\.${SCRIPT_EXT}$`,
  "i",
);

export const EXTENSION_PATTERNS = {
  SCRIPT_EXT,
  SPEC_RE,
  COMMANDS_RE,
  ACTIONS_RE,
  SPEC_OR_COMMANDS_RE,
  TESTS_SPEC_RE,
  SMOKE_SPEC_RE,
  TARGET_FILE_RE,
};

export const targetFileRe = TARGET_FILE_RE;

// Framework idiom, exported for engine scripts that need to find test titles without knowing
// which framework they are in. Group 2 is the [REQUIREMENT-ID] prefix.
// Kept here rather than in the engine because "what a test call looks like" is exactly the kind
// of adapter knowledge L1 must not contain.
export const testTitleRe =
  /\b(?:it|specify)(?:\.\w+)?\s*\(\s*(['"`])\s*\[([^\]]+)\][\s\S]*?\1/g;

// Requirement id shape, e.g. AE-PRODUCTS-001 or REQ-1: uppercase segments joined by hyphens.
const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const TYPE_TAGS = new Set(["smoke", "regression"]);
const PRIORITY_TAGS = new Set(["P0", "P1", "P2"]);

export const rules = [
  {
    concern: "no-hard-wait",
    fallback:
      "Hard wait detected. Replace with cy.apiWait(...) or a deterministic state-based wait.",
    pattern: /\bcy\.wait\(\s*\d+\s*\)/g,
  },
  {
    concern: "no-page-object",
    fallback:
      "Action class or page-object wrapper detected. Use command-first architecture.",
    check: ({ filePath, content, push }) => {
      if (
        ACTIONS_RE.test(filePath) ||
        /(^|\/)(page-objects?|pageobjects?)(\/|$)/i.test(filePath) ||
        /\bclass\s+\w*(?:Page|Actions)\b/.test(content)
      ) {
        push(1);
      }
    },
  },
  {
    concern: "no-page-object",
    fallback:
      "Action class import detected. Command-first architecture forbids *.actions.js dependencies.",
    pattern: new RegExp(
      String.raw`from\s+['"][^'"]*\.actions\.${SCRIPT_EXT}['"]`,
      "g",
    ),
  },
  {
    concern: "no-page-object",
    fallback:
      "Page-object import detected. Command-first architecture forbids page-object dependencies.",
    pattern: /from\s+['"][^'"]*(page-obj|pageobject|page-object)[^'"]*['"]/gi,
  },
  {
    concern: "no-hardcoded-selector",
    fallback: null,
    appliesTo: (p) => SPEC_OR_COMMANDS_RE.test(p),
    pattern: /\bcy\.(get|find)\(\s*['"](?!@)([^'"]+)['"]\s*\)/g,
    messageBuilder: (m, { message, allowlist }) => {
      const selector = String(m[2] || "").trim();
      if (isAllowedLiteral(selector, allowlist.selectors, true)) return null;
      return (
        message ||
        `Hardcoded selector in cy.${m[1]}('${selector}'). Use config constants from cypress/configs/ui/**.`
      );
    },
  },
  {
    concern: "no-hardcoded-route",
    fallback: null,
    appliesTo: (p) => SPEC_OR_COMMANDS_RE.test(p),
    pattern: /\bcy\.visit\(\s*['"]([^'"]+)['"]\s*\)/g,
    messageBuilder: (m, { message, allowlist }) => {
      const route = String(m[1] || "").trim();
      const isLiteral = route.startsWith("/") || /^https?:\/\//i.test(route);
      if (!isLiteral || isAllowedLiteral(route, allowlist.routes)) return null;
      return (
        message ||
        `Hardcoded route '${route}' in cy.visit(...). Use route constants from cypress/configs/app/routes.js.`
      );
    },
  },
  {
    // Bypass with pragma: // @no-ensureAuthenticated (for modules with their own auth command)
    concern: "require-auth-command",
    fallback: "Missing cy.ensureAuthenticated() in auth-required test file.",
    appliesTo: (p) => TESTS_SPEC_RE.test(p),
    check: ({ filePath, content, push }) => {
      const requiresAuth = !/unauth|public|health/i.test(filePath);
      const hasPragma = /\/\/\s*@no-ensureAuthenticated/.test(content);
      if (
        requiresAuth &&
        !hasPragma &&
        !/cy\.ensureAuthenticated\(/.test(content)
      ) {
        push(1);
      }
    },
  },
  {
    // Trust boundary — never relaxed. Values starting with $ are skipped so
    // environment-variable interpolation passes.
    concern: "no-credential-literal",
    fallback: null,
    pattern:
      /\b(password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*["'`]([^"'`$][^"'`]{3,})["'`]/gi,
    messageBuilder: (m, { message }) =>
      message ||
      `Hardcoded credential assigned to '${m[1]}'. Read it with cy.env([...]) instead; keep the value in cypress.env.json (gitignored) or a CI secret.`,
  },
  {
    // Exactly one requirement tag per test, plus one Type and one Priority tag, with the title
    // requirement id matching the requirement tag. This is a structural, single-file check —
    // whether the id is *active* and unique across the repository is graded by evidence:build and
    // check:requirements, which can see cross-file and cross-branch state a write-time hook cannot.
    concern: "one-requirement-tag",
    fallback:
      "Spec must carry exactly one known requirement id in its title and tags.",
    appliesTo: (p) => TESTS_SPEC_RE.test(p),
    check: ({ filePath, content, message, push }) => {
      // Capture each test title, then parse an optional balanced options object after it.
      const testCallRe =
        /\b(?:it|specify)(?:\.\w+)?\s*\(\s*(['"`])([\s\S]*?)\1/g;
      let testMatch;
      while ((testMatch = testCallRe.exec(content)) !== null) {
        const lineNumber = lineNumberForIndex(content, testMatch.index);
        const title = String(testMatch[2] || "");
        let cursor = testCallRe.lastIndex;
        while (/\s/.test(content[cursor] || "")) cursor += 1;
        if (content[cursor] === ",") cursor += 1;
        while (/\s/.test(content[cursor] || "")) cursor += 1;
        const optionsObject = extractBalancedObject(content, cursor);
        const titleIdMatch = title.match(/^\s*\[([^\]]+)\]/);
        const titleId = titleIdMatch ? titleIdMatch[1].trim() : null;

        const tagsArrayMatch = optionsObject.match(/tags\s*:\s*\[([^\]]*)\]/);
        const tags = tagsArrayMatch
          ? [...tagsArrayMatch[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) =>
              m[1].trim(),
            )
          : [];
        const bare = (tag) => tag.replace(/^@/, "");
        const typeTags = tags.filter((tag) =>
          TYPE_TAGS.has(bare(tag).toLowerCase()),
        );
        const priorityTags = tags.filter((tag) =>
          PRIORITY_TAGS.has(bare(tag).toUpperCase()),
        );
        const requirementTags = tags.filter(
          (tag) =>
            !TYPE_TAGS.has(bare(tag).toLowerCase()) &&
            !PRIORITY_TAGS.has(bare(tag).toUpperCase()) &&
            REQUIREMENT_ID.test(bare(tag)),
        );
        const pathTier = ["smoke", "e2e", "ddt"].find((tier) =>
          filePath.split("/").includes(tier),
        );
        const tierTags = pathTier
          ? tags.filter((tag) => bare(tag).toLowerCase() === pathTier)
          : [];

        const problems = [];
        if (!titleId || !REQUIREMENT_ID.test(titleId)) {
          problems.push("title must begin with a [REQUIREMENT-ID] prefix");
        }
        if (requirementTags.length !== 1) {
          problems.push(
            `expected exactly one requirement id tag, found ${requirementTags.length}`,
          );
        }
        if (typeTags.length !== 1) {
          problems.push(
            `expected exactly one Type tag (@smoke or @regression), found ${typeTags.length}`,
          );
        }
        if (priorityTags.length !== 1) {
          problems.push(
            `expected exactly one Priority tag (@P0/@P1/@P2), found ${priorityTags.length}`,
          );
        }
        if (pathTier && tierTags.length !== 1) {
          problems.push(
            `expected exactly one tier tag (@${pathTier}) for the ${pathTier} path, found ${tierTags.length}`,
          );
        }
        if (
          titleId &&
          requirementTags.length === 1 &&
          bare(requirementTags[0]) !== titleId
        ) {
          problems.push(
            `title id [${titleId}] does not match requirement tag ${requirementTags[0]}`,
          );
        }
        if (problems.length > 0) {
          push(lineNumber, `${message} (${problems.join("; ")})`);
        }
      }
    },
  },
  {
    concern: "smoke-read-only",
    fallback:
      "Write request in smoke suite. Smoke tests must remain read-only.",
    appliesTo: (p) => SMOKE_SPEC_RE.test(p),
    pattern: /\bcy\.request\(\s*['"](POST|PUT|PATCH|DELETE)['"]/gi,
  },
  {
    concern: "smoke-read-only",
    fallback:
      "Write HTTP method in smoke suite. Smoke tests must remain read-only.",
    appliesTo: (p) => SMOKE_SPEC_RE.test(p),
    pattern: /\bmethod\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/gi,
  },
];
