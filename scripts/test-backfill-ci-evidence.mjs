#!/usr/bin/env node
// Self-check for the CI backfill classifier. Run: node scripts/test-backfill-ci-evidence.mjs
// No network: classify() is pure, so the interesting logic is testable without gh.
import assert from "node:assert/strict";
import { classify, firstAttemptRun } from "./backfill-ci-evidence.mjs";

const withSteps = [{ steps: [{ name: "Run smoke tests" }] }];
const noSteps = [{ steps: [] }];

// A passing PR run.
const pass = classify({
  databaseId: 1,
  event: "pull_request",
  conclusion: "success",
  createdAt: "2026-07-31T00:00:00Z",
  jobs: withSteps,
  runAttempt: 1,
});
assert.equal(pass.trigger, "pr");
assert.equal(pass.outcome, "passed");
assert.equal(
  pass["failure-class"],
  undefined,
  "a pass must never carry a failure class",
);

// Tests ran and failed — a genuine test failure, counts against M2.
const realFail = classify({
  databaseId: 2,
  event: "pull_request",
  conclusion: "failure",
  jobs: withSteps,
  runAttempt: 1,
});
assert.equal(realFail.outcome, "failed");
assert.equal(
  realFail["failure-class"],
  undefined,
  "a real test failure must NOT be excluded",
);

// The billing-lock / never-started case: zero steps executed. Infrastructure, not a test signal.
const neverStarted = classify({
  databaseId: 3,
  event: "pull_request",
  conclusion: "failure",
  jobs: noSteps,
  runAttempt: 1,
});
assert.equal(neverStarted.outcome, "failed");
assert.equal(
  neverStarted["failure-class"],
  "ENV",
  "a run that never started must be ENV",
);

// Event mapping.
assert.equal(
  classify({
    databaseId: 4,
    event: "push",
    conclusion: "success",
    jobs: withSteps,
  }).trigger,
  "push",
);
assert.equal(
  classify({
    databaseId: 5,
    event: "workflow_dispatch",
    conclusion: "success",
    jobs: withSteps,
  }).trigger,
  "manual",
);
assert.equal(
  classify({
    databaseId: 6,
    event: "schedule",
    conclusion: "success",
    jobs: withSteps,
  }).trigger,
  "schedule",
);
// An event M2 does not model is skipped, not guessed at.
assert.equal(
  classify({
    databaseId: 7,
    event: "release",
    conclusion: "success",
    jobs: withSteps,
  }),
  null,
);

// Re-runs keep their attempt number, so M2's attempt-1-only filter still holds.
assert.equal(
  classify({
    databaseId: 8,
    event: "pull_request",
    conclusion: "success",
    jobs: withSteps,
    runAttempt: 3,
  }).attempt,
  3,
);
// snake_case from the raw REST API is accepted too.
assert.equal(
  classify({
    id: 9,
    event: "pull_request",
    conclusion: "success",
    jobs: withSteps,
    run_attempt: 2,
  }).attempt,
  2,
);
assert.equal(
  classify({ id: 9, event: "push", conclusion: "success", jobs: withSteps })
    .pipeline,
  "9",
);

// A cancelled run is not a test failure signal, but it did not pass either; it is recorded as an
// ENV-classified failure only when nothing ran, matching the never-started case above.
const cancelledNoSteps = classify({
  databaseId: 10,
  event: "pull_request",
  conclusion: "cancelled",
  jobs: noSteps,
  runAttempt: 1,
});
assert.equal(cancelledNoSteps["failure-class"], "ENV");

// A green retry must not be stored as attempt-1 passed. gh run list reports the
// latest conclusion; M2 is first-attempt only.
const retriedList = {
  databaseId: 11,
  event: "pull_request",
  conclusion: "success",
  createdAt: "2026-09-06T00:00:00Z",
  jobs: withSteps,
  runAttempt: 2,
};
const firstAttemptFailed = firstAttemptRun(retriedList, {
  conclusion: "failure",
  attempt: 1,
  jobs: withSteps,
});
assert.equal(firstAttemptFailed.conclusion, "failure");
assert.equal(firstAttemptFailed.runAttempt, 1);
const retried = classify(firstAttemptFailed);
assert.equal(retried.attempt, 1);
assert.equal(retried.outcome, "failed");
assert.equal(
  retried["failure-class"],
  undefined,
  "attempt-1 test failure after a later green retry must still count against M2",
);

assert.equal(
  firstAttemptRun(retriedList, null),
  null,
  "a missing attempt-1 view must skip, not invent attempt 1",
);
assert.equal(
  firstAttemptRun(retriedList, { jobs: [], attempt: 1 }),
  null,
  "an attempt-1 view without a conclusion must skip",
);
// The previous catch path defaulted runAttempt to 1 and jobs to [] on a view
// failure, then kept the list conclusion. That turns a green retry into an
// attempt-1 pass (or a real failure into ENV). firstAttemptRun must refuse.
assert.equal(
  firstAttemptRun(
    { ...retriedList, conclusion: "success" },
    { conclusion: "", jobs: [], attempt: 1 },
  ),
  null,
);

console.log("[backfill] all checks passed");
