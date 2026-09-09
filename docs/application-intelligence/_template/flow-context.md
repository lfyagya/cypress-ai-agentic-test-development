# Flow Context

Status: `DRAFT`

> Use this tier only when a requirement's steps are owned by **different modules**. A journey inside
> one module belongs in that module's `module-context.md` § States and transitions — a second
> document for it would create a second owner for the same facts.
>
> Copy to `docs/application-intelligence/flows/<flow>.md`.

## Identity and evidence

| Field             | Value                                |
| ----------------- | ------------------------------------ |
| Flow              | `<kebab-case name>`                  |
| Modules crossed   | `<module>, <module>`                 |
| Business owner    | `<person or team>`                   |
| Source references | `<tickets, source paths, API specs>` |
| Last verified     | `<ISO date>`                         |

## Business intent

The outcome a user is trying to reach across the whole journey, and what it costs the business when
the journey breaks part-way rather than at the start.

## Entry and exit

| Field              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| Entry precondition | `<state the flow assumes before step 1>`                |
| Actor              | `<role, and whether authenticated>`                     |
| Successful exit    | `<observable end state>`                                |
| Abandoned exit     | `<what the app leaves behind if the user simply stops>` |

## Steps

One row per step. "Owning module" is the module whose context verifies that step — every step must
have one, or the module context is missing and INTAKE is not finished.

| #   | Action | Owning module | State carried in | Expected state after | Observable evidence |
| --- | ------ | ------------- | ---------------- | -------------------- | ------------------- |

## Failure and abort behaviour

| Step fails | Application behaviour | What the test must assert | Who cleans up |
| ---------- | --------------------- | ------------------------- | ------------- |

A flow that creates data must name the cleanup owner for a failure at **every** step, not only the
last. Cleanup that runs on the happy path only leaks records on exactly the runs that matter.

## Test-data lifecycle for the flow

Module contexts own per-module data. This section owns what spans them.

- Synthetic identity shape:
- Isolation key (unique per run):
- Created across the flow (step → artifact):
- Failure-safe teardown (order, and what runs even on mid-flow failure):
- Forbidden data: credentials, PII, payment data, production records — always.

## Environment and approval

| Field              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| Environment        | `<name>`                                                  |
| Data class         | `<synthetic / shared demo / production>`                  |
| Mutations required | `<list — this flow cannot run where these are forbidden>` |
| Mutation approval  | `<owner and date>`                                        |

## Risks and candidate scenarios

| Risk | Candidate behavior | Suggested Type | Suggested Priority | Evidence |
| ---- | ------------------ | -------------- | ------------------ | -------- |

## Unknowns

| Question | Owner | Blocking? | Resolution |
| -------- | ----- | --------- | ---------- |

## Approval

- [ ] Every step has an owning module with approved context.
- [ ] Entry preconditions and both exits are verified, not assumed.
- [ ] Failure behaviour is verified for every step, not only the last.
- [ ] Test data is synthetic, isolated, and cleaned up failure-safely.
- [ ] Mutations required by this flow are approved for the named environment.
