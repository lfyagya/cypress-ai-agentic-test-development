// Shared CLI helpers for the scripts/ tools.
//
// Extracted because three scripts had grown their own copy of the same argument parser and JSON
// readers. Four copies of a parser means four places to fix a parsing bug, and the copies had already
// started to differ: evidence.mjs paired tokens strictly by position and could not express a boolean
// flag, which is why --dry-run needed a different parser somewhere else.
//
// node:util.parseArgs (available on the supported Node 22 runtime) would be the stdlib answer and
// is deliberately not used here: it
// requires every option declared up front and, in strict mode, rejects unknown flags. These tools
// intentionally take loose `--key value` input and are invoked by agents and CI as well as humans, so
// a permissive parser with validation at the point of use is the better fit. Revisit if the flag
// surface ever needs real typing.

import fs from "node:fs";

/**
 * Parses `--key value` and bare `--flag` (as `true`).
 * Superset of what every previous copy did.
 */
export function parseArgs(tokens) {
  const args = {};
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i].startsWith("--")) continue;
    const key = tokens[i].slice(2);
    const next = tokens[i + 1];
    // Empty string is an explicit value (GitHub Actions `--id "${{ inputs.task_id }}"`
    // expands to `--id ""` when the input is unset). Treating it as missing used to
    // set the flag to `true`, so callers looked up `evidence/tasks/true.json`.
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Reads JSONL, returning [] for a missing file. Throws with the line number on malformed JSON. */
export function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${file}:${index + 1} is not valid JSON`);
      }
    });
}
