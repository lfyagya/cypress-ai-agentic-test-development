/**
 * L1 rule engine. Framework-neutral mechanism only — path normalisation, message
 * resolution, violation accumulation, and the scan driver. It contains no framework
 * patterns and no architecture opinion.
 *
 * Each adapter supplies a patterns module (L2) with its own `targetFileRe` and rule
 * table. `shared-rules.mjs` in each boilerplate wires the two together and keeps the
 * export surface its hooks already depend on.
 *
 * Why a rule *table* rather than the inline sequence of scanForRegex calls this
 * replaces: the tier model in the conformance spec (§6.2) needs Tier 0/1/2 severity and
 * pattern-driven selection to be a filter over a list. Inline, the same feature is
 * control-flow surgery in two files that must be kept in step by hand.
 */

import fs from "node:fs";
import path from "node:path";

// Every rule matches on extension, so the extension list lives here once. A TypeScript spec that
// slips past this list silently loses every block-severity rule — identical code, zero violations —
// which is worse than TypeScript being unsupported, because it looks like it works. Both adapters
// previously had this same defect, each matching only its own default extension.
export const SCRIPT_EXT = String.raw`(?:m|c)?[jt]s`; // js, mjs, cjs, ts, mts, cts

export function toPosix(p) {
  return p.replaceAll("\\", "/");
}

/**
 * Every tool name that represents a write we must inspect.
 *
 * Claude and Copilot emit Write|Edit; Cursor emits Write|StrReplace. A tool missing from
 * this set is not "unsupported" — it is *unenforced*, and silently: the change is never
 * extracted, so every block rule passes on a file that violates all of them. That is the
 * same defect class as a rule declared `block` with no pattern behind it.
 *
 * The engine owns this list so a new tool is added once, for every adapter. Before P1b it
 * lived in each adapter, and the two had drifted: Playwright omitted `StrReplace`, so
 * Cursor users editing Playwright specs had no write-time enforcement at all.
 */
export const DEFAULT_WRITE_TOOLS = ["Write", "Edit", "StrReplace"];

/**
 * Builds `extractToolChange` for a set of write-tool names, defaulting to every tool the
 * engine knows about. An adapter should not narrow this without a recorded reason.
 */
export function makeExtractToolChange(writeToolNames = DEFAULT_WRITE_TOOLS) {
  const writeTools = new Set(writeToolNames);
  return function extractToolChange(
    toolData,
    repoRoot,
    { readCurrent = false } = {},
  ) {
    const toolName = toolData?.tool_name || toolData?.toolName || "";
    let toolInput = toolData?.tool_input || toolData?.toolArgs || {};
    if (typeof toolInput === "string") {
      try {
        toolInput = JSON.parse(toolInput);
      } catch {
        return { filePath: "", content: "" };
      }
    }

    const filePath =
      toolInput.file_path || toolInput.filePath || toolInput.path || "";
    if (!filePath || !writeTools.has(toolName)) {
      return { filePath: "", content: "" };
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(repoRoot, filePath);
    if (readCurrent && fs.existsSync(absolutePath)) {
      return { filePath, content: fs.readFileSync(absolutePath, "utf8") };
    }

    if (toolName === "Write") {
      return { filePath, content: toolInput.content || toolInput.text || "" };
    }

    const replacement =
      toolInput.new_string ||
      toolInput.newString ||
      toolInput.new_str ||
      toolInput.replacement ||
      toolInput.content ||
      "";
    const original =
      toolInput.old_string || toolInput.oldString || toolInput.old_str || "";
    if (replacement && original && fs.existsSync(absolutePath)) {
      const current = fs.readFileSync(absolutePath, "utf8");
      if (current.includes(original)) {
        return { filePath, content: current.replace(original, replacement) };
      }
    }
    return { filePath, content: replacement };
  };
}

export function loadAllowlist(allowlistPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
    return {
      selectors: new Set((raw.selectors || []).map((s) => String(s).trim())),
      routes: new Set((raw.routes || []).map((s) => String(s).trim())),
      endpoints: new Set((raw.endpoints || []).map((s) => String(s).trim())),
    };
  } catch {
    return {
      selectors: new Set(["body", "html"]),
      routes: new Set(["/"]),
      endpoints: new Set(),
    };
  }
}

export function loadRuleMessages(repoRoot) {
  try {
    return Object.fromEntries(
      JSON.parse(
        fs.readFileSync(path.join(repoRoot, "harness.config.json"), "utf8"),
      ).rules.map((rule) => [rule.id, rule.message]),
    );
  } catch {
    return {};
  }
}

export function isAllowedLiteral(value, allowSet, ignoreCase = false) {
  const literal = String(value || "").trim();
  if (!literal) return false;
  if (allowSet.has(literal)) return true;
  if (!ignoreCase) return false;
  const lower = literal.toLowerCase();
  for (const allowed of allowSet) {
    if (String(allowed).toLowerCase() === lower) return true;
  }
  return false;
}

export function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

/**
 * Returns one balanced object literal beginning at `start`.
 *
 * Test options can contain nested objects (`retries: { runMode: 1 }`). A non-greedy regex stops at
 * the first closing brace and can miss a later `tags` field, turning valid tests into false
 * positives. This scanner tracks nested braces and quoted strings instead.
 */
export function extractBalancedObject(text, start) {
  if (text[start] !== "{") return "";
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

export function scanForRegex(
  violations,
  filePath,
  text,
  regex,
  messageBuilder,
) {
  // Clone so a table-defined regex cannot carry lastIndex between files. Draining the
  // loop resets it in practice, but a shared stateful regex is a bug waiting for the
  // first early return, and the clone costs nothing.
  const re = new RegExp(regex.source, regex.flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    const lineNumber = lineNumberForIndex(text, match.index);
    const message =
      typeof messageBuilder === "function"
        ? messageBuilder(match)
        : messageBuilder;
    if (!message) continue;
    violations.push({ filePath, lineNumber, message });
  }
}

/**
 * Builds the scanner from an adapter's rule table.
 *
 * A rule is either pattern-driven or structural:
 *   { concern, fallback, appliesTo?, pattern, messageBuilder? }   regex scan
 *   { concern, fallback, appliesTo?, check }                      arbitrary detection
 *
 * `check` exists because some rules are not expressible as one regex — a requirement-tag
 * audit walks every test call and its options object. The adapter owns that detection;
 * the engine still owns path scope, message resolution and accumulation.
 *
 * Rule order is preserved from the table, because it is the order violations are reported
 * to the developer.
 */
export function makeScanner({ targetFileRe, rules }) {
  return function scanContent(filePath, content, allowlist, repoRoot) {
    const violations = [];
    const messages = loadRuleMessages(repoRoot);
    // The tool may hand us a repo-relative path. Node would resolve that against cwd, which is
    // not necessarily the repo root — from a foreign cwd that yields a mangled path, and the
    // file-type regex below can miss it, silently skipping every rule. Anchor to repoRoot.
    const absolute = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(repoRoot, filePath);
    const normalized = toPosix(path.relative(repoRoot, absolute));

    if (!targetFileRe.test(normalized)) return violations;

    for (const rule of rules) {
      if (rule.appliesTo && !rule.appliesTo(normalized)) continue;
      const message = messages[rule.concern] || rule.fallback;

      if (rule.check) {
        rule.check({
          filePath: normalized,
          content,
          allowlist,
          repoRoot,
          message,
          push: (lineNumber, override) =>
            violations.push({
              filePath: normalized,
              lineNumber,
              message: override ?? message,
            }),
        });
        continue;
      }

      scanForRegex(
        violations,
        normalized,
        content,
        rule.pattern,
        rule.messageBuilder
          ? (match) => rule.messageBuilder(match, { message, allowlist })
          : message,
      );
    }

    return violations;
  };
}
