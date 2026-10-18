import assert from "node:assert/strict";
import {
  assertParamsSatisfied,
  assertQueryEntry,
  parameterNames,
} from "../cypress/support/core/db/db.engine.js";

const entry = (sql) => ({ name: "orders.probe", sql, mutates: false });

assert.deepEqual(parameterNames("SELECT id FROM orders WHERE id = :id"), [
  "id",
]);
assert.deepEqual(
  parameterNames(
    "SELECT id, status FROM orders WHERE customer_id = :customerId AND status = :status",
  ),
  ["customerId", "status"],
);
assert.deepEqual(
  parameterNames("SELECT id FROM orders WHERE id = :id OR parent_id = :id"),
  ["id"],
  "the same name is bound once",
);

// PostgreSQL casts are the documented driver. A `/:(\w+)/g` scan reads `::int` as `:int`.
const withCast =
  "SELECT COUNT(*)::int AS n FROM orders WHERE id = :id AND created_at::date = CURRENT_DATE";
assert.deepEqual(parameterNames(withCast), ["id"]);
assert.doesNotThrow(() => assertParamsSatisfied(entry(withCast), { id: 7 }));
assert.throws(
  () => assertParamsSatisfied(entry(withCast), {}),
  /missing bound parameter\(s\): id/,
);

// The README's rewrite (`:id` → `$1`) must leave casts intact. Replacing every `:${name}`
// from the old extractor turned `::int` into `:$1` and `::date` into `:$2`.
let rewritten = withCast;
for (const [index, name] of parameterNames(withCast).entries()) {
  rewritten = rewritten.replaceAll(`:${name}`, `$${index + 1}`);
}
assert.equal(
  rewritten,
  "SELECT COUNT(*)::int AS n FROM orders WHERE id = $1 AND created_at::date = CURRENT_DATE",
);

assert.deepEqual(
  parameterNames(
    "SELECT id FROM orders WHERE created_at > '2026-01-01 12:30:00' AND id = :id",
  ),
  ["id"],
  "time literals are not bind parameters",
);
assert.deepEqual(
  parameterNames(
    "SELECT id FROM orders WHERE note = 'see :notAParam' AND id = :id",
  ),
  ["id"],
  "a colon inside a quoted string is not a bind parameter",
);
assert.deepEqual(
  parameterNames(
    "SELECT id FROM orders WHERE note = 'it''s :notAParam' AND id = :id",
  ),
  ["id"],
  "SQL escaped quotes do not reopen the string",
);

assert.throws(
  () => assertQueryEntry({ name: "x", sql: "SELECT 1" }),
  /mutates/,
);
assert.throws(
  () => assertQueryEntry({ sql: "SELECT 1", mutates: false }),
  /name/,
);

console.log("[db-engine:test] named-parameter extraction passed.");
