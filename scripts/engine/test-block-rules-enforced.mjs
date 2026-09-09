#!/usr/bin/env node
// Every rule declared `severity: "block"` must actually fire on a violating sample.
//
// This exists because the Playwright adapter shipped `storage-state-auth` declared blocking with
// `enforcement: "Hook + CI"`, listed as blocking in the generated rule tables, and with no pattern
// behind it — a spec with login() in beforeEach() passed the validator clean. A rule that is declared
// and never fires is worse than an absent rule: the instruction tables advertise protection that does
// not exist, and both the AI and the reviewer trust them. This guard is mirrored in both adapters.
//
// SAMPLES must cover every block rule. Adding a block rule to the config without adding a sample
// fails this test — that is the point. It cannot be satisfied by declaring the rule alone.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanContent } from "../../.claude/hooks/shared-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "harness.config.json"), "utf8"));
const allowlist = { selectors: new Set(), routes: new Set() };

const SMOKE = "cypress/tests/cart/smoke/cart.cy.js";
const E2E = "cypress/tests/cart/e2e/cart.cy.js";
const COMMAND = "cypress/support/commands/cart.commands.js";

// One violating sample per block rule: [file, content]
const SAMPLES = {
  "no-hard-wait": [SMOKE, "cy.wait(500);"],
  "no-hardcoded-selector": [SMOKE, 'cy.get(".btn-primary").click();'],
  "no-hardcoded-route": [SMOKE, 'cy.visit("/checkout");'],
  "no-page-object": ["cypress/support/commands/cart.actions.js", "export class CartPage {}"],
  "no-credential-literal": [COMMAND, 'const password = "hunter2secret";'],
  // Inverted rule: the *absence* of an auth call in an auth-required spec is the violation.
  "require-auth-command": [
    E2E,
    'describe("cart", () => { it("works", () => { cy.log("x"); }); });',
  ],
  "smoke-read-only": [SMOKE, 'cy.request("POST", "/api/orders", {});'],
  // A query is the datastore's contract and belongs in cypress/configs/db/**, for the same reason
  // a route does. Note the sample is a command file, not a smoke spec: put write SQL in a smoke
  // spec and smoke-read-only fires too, which would make this sample prove two rules and neither
  // cleanly.
  "no-sql-literal": [
    COMMAND,
    'const rows = db.query("SELECT id, total FROM orders WHERE id = 1");',
  ],
  "focused-or-quarantined-test": [
    E2E,
    'beforeEach(() => { cy.ensureAuthenticated(); }); it.only("[REQ-1] cart", { tags: ["@REQ-1", "@regression", "@P0", "@e2e"] }, () => {});',
  ],
  // A test with no requirement id in its title and no tags. Path contains "public" so the auth
  // rule stays silent and this sample isolates the tag rule.
  "one-requirement-tag": [
    "cypress/tests/cart/smoke/public-cart.cy.js",
    'it("missing tags", () => {});',
  ],
};

const blockRules = config.rules.filter((r) => r.severity === "block").map((r) => r.id);

// 1. Coverage: the sample table must name every block rule, and nothing else.
const missing = blockRules.filter((id) => !SAMPLES[id]);
const stale = Object.keys(SAMPLES).filter((id) => !blockRules.includes(id));
assert.deepEqual(
  missing,
  [],
  `block rule(s) with no violating sample — add one to SAMPLES: ${missing.join(", ")}`,
);
assert.deepEqual(
  stale,
  [],
  `SAMPLES names rule(s) that are no longer block severity: ${stale.join(", ")}`,
);

// 2. Enforcement: each sample must produce at least one violation.
const unenforced = [];
for (const id of blockRules) {
  const [file, content] = SAMPLES[id];
  if (scanContent(file, content, allowlist, root).length === 0) unenforced.push(id);
}
assert.deepEqual(
  unenforced,
  [],
  `declared "block" but the hook engine never fires: ${unenforced.join(", ")}. ` +
    `Either add a pattern to .claude/hooks/shared-rules.mjs, or change the rule to ` +
    `severity "review" so the QA gate grades it and the tables stop claiming a hard block.`,
);

// 3. A clean file must produce nothing — a scanner that flags everything enforces nothing.
// Includes the auth call, since require-auth-command treats its absence as the violation.
assert.equal(
  scanContent(
    E2E,
    'import { CART_UI } from "@configs/ui/modules/cart/cart.ui.js";\n' +
      'describe("[REQ-1] cart", () => {\n' +
      "  beforeEach(() => { cy.ensureAuthenticated(); });\n" +
      '  it("[REQ-1] shows the cart", { tags: ["@REQ-1", "@regression", "@P0", "@e2e"] }, () => {\n' +
      "    cy.get(CART_UI.LIST).should('be.visible');\n" +
      "  });\n" +
      "});\n",
    allowlist,
    root,
  ).length,
  0,
  "a compliant spec must produce zero violations",
);

console.log(
  `[block-rules] ${blockRules.length} block rule(s), all enforced; compliant spec stays clean`,
);
