import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestUrlFromEndpoint } from "../cypress/support/core/api/api.engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = fs.readFileSync(
  path.join(root, "cypress", "support", "core", "api", "api.engine.js"),
  "utf8",
);
assert.match(
  engine,
  /url:\s*requestUrlFromEndpoint\(\s*apiEntry\.endpoint\s*\)/,
  "makeRequest must resolve intercept globs through requestUrlFromEndpoint",
);

// Documented API-layer shape: leading **/ plus a trailing ** on the path.
assert.equal(
  requestUrlFromEndpoint("**/api/payments**"),
  "api/payments",
  "documented intercept glob must resolve to the path, not an empty URL",
);
assert.equal(requestUrlFromEndpoint("**/api/payments/**"), "api/payments/");
assert.equal(requestUrlFromEndpoint("/api/products/*"), "/api/products/");
assert.equal(
  requestUrlFromEndpoint("https://automationexercise.com/api/productsList"),
  "https://automationexercise.com/api/productsList",
  "absolute catalog URLs must be unchanged",
);

assert.throws(
  () => requestUrlFromEndpoint("**"),
  /intercept glob/,
  "a glob that strips to nothing must be refused, not sent as url:''",
);
assert.throws(() => requestUrlFromEndpoint(""), /non-empty endpoint/);
assert.throws(() => requestUrlFromEndpoint(undefined), /non-empty endpoint/);

console.log(
  "[api-request-url] intercept globs resolve to a concrete request URL.",
);
