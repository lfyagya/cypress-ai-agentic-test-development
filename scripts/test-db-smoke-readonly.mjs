import assert from "node:assert/strict";
import {
  assertSmokeReadOnly,
  isSmokeSpec,
} from "../cypress/support/core/db/db.engine.js";

const write = { name: "orders.deleteSynthetic", mutates: true };
const read = { name: "orders.findById", mutates: false };

assert.equal(
  isSmokeSpec("cypress/tests/orders/smoke/orders-listing.cy.js"),
  true,
);
assert.equal(
  isSmokeSpec("cypress\\tests\\orders\\smoke\\orders-listing.cy.js"),
  true,
  "Windows separators still identify the smoke tier",
);
assert.equal(
  isSmokeSpec("cypress/tests/orders/e2e/orders-cleanup.cy.js"),
  false,
);
assert.equal(
  isSmokeSpec("cypress/tests/orders/e2e/smoke-cleanup.cy.js"),
  false,
  "a filename that merely contains 'smoke' is not the smoke tier",
);
assert.equal(isSmokeSpec(""), false);
assert.equal(isSmokeSpec(undefined), false);

assert.throws(
  () =>
    assertSmokeReadOnly(
      write,
      "cypress/tests/orders/smoke/orders-listing.cy.js",
    ),
  /mutates: true and cannot run in a smoke spec/,
);
assert.doesNotThrow(() =>
  assertSmokeReadOnly(read, "cypress/tests/orders/smoke/orders-listing.cy.js"),
);
assert.doesNotThrow(() =>
  assertSmokeReadOnly(write, "cypress/tests/orders/e2e/orders-cleanup.cy.js"),
);
assert.doesNotThrow(() => assertSmokeReadOnly(write, undefined));

console.log("[db-smoke-readonly] mutating queries are refused in smoke specs.");
