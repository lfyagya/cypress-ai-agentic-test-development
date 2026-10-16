# Harness Lifecycle Specification

Status: `IMPLEMENTED`

This document records the Cypress harness contract. The operator procedure is
[`../START-HERE.md`](../START-HERE.md).

## Goal

Start with no application-specific automation and derive a traceable test system from verified
project evidence:

```text
INTAKE → SPECIFY → BUILD → GUARD → EVALUATE → EXECUTE → DIAGNOSE → MEASURE
```

## Sources of truth

| Concern                                      | Canonical source                       |
| -------------------------------------------- | -------------------------------------- |
| Harness adapters, roles, limits, permissions | `harness.config.json`                  |
| Framework-neutral test quality               | `harness/qa-automation-foundations.md` |
| Role behavior                                | `harness/agents/*.md`                  |
| Project and module behavior                  | `docs/application-intelligence/**`     |
| Approved requirements                        | `evidence/requirements.json`           |
| Selectors, routes, and APIs                  | `cypress/configs/**`                   |
| Reusable behavior                            | `cypress/support/commands/**`          |
| Executable coverage                          | `cypress/tests/**`                     |
| Run and outcome evidence                     | `evidence/**`                          |

Generated Claude and Copilot files are projections. They are never edited directly.

## Phase contract

| Phase    | Actor                  | Required input                   | Output                                  | Blocking rule                               |
| -------- | ---------------------- | -------------------------------- | --------------------------------------- | ------------------------------------------- |
| INTAKE   | `cypress-intake`       | Authoritative sources            | Context, requirements, config constants | Unknown safety or behavior remains explicit |
| SPECIFY  | Intake + owner         | Approved context                 | Active requirement registry             | No invented requirement or priority         |
| BUILD    | `cypress-generator`    | One active requirement           | Config → Commands → Test                | Builder never grades itself                 |
| GUARD    | Hooks + CI             | Proposed change                  | Deterministic allow/block               | Security and architecture fail closed       |
| EVALUATE | `pre-merge-qa-gate`    | Diff + supplied command evidence | Verdict + per-test grade                | Read/search only                            |
| EXECUTE  | Cypress                | Accepted tests and environment   | HTML + JSON report                      | Production smoke is read-only               |
| DIAGNOSE | `cypress-debugger`     | Failure evidence                 | Root cause + bounded repair             | No weakened assertion or hidden failure     |
| MEASURE  | `scripts/evidence.mjs` | Reporter JSON + registries       | Summary, coverage, metrics              | Missing evidence is `null`, never zero      |

SHIP (opening the PR) and harness maintenance are not lifecycle agents; the parent workflow performs
them directly.

## Traceability invariant

Every test title begins `[REQUIREMENT-ID]` and carries the same id as a tag. The title is the
reporter-independent join key; tags remain the execution filter. Each test also carries exactly one
Type and Priority tag.

An active requirement without a passing mapped test is uncovered. A test without one active
requirement prefix is a traceability gap.

## Evidence contract

`npm run evidence:build` normalizes `cypress/reports/html/index.json` into:

```text
evidence/
  requirements.json
  runs/<run-id>/run-summary.json
  coverage-computed.json
  metrics.json
```

`run-summary.json` is the only runner-neutral execution input downstream. Native reporter shapes
do not leak into metrics. The recorded ledgers, `unavailable`-vs-`zero` rule, and the recording
commands are documented once in [`../START-HERE.md`](../START-HERE.md) §7; this section states only
the contract.

The metrics contract is:

- M1 accepted-test rate from first-submission gate evidence.
- M2 first-pass CI rate from first-attempt PR evidence, excluding classified environment failures.
- M3 new-test flake rate after five observations on unchanged code.
- M5 active requirements with a passing mapped test divided by all active requirements.

Metric ids are stable identifiers, not a sequence. `M4` (QA effort per accepted scenario) was a
manual-entry metric nothing consumed and has been retired; its id is not reused.

## Empty-state invariant

A clean clone has zero requirements and zero tests. Harness checks, rule checks, lint, the test
command, and evidence generation must still pass. Metrics report `bootstrap` with unavailable
values and their reasons.

## Optional integrations

Cypress Cloud and other paid services may enrich execution and retention. The baseline lifecycle,
local evidence, CI execution, and metrics cannot depend on them.

## Definition of done

- Control-plane projections have no drift.
- Context and requirements are source-linked and owner-approved.
- P0 is automated before lower priorities.
- BUILD and EVALUATE remain separate.
- Focused and lane-level execution evidence is supplied.
- Reports normalize without traceability gaps.
- Computed metrics and unavailable inputs are both explicit.
