/**
 * @fileoverview Core API Commands
 * Registers Cypress commands that wrap the API engine.
 *
 * Available commands:
 *   cy.apiIntercept(entry, stub?)    — Register one intercept
 *   cy.apiInterceptAll(config, opts) — Register all intercepts from config
 *   cy.apiWait(entry, opts)          — Wait + validate status
 *   cy.apiWaitAll(entries, opts)     — Wait multiple
 *   cy.apiRequest(entry, body, opts) — Direct cy.request() call
 *   cy.apiStub(entry, response, opts)— Stub a response
 *   cy.validateSchema(data, schema)  — Validate response against schema
 */

import {
  registerIntercept,
  registerAllIntercepts,
  waitForAPI,
  waitForAPIs,
  makeRequest,
  stubResponse,
  assertSmokeReadOnlyRequest,
} from "./api.engine.js";

import "./schema.commands.js";

Cypress.Commands.add("apiIntercept", (apiEntry, stub = null) => {
  registerIntercept(apiEntry, stub);
});

Cypress.Commands.add("apiInterceptAll", (apiConfig, options = {}) => {
  registerAllIntercepts(apiConfig, options);
});

Cypress.Commands.add("apiWait", (apiEntryOrAlias, options = {}) => {
  return waitForAPI(apiEntryOrAlias, options);
});

Cypress.Commands.add("apiWaitAll", (entries, options = {}) => {
  return waitForAPIs(entries, options);
});

Cypress.Commands.add("apiRequest", (apiEntry, body = null, options = {}) => {
  // `method` lives in cypress/configs/api/**, which the write-time smoke-read-only grep cannot see.
  assertSmokeReadOnlyRequest(apiEntry, Cypress.spec?.relative);
  return makeRequest(apiEntry, body, options);
});

Cypress.Commands.add("apiStub", (apiEntry, response = {}, options = {}) => {
  return stubResponse(apiEntry, response, options);
});
