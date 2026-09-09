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
