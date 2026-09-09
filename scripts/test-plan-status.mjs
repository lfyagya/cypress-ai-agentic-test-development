import assert from "node:assert/strict";
import { END, START, renderStatus, spliceBlock } from "./plan-status.mjs";

const requirements = [
  {
    id: "AE-X-001",
    module: "x",
    type: "SMOKE",
    priority: "P0",
    tier: "smoke",
    status: "active",
  },
  {
    id: "AE-X-002",
    module: "x",
    type: "REGRESSION",
    priority: "P1",
    tier: "e2e",
    status: "draft",
  },
];

const coverage = {
  runId: "run-1",
  requirements: [{ requirement: "AE-X-001", passing: true }],
};

const block = renderStatus(requirements, coverage);

// An active requirement with a passing test reads as covered; a draft never claims a test.
assert.match(
  block,
  /`AE-X-001`\s+\| x\s+\| SMOKE P0\s+\| smoke\s+\| active\s+\| passing/,
);
assert.match(block, /`AE-X-002`.*\*\*draft\*\*\s+\| none/);
assert.match(block, /1 active, 1 covered and passing\. 1 held: `AE-X-002`\./);
assert.match(block, /Coverage of _active_ requirements is 100%/);
assert.match(block, /coverage of _known verified behaviour_ is 1\/2/);

// A passing test for a requirement that is no longer active must not inflate the active count.
const staleCoverage = {
  runId: "run-2",
  requirements: [
    { requirement: "AE-X-001", passing: false },
    { requirement: "AE-X-002", passing: true },
  ],
};
assert.match(
  renderStatus(requirements, staleCoverage),
  /1 active, 0 covered and passing\./,
);

// The runId must NOT appear: evidence:build stamps a new one each run, and verify runs it right
// before plan:check, so embedding it would mean regenerating on every run to stay green.
assert.doesNotMatch(
  block,
  /run-1/,
  "the volatile runId must not enter the generated block",
);

// The splice replaces only the delimited region and leaves hand-written prose alone.
const document = `# Plan\n\nbefore\n\n${START}\nold\n${END}\n\nafter\n`;
const spliced = spliceBlock(document, `${START}\nnew\n${END}`);
assert.equal(spliced, `# Plan\n\nbefore\n\n${START}\nnew\n${END}\n\nafter\n`);

// A plan without markers is a hard error, not a silent no-op.
assert.throws(() => spliceBlock("# Plan\n\nno markers\n", "x"), /missing the/);

console.log("[test] plan-status ok");
