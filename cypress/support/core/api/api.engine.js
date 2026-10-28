/**
 * @fileoverview Core API Engine
 *
 * Generic, reusable functions for:
 * - Registering cy.intercept() from config
 * - Waiting for API responses with status validation
 * - Making direct cy.request() calls
 * - Stubbing responses for isolated tests
 *
 * Consumed by api.commands.js — not used directly in tests.
 */

import { HTTP_STATUS } from "./status-codes.js";

export const API_TIMEOUT = Object.freeze({
  DEFAULT: 15000,
  LONG: 30000,
  SHORT: 5000,
});

export function getStatusCode(interception) {
  return interception.response?.statusCode ?? interception.response?.status;
}

/**
 * Register a single API intercept from a config entry.
 * Must be called BEFORE cy.visit() — Cypress official best practice.
 */
export function registerIntercept(apiEntry, stubResponse = null) {
  if (!apiEntry?.method || !apiEntry?.endpoint || !apiEntry?.alias) {
    throw new Error("API entry must have method, endpoint, and alias");
  }
  if (stubResponse) {
    return cy
      .intercept(apiEntry.method, apiEntry.endpoint, stubResponse)
      .as(apiEntry.alias);
  }
  return cy.intercept(apiEntry.method, apiEntry.endpoint).as(apiEntry.alias);
}

/**
 * Register all intercepts from a config object.
 */
export function registerAllIntercepts(apiConfig, options = {}) {
  const { stubs = {}, only = [], except = [] } = options;
  Object.entries(apiConfig).forEach(([, entry]) => {
    if (!entry?.method || !entry?.endpoint || !entry?.alias) return;
    if (only.length && !only.includes(entry.alias)) return;
    if (except.includes(entry.alias)) return;
    const stub = stubs[entry.alias] ?? null;
    registerIntercept(entry, stub);
  });
}

/**
 * Cypress registers intercepts with `.as("name")` and waits with `@name`.
 * The documented command is `cy.apiWait("@paymentsList")`. Prefixing another
 * `@` would wait for `@@paymentsList`, which was never registered, so every
 * documented wait times out.
 */
export function resolveInterceptAlias(apiEntryOrAlias) {
  const raw =
    typeof apiEntryOrAlias === "string"
      ? apiEntryOrAlias
      : apiEntryOrAlias?.alias;
  const alias = String(raw ?? "")
    .replace(/^@+/, "")
    .trim();
  if (!alias) {
    throw new Error(
      "apiWait requires an intercept alias or an API entry with `alias`",
    );
  }
  return alias;
}

/**
 * Wait for a single API call and optionally assert its status code.
 */
export function waitForAPI(apiEntryOrAlias, options = {}) {
  const alias = resolveInterceptAlias(apiEntryOrAlias);
  const expectedStatus =
    options.expectedStatus ??
    (typeof apiEntryOrAlias === "object"
      ? apiEntryOrAlias.expectedStatus
      : null);
  const assertStatus = options.assertStatus !== false;
  const timeout = options.timeout ?? API_TIMEOUT.DEFAULT;

  return cy.wait(`@${alias}`, { timeout }).then((interception) => {
    if (assertStatus && expectedStatus != null) {
      const actual = getStatusCode(interception);
      expect(actual, `${alias} status`).to.eq(expectedStatus);
    }
    return interception;
  });
}

/**
 * Wait for multiple APIs. Returns a map of alias → interception.
 */
export function waitForAPIs(entries, options = {}) {
  const aliases = entries.map((e) => resolveInterceptAlias(e));
  return cy.wait(
    aliases.map((a) => `@${a}`),
    { timeout: options.timeout ?? API_TIMEOUT.DEFAULT },
  );
}

/**
 * Direct cy.request() wrapper using an API config entry.
 */
export function makeRequest(apiEntry, body = null, options = {}) {
  const req = {
    method: apiEntry.method,
    url: apiEntry.endpoint.replace(/[*?].*$/, ""),
    failOnStatusCode: options.failOnStatusCode ?? false,
  };
  if (body) req.body = body;
  // `form: true` sends the body url-encoded; some endpoints reject a JSON body. `headers` lets a
  // caller set content negotiation explicitly. Both are opt-in and change nothing for existing callers.
  if (options.form) req.form = true;
  if (options.headers) req.headers = options.headers;
  return cy.request(req);
}

/**
 * Stub an API response with static data.
 */
export function stubResponse(apiEntry, response = {}, options = {}) {
  const stub = {
    statusCode: response.statusCode ?? HTTP_STATUS.OK,
    body: response.body ?? {},
    headers: response.headers ?? { "Content-Type": "application/json" },
    delay: options.delay ?? 0,
  };
  return cy
    .intercept(apiEntry.method, apiEntry.endpoint, stub)
    .as(apiEntry.alias);
}

/**
 * Assert response came within a time budget (skips gracefully for stubs).
 */
export function assertResponseTime(interception, maxMs, label = "") {
  const duration = interception.duration;
  if (duration == null) return; // Stub — skip timing check
  expect(
    duration,
    `${label || interception.request?.url} response time`,
  ).to.be.lessThan(maxMs);
}

/**
 * Assert response body has expected top-level fields.
 */
export function assertResponseFields(interception, fields = [], label = "") {
  const body = interception.response?.body;
  fields.forEach((field) => {
    expect(body, `${label || ""} body`).to.have.property(field);
  });
}
