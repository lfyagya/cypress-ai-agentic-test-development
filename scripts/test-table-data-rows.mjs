import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ui = fs.readFileSync(
  path.join(root, "cypress", "configs", "ui", "shared", "table.ui.js"),
  "utf8",
);
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
  ui,
  /dataRow:\s*["']tbody tr/,
  "TABLE_UI.dataRow must start from tbody so a header-only table is empty",
);
assert.doesNotMatch(
  ui,
  /dataRow:\s*["']tr,/,
  "a bare tr selector also matches thead and greens an empty table",
);

assert.match(
  commands,
  /TABLE_UI\.dataRow/,
  "table commands must use the shared data-row selector",
);
assert.equal(
  (commands.match(/TABLE_UI\.dataRow/g) || []).length,
  3,
  "assertTableHasRows, assertTableEmpty, and getTableRowByText must all use TABLE_UI.dataRow",
);
assert.doesNotMatch(
  commands,
  /['"]tr,\s*\[data-cy\$=["']-table-row["']\]/,
  "the old header-including selector must not remain in table commands",
);

console.log(
  "[table-data-rows] table helpers count tbody rows, not thead headers.",
);
