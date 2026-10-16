# Requirement authoring → `evidence/requirements.json`

> One guide for planning requirements in this harness.
> Template: [`_template/requirement.example.json`](_template/requirement.example.json)  
> Registry: [`../../evidence/requirements.json`](../../evidence/requirements.json) (tracked)  
> Aligns with: [`../START-HERE.md`](../START-HERE.md) §6 Step 2 · profile via [`../../harness/profiles/`](../../harness/profiles/)

Do **not** invent a second registry under `docs/test-plans/`. The canonical plan **is** `evidence/requirements.json`.  
Never put credentials or PII in requirement entries.

```text
harness/profiles/projects/<key>.json  →  compose + sync  →  harness.config.json
        │
        ▼
docs/application-intelligence/**      →  verified context (INTAKE)
        │
        ▼
evidence/requirements.json            →  draft → owner promotes active
        │
        ▼
BUILD (cypress-generator)             →  one active id at a time
```

---

## Fill prompt (paste into any AI, or use with cypress-intake)

```text
Create or update harness requirements for this project.

Read first:
1. harness.config.json — composed project + rules (do not invent policy)
2. docs/application-intelligence/ (project-context / module-context if present)
3. docs/application-intelligence/_template/requirement.example.json — entry shape
4. docs/application-intelligence/requirement-authoring-guide.md — this guide
5. evidence/requirements.json — current registry
6. docs/START-HERE.md §6 Step 2 — approval rules

Inputs I will provide:
- Source: <paste Jira/AC/spec or describe the behavior>
- Module: <module slug>
- Plan notes: <optional>

Rules:
- Do not invent acceptance criteria, selectors, routes, credentials, or expected results.
- Record unknowns; ask before promoting anything to status "active".
- Write/merge into evidence/requirements.json (version 1, requirements[]).
- New entries start as status "draft".
- Active entries (when I approve) MUST include: id, module, title, expectedOutcome, source,
  non-empty acceptanceCriteria[], non-empty preconditions[], type (SMOKE|REGRESSION),
  priority (P0|P1|P2), tier (smoke|e2e|ddt).
- Prefer path: positive | negative | edge when known.
- Smoke / type SMOKE: production-safe read-only intent; mutating E2E stays draft until synthetic
  create+cleanup is approved in application-intelligence.
- Spec titles later must start with [REQ-ID] and carry requirement / Type / Priority / tier tags
  (see START-HERE BUILD).
- Focused run after BUILD: npm run cy:run:tag -- --env grepTags=@REQ-ID (or project tag convention).
- Do not create Cypress specs, commands, or config constants in this step.

Output when done:
1. Path updated (evidence/requirements.json)
2. Table: id | type | priority | status | title
3. Unresolved questions
4. Which P0 SMOKE ids to approve to active first for BUILD
```

### After approval

1. Set chosen entries `status` → `active` (human).
2. Invoke `cypress-generator` with **one** active id.
3. Run focused tag run, then `pre-merge-qa-gate` / `npm run verify` as appropriate.

---

## Status lifecycle

| Status           | BUILD allowed?         |
| ---------------- | ---------------------- |
| `draft`          | No                     |
| `active`         | Yes — one id at a time |
| other / deferred | No until activated     |

Never silently promote `draft` → `active`.

---

## Required fields (active)

Validated by `npm run evidence:build` / evidence scripts:

| Field                | Values                                  |
| -------------------- | --------------------------------------- |
| `id`                 | Unique string (e.g. `PAY-CHECKOUT-001`) |
| `module`             | Module slug                             |
| `title`              | Observable behavior                     |
| `expectedOutcome`    | What must be visible / true             |
| `source`             | Ticket, spec, or module-context anchor  |
| `acceptanceCriteria` | Non-empty string array                  |
| `preconditions`      | Non-empty string array                  |
| `type`               | `SMOKE` \| `REGRESSION`                 |
| `priority`           | `P0` \| `P1` \| `P2`                    |
| `tier`               | `smoke` \| `e2e` \| `ddt`               |
| `status`             | `draft` until approved, then `active`   |

Optional planning fields (ignored by evidence validation if present): `path`, notes in `source`, module-context links.

---

## Smoke vs regression

|              | SMOKE             | REGRESSION                                       |
| ------------ | ----------------- | ------------------------------------------------ |
| `type`       | `SMOKE`           | `REGRESSION`                                     |
| Typical tier | `smoke`           | `e2e` / `ddt`                                    |
| Mutations    | Prefer read-only  | Synthetic + failure-safe cleanup before `active` |
| Order        | Automate P0 first | After P0 smoke baseline                          |

---

## Optional at INTAKE (not blockers)

API contracts and CI/environment config help intake but are **not** required to start a profile or draft requirements. Record unknowns in `docs/application-intelligence/project-context.md`; do not invent contracts.
