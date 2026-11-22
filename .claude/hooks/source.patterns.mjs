/**
 * L2 — the engine's own adapter for product code (dev lanes). Language-neutral on purpose: the
 * project's lint, type-check and test commands are its standard (wiring.verifyScript, run by the git
 * gate and CI); these rules add only what those tools cannot be trusted to enforce on their own —
 * secrets, focused or unrecorded-skipped tests, silent suppressions, leftover breakpoints and
 * ticketless TODOs — across every language a team writes.
 *
 * Roots come from the composed config (project.sourceRoot, project.testRoot). A missing or absent
 * root throws: a scanner whose scope matches nothing reports a clean tree on a file that violates
 * every rule.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeRegex } from "./rule-engine.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function sourceRoots() {
  let project;
  try {
    project = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "harness.config.json"), "utf8"),
    ).project;
  } catch (error) {
    throw new Error(
      `cannot read project roots from harness.config.json: ${error.message}`,
      { cause: error },
    );
  }
  const roots = ["sourceRoot", "testRoot"].map((key) => {
    const root = project?.[key];
    if (!root || !fs.existsSync(path.join(repoRoot, root))) {
      throw new Error(
        `harness.config.json project.${key} is "${root}", which does not exist. The source rules ` +
          `are scoped to it, so scanning would silently match nothing.`,
      );
    }
    return root.replace(/\\/g, "/").replace(/\/+$/, "");
  });
  return { sourceRoot: roots[0], testRoot: roots[1] };
}

const { sourceRoot, testRoot } = sourceRoots();
const EXT = "(?:m|c)?[jt]sx?|py|java|kts?|go|rb|cs|php|scala|swift|rs|groovy";
const UNDER = (root) => (root === "." ? "" : `${escapeRegex(root)}/`);

export const targetFileRe = new RegExp(
  `^(?:${UNDER(sourceRoot)}|${UNDER(testRoot)}).*\\.(?:${EXT})$`,
  "i",
);

const isTestFile = (file) =>
  (testRoot !== "." && file.startsWith(`${testRoot}/`)) ||
  /(?:^|\/)(?:test_[^/]+|[^/]+_test\.[a-z]+|[^/]+\.(?:test|spec)\.[a-z]+|[^/]+Tests?\.(?:java|kt|cs))$/i.test(
    file,
  );

// A value that is plainly not a secret: a placeholder, an interpolation, or an env lookup.
const PLACEHOLDER =
  /^(?:<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|x+|\*+|changeme|redacted|example|dummy)$/i;
const TICKET = String.raw`\b[A-Z][A-Z0-9]+-\d+\b`;

export const rules = [
  {
    ruleId: "no-hardcoded-secret",
    fallback:
      "Hardcoded secret. Read it from the environment or the secret store.",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{6,})["']/gi,
    messageBuilder: (match, { message }) =>
      match[1] && PLACEHOLDER.test(match[1]) ? null : message,
  },
  {
    ruleId: "no-focused-test",
    fallback:
      "Focused test. Remove .only / fit / fdescribe so the whole suite runs.",
    appliesTo: isTestFile,
    pattern:
      /\b(?:describe|context|it|test)\.only\s*\(|\bf(?:it|describe)\s*\(|@pytest\.mark\.only\b/g,
  },
  {
    ruleId: "no-unrecorded-skip",
    fallback:
      "Skipped test with no recorded quarantine. Name the ticket on the same line, or give the reason the framework records.",
    appliesTo: isTestFile,
    pattern: new RegExp(
      String.raw`(?:\b(?:describe|context|it|test)\.skip\s*\(|\bx(?:it|describe)\s*\()(?![^\n]*${TICKET})|@pytest\.mark\.skip\b(?!\s*\(\s*reason\s*=)|@(?:Disabled|Ignore)\b(?!\s*\(\s*")`,
      "g",
    ),
  },
  {
    ruleId: "no-silent-suppression",
    fallback:
      "Suppression without a reason. Fix the finding, or state why on the same line (eslint: `-- reason`; TS: @ts-expect-error -- reason; Python: noqa: CODE / type: ignore[code]).",
    pattern:
      /eslint-disable(?:-next-line|-line)?\b(?![^\n]*--\s*\S)|@ts-(?:ignore|nocheck)\b|#\s*noqa\b(?!:)|#\s*type:\s*ignore\b(?!\[)|\/\/\s*nolint\b(?!:)/g,
  },
  {
    ruleId: "no-debugger",
    fallback: "Leftover breakpoint. Remove it before committing.",
    pattern:
      /^[ \t]*debugger[ \t]*;?[ \t]*$|\bi?pdb\.set_trace\s*\(|^[ \t]*breakpoint\s*\(\s*\)|\bbinding\.pry\b/gm,
  },
  {
    ruleId: "todo-needs-ticket",
    fallback:
      "TODO/FIXME without a ticket. Name the ticket (e.g. TODO(ABC-123): ...) or do it now.",
    pattern: new RegExp(
      String.raw`\b(?:TODO|FIXME|XXX|HACK)\b(?![^\n]*${TICKET})`,
      "g",
    ),
  },
];
