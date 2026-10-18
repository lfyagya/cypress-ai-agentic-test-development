/**
 * @fileoverview Datastore engine — the contract between a spec and the project's driver.
 *
 * Consumed by db.commands.js. Holds no driver and opens no connection: it validates the query entry
 * before it crosses into Node, so a malformed entry fails in the spec with a useful message rather
 * than inside a task with a driver stack trace.
 */

/** The single task name a project must register in `cypress.config.js`. */
export const DB_TASK = "db:query";

// Named `:params`, but not PostgreSQL `::casts` and not colons inside quoted literals.
// `/:(\w+)/g` treated `COUNT(*)::int` and `'12:30:00'` as bind placeholders. The README tells a
// project's `db:query` task to rewrite whatever this function returns (`:id` → `$1` / `?` / `@id`),
// so those false names became real substitutions and destroyed the SQL the test was meant to check.
const PARAM_TOKEN_RE = /'(?:[^']|'')*'|:(:)?(\w+)/g;

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
  const names = [];
  const token = new RegExp(PARAM_TOKEN_RE.source, PARAM_TOKEN_RE.flags);
  let match;
  while ((match = token.exec(String(sql))) !== null) {
    if (match[0].startsWith("'") || match[1]) continue;
    names.push(match[2]);
  }
  return [...new Set(names)];
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
