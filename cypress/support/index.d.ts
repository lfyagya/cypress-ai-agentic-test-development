// Type declarations for this repo's custom Cypress commands.
//
// Without this file a TypeScript spec gets no types for cy.ensureAuthenticated(), cy.apiWait() and
// the rest — every call is an error, and the usual "fix" is a cast or a ts-ignore that discards the
// safety TypeScript was adopted for. Signatures here mirror cypress/support/commands/**; keep them
// in step when a command's arguments change.
//
// Applies to .cy.js as well: editors read this for IntelliSense even in JavaScript.

/// <reference types="cypress" />

/** One entry in an API config object under cypress/configs/api/**. */
interface ApiEntry {
  method: string;
  url: string;
  alias?: string;
  statusCode?: number;
  [key: string]: unknown;
}

/** A stubbed response body, or a full StaticResponse when headers or status matter. */
type StubResponse = Record<string, unknown> | Cypress.StaticResponse;

declare namespace Cypress {
  interface Chainable<Subject = any> {
    // --- Authentication -------------------------------------------------------------------------
    /**
     * Establishes an authenticated session, reusing a cached one when available.
     * Call in `beforeEach()`. Required by the `require-auth-command` rule for any auth-backed spec
     * unless the file carries the `// @no-ensureAuthenticated` pragma.
     */
    ensureAuthenticated(): Chainable<void>;

    // --- Navigation -----------------------------------------------------------------------------
    /** Visits a route from `cypress/configs/app/routes.js`. Never pass a URL literal. */
    navigateTo(path: string): Chainable<void>;
    /** Asserts the current pathname equals a configured route. */
    assertCurrentPath(path: string): Chainable<void>;

    // --- Products -------------------------------------------------------------------------------
    /** Opens the All Products listing route from `cypress/configs/app/routes.js`. */
    visitProducts(): Chainable<void>;
    /**
     * Asserts the All Products heading is visible and the listing card grid holds at least
     * `minCount` product cards (default 1) with a non-empty product name.
     */
    assertProductsListingVisible(minCount?: number): Chainable<void>;

    // --- Elements -------------------------------------------------------------------------------
    /** Resolves an element by its test attribute. Prefer a UI config constant for the id. */
    getByTestId(
      testId: string,
      ...args: Parameters<Chainable<Subject>["get"]>[1][]
    ): Chainable<JQuery<HTMLElement>>;
    /** Asserts the chained subject is visible. Child command — requires a prior subject. */
    ensureVisible(): Chainable<Subject>;

    // --- Tables ---------------------------------------------------------------------------------
    /** Returns the first body row whose text contains `text`. */
    getTableRowByText(
      tableSelector: string,
      text: string,
    ): Chainable<JQuery<HTMLElement>>;
    /** Asserts the table has at least `minCount` body rows. Defaults to 1. */
    assertTableHasRows(
      tableSelector: string,
      minCount?: number,
    ): Chainable<void>;

    // --- API ------------------------------------------------------------------------------------
    /** Registers an intercept for one API config entry, optionally stubbing the response. */
    apiIntercept(
      apiEntry: ApiEntry,
      stub?: StubResponse | null,
    ): Chainable<void>;
    /** Registers intercepts for every entry in an API config object. */
    apiInterceptAll(
      apiConfig: Record<string, ApiEntry>,
      options?: Record<string, unknown>,
    ): Chainable<void>;
    /** Issues a real request for one API config entry. */
    apiRequest(
      apiEntry: ApiEntry,
      body?: unknown,
      options?: Partial<Cypress.RequestOptions>,
    ): Chainable<Cypress.Response<unknown>>;
    /** Registers an intercept that always returns the supplied stub. */
    apiStub(
      apiEntry: ApiEntry,
      response?: StubResponse,
      options?: Record<string, unknown>,
    ): Chainable<void>;
    /**
     * Waits for an intercepted call by entry or `@alias`.
     * This is the replacement for `cy.wait(<number>)`, which the `no-hard-wait` rule blocks.
     */
    apiWait(
      apiEntryOrAlias: ApiEntry | string,
      options?: Record<string, unknown>,
    ): Chainable<Cypress.Interception>;
    /** Waits for several intercepted calls. */
    apiWaitAll(
      entries: Array<ApiEntry | string>,
      options?: Record<string, unknown>,
    ): Chainable<Cypress.Interception[]>;
    /** Validates a payload against a schema validator from `cypress/schemas/**`. */
    validateSchema(data: unknown, validator: unknown): Chainable<void>;

    // --- Products module ------------------------------------------------------------------------
    /**
     * Issues the read-only Automation Exercise product catalog request from the products API config.
     * Resolves with the raw Cypress response so the spec can assert status and body.
     */
    requestProductCatalog(): Chainable<Cypress.Response<unknown>>;

    // --- Reporting ------------------------------------------------------------------------------
    /** Emits a labelled step into the command log. */
    step(message: string): Chainable<void>;

    /**
     * Reads environment values. Declared so a TypeScript spec can pass an array of keys, which is
     * how the `no-credential-literal` rule expects credentials to be sourced.
     */
    env(keys: string[]): Record<string, string>;
  }
}
