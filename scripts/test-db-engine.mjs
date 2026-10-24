import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "cypress", "support", "core", "db", "db.engine.js"),
  "utf8",
);
const { normalizeAggregate } = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
);

assert.equal(normalizeAggregate(6, "orders.countLines"), 6);
assert.equal(normalizeAggregate(0, "orders.countLines"), 0);
assert.equal(normalizeAggregate("12", "orders.countLines"), 12);
assert.equal(normalizeAggregate(3n, "orders.countLines"), 3);

for (const value of [null, undefined, "", false, true, "not-a-number", NaN]) {
  assert.throws(
    () => normalizeAggregate(value, "orders.sumLineTotals"),
    /non-numeric aggregate/,
    `Number(${JSON.stringify(value)}) must not become a silent zero/NaN total`,
  );
}

// The documented SUM template returns NULL when no rows match. Number(null) is 0.
assert.equal(
  Number(null),
  0,
  "sanity: the coercion under test is still a JS fact",
);
assert.throws(
  () => normalizeAggregate(null, "orders.sumLineTotals"),
  /orders\.sumLineTotals returned a non-numeric aggregate: null/,
  "SUM over zero rows must fail rather than report 0",
);

const command = fs.readFileSync(
  path.join(root, "cypress", "support", "core", "db", "db.commands.js"),
  "utf8",
);
assert.match(
  command,
  /normalizeAggregate\(/,
  "cy.dbCount must use normalizeAggregate so Number(null) cannot green a SUM",
);
assert.doesNotMatch(
  command,
  /Number\.isFinite\(numeric\)/,
  "the finite-only check is what treated Number(null) as a real 0",
);

console.log(
  "[cypress:db-engine] NULL/empty aggregates fail instead of becoming 0",
);
