import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WRITE_METHODS,
  assertSmokeReadOnlyRequest,
  isSmokeSpec,
} from "../cypress/support/core/api/api.engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = fs.readFileSync(
  path.join(root, "cypress", "support", "core", "api", "api.commands.js"),
  "utf8",
);
assert.match(
  command,
  /assertSmokeReadOnlyRequest\(\s*apiEntry,\s*Cypress\.spec\?\.relative\s*\)/,
  "cy.apiRequest must refuse write methods when the spec is under smoke/",
);

const write = {
  method: "DELETE",
  endpoint: "/api/orders/1",
  alias: "cancelOrder",
};
const post = {
  method: "POST",
  endpoint: "https://automationexercise.com/api/searchProduct",
  alias: "searchProduct",
};
const read = {
  method: "GET",
  endpoint: "https://automationexercise.com/api/productsList",
  alias: "productsList",
};

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

assert.deepEqual(WRITE_METHODS, ["POST", "PUT", "PATCH", "DELETE"]);

assert.throws(
  () =>
    assertSmokeReadOnlyRequest(
      write,
      "cypress/tests/orders/smoke/orders-listing.cy.js",
    ),
  /uses DELETE and cannot run in a smoke spec/,
);
assert.throws(
  () =>
    assertSmokeReadOnlyRequest(
      { ...post, method: "post" },
      "cypress/tests/products/smoke/products-search.cy.js",
    ),
  /uses POST and cannot run in a smoke spec/,
  "method matching is case-insensitive",
);
assert.doesNotThrow(() =>
  assertSmokeReadOnlyRequest(
    read,
    "cypress/tests/products/smoke/products-smoke.cy.js",
  ),
);
assert.doesNotThrow(() =>
  assertSmokeReadOnlyRequest(
    write,
    "cypress/tests/orders/e2e/orders-cleanup.cy.js",
  ),
);
assert.doesNotThrow(() => assertSmokeReadOnlyRequest(write, undefined));

console.log("[api-smoke-readonly] write methods are refused in smoke specs.");
