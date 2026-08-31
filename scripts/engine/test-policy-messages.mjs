import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

const cursorWritePayload = {
  tool_name: "Write",
  tool_input: {
    path: "cypress/tests/cart/smoke/cart.cy.js",
    contents: "cy.wait(5000);\nconst password = 'secret-value';\n",
  },
};

assert.equal(
  extractToolChange(cursorWritePayload, root).content,
  cursorWritePayload.tool_input.contents,
  "Cursor Write sends `contents`, not `content` or `text`",
);

const existingSpec = path.join(
  root,
  "cypress/tests/products/smoke/products-smoke.cy.js",
);
const afterEdit = extractToolChange(
  {
    file_path: existingSpec,
    edits: [{ old_string: "x", new_string: "y" }],
  },
  root,
  { readCurrent: true },
);
assert.equal(afterEdit.filePath, existingSpec);
assert.equal(afterEdit.content, fs.readFileSync(existingSpec, "utf8"));

assert.deepEqual(
  extractToolChange(
    {
      file_path: existingSpec,
      edits: [{ old_string: "x", new_string: "y" }],
    },
    root,
  ),
  { filePath: "", content: "" },
  "afterFileEdit without readCurrent must not be treated as a Write",
);

const preValidate = spawnSync(
  process.execPath,
  [path.join(root, ".claude/hooks/pre-validate-cypress-rules.mjs")],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(cursorWritePayload),
  },
);
assert.equal(
  preValidate.status,
  2,
  `Cursor Write with a hard wait must be refused before disk. stderr=${preValidate.stderr}`,
);
assert.match(preValidate.stderr, /PRE-CHECK/);
assert.match(preValidate.stderr, /Hard wait/);

const postValidate = spawnSync(
  process.execPath,
  [path.join(root, ".claude/hooks/validate-cypress-rules.mjs")],
  {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({
      file_path: existingSpec,
      edits: [{ old_string: "x", new_string: "y" }],
    }),
  },
);
assert.equal(
  postValidate.status,
  0,
  `Cursor afterFileEdit must recognize file_path. stderr=${postValidate.stderr}`,
);
