# Backend testing coverage

What a backend suite must cover, and how each dimension is measured. Framework-agnostic: this
describes _what_ to prove, not how to write it in Cypress or Playwright.

Applies once a project declares `profile.datastore` and requirements start carrying
`layers: ["api", "service", "db"]`.

---

## 1. Six dimensions, reported separately

A single blended "API coverage %" hides which dimension is failing. Track each with its own
threshold.

| #   | Dimension         | Question it answers                                         | Measure                                                      | Typical gap                                                |
| --- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | **Endpoint**      | Does every endpoint × method have at least one test?        | tested ÷ total combinations                                  | Reaching 100% and believing the API is covered             |
| 2   | **Schema**        | Does the response body match the declared schema?           | responses validated ÷ total (90%+)                           | Asserting status codes only, never the payload             |
| 3   | **Scenario**      | Positive, negative, boundary, and authorization variants    | exercised ÷ implied by spec (70%+)                           | Error paths — 400/401/403 — where most regressions hide    |
| 4   | **Contract**      | Does the running API still honour what consumers depend on? | 100% on consumer-facing endpoints                            | Removing a field; internal tests stay green, clients break |
| 5   | **Persistence**   | Did the change the API reported actually land, correctly?   | mutating requirements with a `db` layer assertion            | Trusting `200 OK` as proof of a write                      |
| 6   | **Authorization** | Can user A reach user B's object by changing an id?         | endpoints taking an object id ÷ those with a cross-user test | The single most exploited API flaw                         |

**Endpoint coverage is the weakest of the six.** It says nothing about whether `DELETE` is safe —
different methods run different code paths, and a suite at 100% endpoint coverage can have zero
negative or authorization tests.

**Dimension 6 is not optional.** Broken Object Level Authorization is #1 in the OWASP API Security
Top 10 (2023) and appears in roughly 40% of API attacks. Any endpoint that takes an object id and
acts on it needs a test that authenticates as one user and requests another user's id, expecting a
refusal. This is a functional test, not a security-team activity, and it is cheap to write.

---

## 2. Persistence: proving the write landed

`200 OK` is a claim, not evidence. A persistence assertion checks what the datastore actually holds.

Cover, in order of value:

1. **Row/document written with the right values** — every field the requirement names, not just the id.
2. **Referential integrity** — the foreign keys the new row depends on resolve, and dependents are
   not orphaned by a delete.
3. **Constraint enforcement** — `NOT NULL`, `UNIQUE`, and check constraints reject what they should.
   A constraint nobody tests is a constraint that gets dropped in a migration.
4. **Transaction atomicity** — a request that fails part-way leaves **no** partial rows. Force the
   failure; assert the absence. This is the check that catches the worst production data bugs.
5. **Views agree with base tables** — a view or materialised view that has drifted from its source is
   a silent data-integrity failure: nothing errors, the numbers are just wrong.
6. **Read-back through the API** — the value in the store is the value the reading endpoint returns.
   Closes the loop the other way: correct storage, wrong projection, is still a defect.

Migrations get their own tests and a rollback plan. A migration is the one change that can corrupt
every row at once.

---

## 3. Response value correctness

Where a response carries a computed or monetary value — a charge, a rate, a total — schema
validation is not enough. The type can be right and the number wrong.

- **Never assert against a float-derived expectation.** Binary floating point cannot represent 100.45
  exactly. Money belongs in a decimal type (`BigDecimal`, `decimal`, integer minor units); a test
  written with floats will encode the same defect it is meant to catch.
- **Pin the rounding mode at the boundary.** Test values exactly at `.005`. Half-up, half-even and
  truncation all differ there, and only there.
- **Sum of parts equals the whole.** Split £10.00 three ways and assert the parts total £10.00 —
  the leftover penny has to go somewhere, and "somewhere" is a business rule, not an accident.
- **Assert invariants, not just examples.** "Total equals the sum of its line items", "a positive rate
  never produces a smaller amount", "no amount is negative". Invariants survive test-data changes
  that hard-coded expected values do not.
- **Aggregation consistency.** A summary endpoint must agree with the detail rows it summarises, and
  with the datastore. This is a cross-layer assertion (§5) and one of the highest-value tests in any
  financial system.

---

## 4. Latency: record, do not assert

Latency is the other thing "cost" can mean, and it needs the opposite treatment.

**Do not assert response time in a functional test.** A `duration < 500ms` assertion in an end-to-end
spec is environment-dependent: it fails on a loaded CI runner while the application is perfectly
healthy. Red that does not mean broken teaches people to ignore red, which costs more than the check
was worth. A single request also has no percentile — one sample cannot support a latency claim.

What to do instead:

| Purpose                 | Mechanism                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Catch a hang            | A generous timeout — a liveness guard, not a performance assertion                    |
| Track latency over time | **Record** per-test duration as evidence and trend it; never gate on it               |
| Prove a latency SLO     | A separate performance lane: controlled load, warm-up, enough samples for percentiles |

**Set SLOs on p95/p99, never on the average.** The average is the most deceptive metric in
performance work: it smooths away exactly the outliers users feel. Of 10,000 requests, 9,500 at 50ms
and 500 at 6,000ms gives a ~347ms average that reads as healthy — while 1 user in 20 waits six
seconds. p95 and p99 are where the pain lives; p99 also exposes rare lock contention and intermittent
dependency timeouts that p95 smooths over.

A functional suite and a performance suite answer different questions. Keep them in different lanes,
with different tooling and different evidence.

---

## 5. Cross-layer assertions

The dimensions above mostly live at one layer. The assertions that justify calling a suite
"end to end" are the ones that span layers and check the layers **agree**:

| Direction        | Assertion                                                                      |
| ---------------- | ------------------------------------------------------------------------------ |
| API → datastore  | The request the API accepted produced exactly the rows and values expected     |
| Datastore → API  | A known stored value is returned, correctly projected, by the reading endpoint |
| API → UI         | The value the API returns is the value rendered, formatted per the rule        |
| Summary → detail | An aggregate agrees with the rows it aggregates                                |

One layer agreeing with itself proves little. **Layers disagreeing is the defect class no
single-layer test can see** — and it is exactly what `layers: [...]` on a requirement records, so
`coverage-computed.json` can report `crossLayer` separately from single-layer coverage.

---

## 6. What fits the requirement registry, and what does not

| Concern                                        | Shape                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Endpoint, schema, scenario, persistence, authz | **Requirement-shaped.** One behaviour, one id, one test, declared `layers`                  |
| Contract / schema drift                        | **A CI check**, not a per-requirement test — diff the served spec against the published one |
| Latency SLO                                    | **A separate lane** with its own tooling and evidence                                       |
| Migration correctness                          | **Release-gated**, run against a production-shaped copy, with a rollback plan               |

Forcing the last three into `requirements.json` makes coverage look complete while measuring
something else. Keep them adjacent and named rather than absorbed.

---

## 7. Test data at the backend layers

Section 6 of a project's test plan owns the policy; two rules matter more once a datastore is
reachable:

- **Seed through the application's own API where possible, assert in the datastore.** Seeding with
  raw inserts bypasses the business rules that make the data valid, so the test proves the read path
  against data the application would never have produced.
- **Cleanup is failure-safe and its failure is a test failure.** A leaked row in a shared database
  outlives the run, and cleanup that only executes on the happy path leaks on exactly the runs that
  matter.

Least privilege is not optional: a read-only connection for assertions, a separate approved path for
anything that writes, and never a production datastore. `profile.datastore.credentialSource` names
where the credential comes from; the credential itself never enters the repository.
