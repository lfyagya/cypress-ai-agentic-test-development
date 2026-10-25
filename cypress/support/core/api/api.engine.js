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

/** HTTP methods the smoke-read-only rule forbids. Matched case-insensitively. */
export const WRITE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Smoke specs must not issue write requests. `smoke-read-only` only greps literals in the spec
 * file (`cy.request("POST", …)` or `method: "DELETE"`), so a correctly-architected call
 * (`cy.apiRequest(ORDERS_API.CANCEL)` with the method in `cypress/configs/api/**`) would
 * otherwise reach the network and mutate a shared environment.
 */
export function isSmokeSpec(specRelativePath) {
  return String(specRelativePath ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .includes("smoke");
}

export function assertSmokeReadOnlyRequest(apiEntry, specRelativePath) {
  const method = String(apiEntry?.method ?? "").toUpperCase();
  if (!WRITE_METHODS.includes(method)) return;
  if (!isSmokeSpec(specRelativePath)) return;
  throw new Error(
    `API "${apiEntry.alias ?? apiEntry.endpoint ?? method}" uses ${method} and cannot run in a smoke spec. ` +
      "Smoke tests must remain read-only; move the write to the e2e tier.",
  );
}

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
 * Wait for a single API call and optionally assert its status code.
 */
export function waitForAPI(apiEntryOrAlias, options = {}) {
  const alias =
    typeof apiEntryOrAlias === "string"
      ? apiEntryOrAlias
      : apiEntryOrAlias.alias;
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
  const aliases = entries.map((e) => (typeof e === "string" ? e : e.alias));
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
