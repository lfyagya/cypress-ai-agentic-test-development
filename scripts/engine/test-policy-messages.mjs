import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractToolChange,
  scanContent,
} from "../../.claude/hooks/shared-rules.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

assert.deepEqual(
  extractToolChange(
    {
      toolName: "Write",
      toolArgs: {
        path: "cypress/support/demo.js",
        text: "const ok = true;",
      },
    },
    root,
  ),
  { filePath: "cypress/support/demo.js", content: "const ok = true;" },
);

assert.equal(
  extractToolChange(
    {
      tool_name: "StrReplace",
      tool_input: {
        path: "cypress/support/demo.js",
        old_string: "const ok = true;",
        new_string: "const ok = false;",
      },
    },
    root,
  ).content,
  "const ok = false;",
);

const violations = scanContent(
  "cypress/tests/cart/smoke/cart.cy.js",
  "const password = 'secret-value'; cy.wait(1);",
  { selectors: new Set(), routes: new Set(), endpoints: new Set() },
  root,
);

assert.deepEqual(
  violations.map(({ message }) => message),
  [
    "Hard wait detected. Replace with cy.apiWait(...) or a deterministic state-based wait.",
    "Missing cy.ensureAuthenticated() in auth-required test file.",
    "Hardcoded credential. Read it with cy.env([...]) instead.",
  ],
);

assert.deepEqual(
  scanContent(
    "cypress/support/actions/login.actions.js",
    "export class LoginActions {}",
    { selectors: new Set(), routes: new Set(), endpoints: new Set() },
    root,
  ).map(({ message }) => message),
  [
    "Action class or page-object import. Command-first architecture forbids these dependencies.",
  ],
);

const focused = scanContent(
  "cypress/tests/cart/e2e/cart.cy.js",
  "beforeEach(() => { cy.ensureAuthenticated(); });\n" +
    'it.only("[REQ-1] cart", { tags: ["@REQ-1", "@regression", "@P0", "@e2e"] }, () => {});',
  { selectors: new Set(), routes: new Set(), endpoints: new Set() },
  root,
);
assert.deepEqual(
  focused.map(({ message }) => message),
  [
    "Focused test or unrecorded quarantine. Remove .only; a skip needs // @quarantine ISSUE-123: reason directly above it. (.only is never permitted.)",
  ],
);

assert.equal(
  scanContent(
    "cypress/tests/cart/e2e/cart.cy.js",
    "beforeEach(() => { cy.ensureAuthenticated(); });\n" +
      "// @quarantine QA-123: payment sandbox is unavailable\n" +
      'it.skip("[REQ-1] cart", { tags: ["@REQ-1", "@regression", "@P0", "@e2e"] }, () => {});',
    { selectors: new Set(), routes: new Set(), endpoints: new Set() },
    root,
  ).length,
  0,
  "a recorded quarantine must stay scannable without being blocked",
);
