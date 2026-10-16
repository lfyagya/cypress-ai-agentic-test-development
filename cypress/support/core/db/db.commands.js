/**
 * @fileoverview Datastore commands — the L4 access layer.
 *
 * Available commands:
 *   cy.dbQuery(entry, params)      — run a query from cypress/configs/db/** and yield its rows
 *   cy.dbRow(entry, params)        — the single row a query must return; fails on 0 or 2+
 *   cy.dbCount(entry, params)      — the single numeric value a COUNT/SUM query must return
 *
 * Why a task and not a client here: a Cypress test runs in the browser, which cannot open a database
 * socket. Every query crosses into Node through `cy.task`, and the driver is registered once in
 * `cypress.config.js` — see README.md in this directory. That indirection is Cypress-specific; the
 * Playwright adapter calls its driver directly from the test process because it already runs in Node.
 *
 * The driver itself is deliberately not shipped. `profile.datastore.driver` says which one the
 * project uses, and a harness that picked for you would be wrong for every project that picked
 * differently.
 */
import {
  DB_TASK,
  assertParamsSatisfied,
  assertQueryEntry,
} from "./db.engine.js";

Cypress.Commands.add("dbQuery", (entry, params = {}) => {
  assertQueryEntry(entry);
  // Fail here rather than in the driver. An unbound parameter reaches most drivers as a null and
  // the query returns zero rows — a green test that proved nothing.
  assertParamsSatisfied(entry, params);
  return cy.task(DB_TASK, { name: entry.name, sql: entry.sql, params });
});

Cypress.Commands.add("dbRow", (entry, params = {}) => {
  return cy.dbQuery(entry, params).then((rows) => {
    // A query that silently returns nothing is the most common false pass at this layer: the
    // assertion never runs and the test goes green having proved the row's absence.
    expect(rows, `${entry.name} rows`).to.be.an("array");
    expect(
      rows.length,
      `${entry.name} must match exactly one row (matched ${rows.length})`,
    ).to.eq(1);
    return rows[0];
  });
});

Cypress.Commands.add("dbCount", (entry, params = {}) => {
  return cy.dbRow(entry, params).then((row) => {
    const values = Object.values(row);
    expect(
      values.length,
      `${entry.name} must select exactly one aggregate column`,
    ).to.eq(1);
    const value = values[0];
    // Drivers disagree about the type of COUNT/SUM: node-postgres returns bigint as a string,
    // mysql2 returns a number, mssql returns a number. Normalise here rather than in every test,
    // and reject anything that is not actually numeric instead of coercing NaN into an assertion.
    const numeric = typeof value === "bigint" ? Number(value) : Number(value);
    expect(
      Number.isFinite(numeric),
      `${entry.name} returned a non-numeric aggregate: ${JSON.stringify(value)}`,
    ).to.be.true;
    return numeric;
  });
});
