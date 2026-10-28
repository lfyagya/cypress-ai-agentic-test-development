import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInterceptAlias } from "../cypress/support/core/api/api.engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = fs.readFileSync(
  path.join(root, "cypress", "support", "core", "api", "api.engine.js"),
  "utf8",
);

assert.match(
  engine,
  /const alias = resolveInterceptAlias\(apiEntryOrAlias\)/,
  "waitForAPI must resolve documented @alias strings before cy.wait",
);
assert.match(
  engine,
  /entries\.map\(\(e\) => resolveInterceptAlias\(e\)\)/,
  "waitForAPIs must resolve documented @alias strings before cy.wait",
);
assert.match(
  engine,
  /cy\.wait\(`@\$\{alias\}`/,
  "waitForAPI must wait on a single @ plus the resolved name",
);

// Documented API-layer shape: cy.apiWait("@paymentsList") after .as("paymentsList").
assert.equal(
  resolveInterceptAlias("@paymentsList"),
  "paymentsList",
  "documented @alias must not become @@alias",
);
assert.equal(resolveInterceptAlias("paymentsList"), "paymentsList");
assert.equal(
  resolveInterceptAlias({ alias: "productsList" }),
  "productsList",
  "API config entries already store the bare alias",
);
assert.equal(resolveInterceptAlias("@@paymentsList"), "paymentsList");

assert.throws(
  () => resolveInterceptAlias(""),
  /apiWait requires an intercept alias/,
);
assert.throws(
  () => resolveInterceptAlias("@"),
  /apiWait requires an intercept alias/,
);
assert.throws(
  () => resolveInterceptAlias({ method: "GET" }),
  /apiWait requires an intercept alias/,
);

console.log(
  "[api-wait-alias] documented @alias strings resolve to a single Cypress alias.",
);
