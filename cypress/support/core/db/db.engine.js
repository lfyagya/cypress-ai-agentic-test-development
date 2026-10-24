/**
 * @fileoverview Datastore engine — the contract between a spec and the project's driver.
 *
 * Consumed by db.commands.js. Holds no driver and opens no connection: it validates the query entry
 * before it crosses into Node, so a malformed entry fails in the spec with a useful message rather
 * than inside a task with a driver stack trace.
 */

/** The single task name a project must register in `cypress.config.js`. */
export const DB_TASK = "db:query";

const PARAM_RE = /:(\w+)/g;

export function assertQueryEntry(entry) {
  if (!entry?.name || !entry?.sql) {
    throw new Error(
      "dbQuery requires a query entry with `name` and `sql` from cypress/configs/db/**. " +
        "Passing raw SQL is refused by the no-sql-literal rule.",
    );
  }
  if (typeof entry.mutates !== "boolean") {
    throw new Error(
      `query "${entry.name}" must declare mutates: true|false — a reviewer should see write ` +
        "capability without reading the SQL.",
    );
  }
}

/**
 * Named parameters the SQL expects. Used by a project's task to bind in the driver's own style
 * (`$1` for pg, `?` for mysql2, `@name` for mssql) without every caller learning that style.
 *
 * Interpolation is never the fallback: an unbound parameter must fail, because building a query by
 * concatenation turns a verification test into an injection vector against the database it checks.
 */
export function parameterNames(sql) {
  return [...new Set([...String(sql).matchAll(PARAM_RE)].map((m) => m[1]))];
}

export function assertParamsSatisfied(entry, params) {
  const missing = parameterNames(entry.sql).filter(
    (name) => !Object.prototype.hasOwnProperty.call(params ?? {}, name),
  );
  if (missing.length > 0) {
    throw new Error(
      `query "${entry.name}" is missing bound parameter(s): ${missing.join(", ")}`,
    );
  }
}

function renderAggregate(value) {
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * COUNT/SUM cells must be a real number. Drivers disagree on type (pg bigint as
 * a string, mysql2/mssql as a number), so the command normalises — but
 * `Number(null)` and `Number("")` are 0, which would make a SUM over zero rows
 * look like a real zero total and green the assertion.
 */
export function normalizeAggregate(value, queryName) {
  const label = queryName || "aggregate";
  if (value == null || value === "" || typeof value === "boolean") {
    throw new Error(
      `${label} returned a non-numeric aggregate: ${renderAggregate(value)}`,
    );
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(
      `${label} returned a non-numeric aggregate: ${renderAggregate(value)}`,
    );
  }
  return numeric;
}
