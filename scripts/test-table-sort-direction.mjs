import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ariaSortForDirection } from "../cypress/support/commands/common/table.engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The bug: anything other than the exact string "asc" was treated as descending, so
// the aria token "ascending" and SQL "ASC" asserted the opposite order.
const inverted = (direction) =>
  direction === "asc" ? "ascending" : "descending";
assert.equal(
  inverted("ascending"),
  "descending",
  "sanity: the old ternary inverted the aria token 'ascending'",
);
assert.equal(
  inverted("ASC"),
  "descending",
  "sanity: the old ternary inverted SQL ASC",
);

assert.equal(ariaSortForDirection("asc"), "ascending");
assert.equal(ariaSortForDirection("ASC"), "ascending");
assert.equal(ariaSortForDirection("ascending"), "ascending");
assert.equal(ariaSortForDirection("Ascending"), "ascending");
assert.equal(ariaSortForDirection("desc"), "descending");
assert.equal(ariaSortForDirection("DESC"), "descending");
assert.equal(ariaSortForDirection("descending"), "descending");
assert.equal(ariaSortForDirection("Descending"), "descending");

assert.throws(
  () => ariaSortForDirection("none"),
  /must be "asc" or "desc"/,
  "unsorted / unknown tokens must fail loudly rather than default to descending",
);
assert.throws(() => ariaSortForDirection(undefined), /must be "asc" or "desc"/);
assert.throws(() => ariaSortForDirection(""), /must be "asc" or "desc"/);

const commands = fs.readFileSync(
  path.join(
    root,
    "cypress",
    "support",
    "commands",
    "common",
    "table.commands.js",
  ),
  "utf8",
);
assert.match(
  commands,
  /ariaSortForDirection\(direction\)/,
  "assertTableColumnSorted must use the shared direction mapper",
);
assert.doesNotMatch(
  commands,
  /direction\s*===\s*["']asc["']\s*\?\s*["']ascending["']\s*:\s*["']descending["']/,
  "the inverted ternary must not remain in the command",
);

console.log(
  "[table-sort-direction] asc/ascending map to aria-sort=ascending; unknown tokens throw.",
);
