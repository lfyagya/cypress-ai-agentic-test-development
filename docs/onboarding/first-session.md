# First Team Session — `cypress-ai-agentic-test-development`

Kickoff visual brief. Date: 2026-08-14 · Repo: `github.com/lfyagya/cypress-ai-agentic-test-development` · Branch: `main`.

Every diagram traces to a file in this repo:
state → `evidence/requirements.json`, `evidence/gate-log.jsonl`, `docs/application-intelligence/**`;
rules/roster → `harness.config.json`; profile → `harness/profiles/projects/cypress-boilerplate.json`;
enforcement/CI → `.github/workflows/*.yml`, `docs/architecture/cross-tool-configuration.md`, `docs/START-HERE.md`.

Blanks (`__________`) are facts the repo does not contain — fill them in live. Nothing is assumed.

---

## 1. What we have today (state snapshot)

```mermaid
flowchart TD
    R["cypress-ai-agentic-test-development v2.0.0<br/>Node >= 22 · branch main"]
    R --> T["Target app<br/>Automation Exercise<br/>automationexercise.com<br/>public · third-party · no source here"]
    R --> M["Active module: products<br/>(only one)"]
    M --> Q1["AE-PRODUCTS-001<br/>catalog API<br/>SMOKE · P0 · smoke tier"]
    M --> Q2["AE-PRODUCTS-002<br/>All Products listing UI<br/>SMOKE · P0 · smoke tier"]
    M --> Q3["AE-PRODUCTS-003<br/>search API (POST)<br/>REGRESSION · P1 · e2e tier"]
    Q1 --> S1["products-smoke.cy.js"]
    Q2 --> S2["products-listing.cy.js"]
    Q3 --> S3["products-search.cy.js"]
    S1 --> G["Gate: PASS_WITH_ACTIONS<br/>attempt 1 · 2026-08-13"]
    S2 --> G
    S3 --> NG["No gate row recorded yet"]

    style R fill:#e8f0fe,stroke:#4285f4,color:#111
    style T fill:#fef7e0,stroke:#f9ab00,color:#111
    style G fill:#e6f4ea,stroke:#34a853,color:#111
    style NG fill:#f1f3f4,stroke:#9aa0a6,color:#111
```

3 active requirements · 3 specs (2 smoke + 1 e2e) · all read-only against a public site · no credentials, no test data created.

---

## 2. Architecture — one direction only

```mermaid
flowchart LR
    C["configs/<br/>selectors · routes · endpoints"] --> Cmd["support/commands/<br/>navigation · intercepts · assertions"] --> Test["tests/<br/>one behavior · orchestration"]
    Test -. "never reaches past commands (refused)" .-> C

    style C fill:#e8f0fe,stroke:#4285f4,color:#111
    style Cmd fill:#fce8e6,stroke:#ea4335,color:#111
    style Test fill:#e6f4ea,stroke:#34a853,color:#111
```

---

## 3. Tier boundary (why AE-PRODUCTS-003 is e2e, not smoke)

```mermaid
flowchart LR
    subgraph SMOKE["smoke tier — read-only"]
        s1["GET only<br/>001 catalog · 002 listing"]
    end
    subgraph E2E["e2e tier — writes allowed"]
        e1["POST /api/searchProduct<br/>003 search"]
    end
    Rule["smoke-read-only blocks<br/>POST/PUT/PATCH/DELETE in smoke"]
    Rule --> SMOKE
    Rule --> E2E

    style SMOKE fill:#e6f4ea,stroke:#34a853,color:#111
    style E2E fill:#fef7e0,stroke:#f9ab00,color:#111
    style Rule fill:#fce8e6,stroke:#ea4335,color:#111
```

---

## 4. How work flows — 4 agent roles

```mermaid
flowchart LR
    I["INTAKE<br/>cypress-intake<br/>context + requirements + config"] --> S["SPECIFY<br/>human approves → active"]
    S --> B["BUILD<br/>cypress-generator<br/>1 requirement"]
    B --> GU["GUARD<br/>local checks"]
    GU --> E{"EVALUATE<br/>pre-merge-qa-gate<br/>read-only"}
    E -- BLOCK (max 3) --> B
    E -- PASS --> X["EXECUTE<br/>cypress"]
    X -- fail --> D["DIAGNOSE<br/>cypress-debugger"]
    D --> B
    X -- pass --> Me["MEASURE<br/>evidence.mjs"]

    style S fill:#e6f4ea,stroke:#34a853,color:#111
    style E fill:#fef7e0,stroke:#f9ab00,color:#111
    style D fill:#fce8e6,stroke:#ea4335,color:#111
```

4 roles only: INTAKE · BUILD · DIAGNOSE · EVALUATE. Opening the PR and repo maintenance are done in the
main workflow, not by a dedicated agent. Invoke a specialist only when its `when` condition matches:
INTAKE per new project/module, DIAGNOSE only after a reproducible failure.

---

## 5. The 9 rules at a glance

```mermaid
flowchart TB
    subgraph BLOCK["8 BLOCKING (write refused / CI blocks)"]
        r1["no-hard-wait<br/>no cy.wait(number)"]
        r2["no-hardcoded-selector<br/>use configs/ui/**"]
        r3["no-hardcoded-route<br/>use routes.js"]
        r4["no-page-object<br/>commands only"]
        r5["require-auth-command<br/>ensureAuthenticated()"]
        r6["no-credential-literal<br/>use cy.env()"]
        r7["smoke-read-only<br/>no writes in smoke"]
        r8["one-requirement-tag<br/>exactly 1 req id"]
    end
    subgraph GRADED["1 GRADED (QA gate)"]
        r9["search-before-create<br/>grep by value first"]
    end

    style BLOCK fill:#fce8e6,stroke:#ea4335,color:#111
    style GRADED fill:#fef7e0,stroke:#f9ab00,color:#111
```

---

## 6. Enforcement — who blocks, and the CI caveat

```mermaid
flowchart TD
    W["A violating write is attempted"]
    W --> C3["Claude · Copilot · Cursor<br/>hook denies (exit 2)<br/>REFUSED before disk"]
    W --> Cx["Codex<br/>no hook API<br/>guidance only"]
    Cx --> Floor
    H["Human edit"] --> Floor["npm run verify + pre-push<br/>(universal floor, free)"]
    Floor --> CI{"CI backstop"}
    CI --> Off["AUTO CHECKS ENABLED<br/>requires GitHub runner allocation<br/>failure before setup = infrastructure"]

    style C3 fill:#fce8e6,stroke:#ea4335,color:#111
    style Floor fill:#fef7e0,stroke:#f9ab00,color:#111
    style Off fill:#fce8e6,stroke:#ea4335,color:#111
```

PRs request smoke and architecture validation automatically. Reviewers cannot treat a job that fails
before setup as test evidence; resolve GitHub runner allocation first.

---

## 7. Evidence / metrics — fed vs empty

```mermaid
flowchart LR
    subgraph HAVE["Tracked & present"]
        h1["requirements.json<br/>3 active"]
        h2["gate-log.jsonl<br/>2 rows → M1 has input"]
    end
    subgraph MISSING["Not present yet"]
        m1["ci-history.jsonl<br/>→ M2 unavailable"]
        m2["run history < 5 on one commit<br/>→ M3 accrues"]
    end
    Auto["M5 requirement→test coverage<br/>fully automatic"]
    Note["Missing = 'unavailable' with a reason,<br/>never a fake 0"]

    style HAVE fill:#e6f4ea,stroke:#34a853,color:#111
    style MISSING fill:#f1f3f4,stroke:#9aa0a6,color:#111
    style Auto fill:#e8f0fe,stroke:#4285f4,color:#111
```

Metrics are M1, M2, M3, M5. (The former manual M4 effort metric has been removed.)

---

## 8. Project profile (what defines this project)

One small profile is the only project-specific input; all rules/roster/policy come from the adapter baseline.

```mermaid
flowchart LR
    P["Project profile<br/>projects/cypress-boilerplate.json<br/>key · displayName · owner<br/>adapter · language · adapters[]"]
    A["Adapter baseline<br/>adapters/cypress.json<br/>rules · roster · hooks · permissions"]
    P -- harness:compose --> CFG["harness.config.json"]
    A -- harness:compose --> CFG
    CFG -- harness:sync --> Proj["Claude · Copilot · Cursor · Codex<br/>projections"]

    style P fill:#e8f0fe,stroke:#4285f4,color:#111
    style A fill:#fef7e0,stroke:#f9ab00,color:#111
    style CFG fill:#e6f4ea,stroke:#34a853,color:#111
```

| Field              | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| key                | `cypress-boilerplate`                                                       |
| displayName        | Cypress Automation Boilerplate                                              |
| profile owner      | `cypress-harness-maintainers` (harness maintainers — **not** the app owner) |
| adapter / language | `cypress` / `javascript`                                                    |
| projectName / repo | `cypress-ai-agentic-test-development`                                       |
| enabled AI tools   | Claude · Copilot · Cursor · Codex (all four, deliberately)                  |

Two different "owners": the profile owner above is the harness maintainers; the **application
accountable owner** is Yagya Bhatta — pending formal confirmation
(`docs/application-intelligence/project-context.md`).

Note for real projects: this repo enables all four tools on purpose, to demonstrate every projection.
A real project should enable only the tools its team actually uses — the `_template` default is
Claude + Copilot — because a disabled adapter's generated files are removed on the next sync.

---

## 9. One representative per project (nominate today)

The repo carries no roster of people. Fill in live.

```mermaid
flowchart TB
    subgraph NOM["Nominate 1 representative per project"]
        p1["Project: cypress-ai-agentic-test-development<br/>Representative: __________<br/>Backup: __________"]
        p2["Project: __________<br/>Representative: __________<br/>Backup: __________"]
    end
    role["Representative owns:<br/>• speaks for the project in syncs<br/>• approves requirements → active (SPECIFY)<br/>• first point of contact for the project"]

    style NOM fill:#e8f0fe,stroke:#4285f4,color:#111
    style role fill:#f1f3f4,stroke:#9aa0a6,color:#111
```

---

## 10. How / who to reach — progress & blockers

Channels and owners are not in the repo — agree and record them in the session.

```mermaid
flowchart TD
    M["Team member has an update"]
    M --> PR{"Progress or Blocker?"}
    PR -- Progress --> Prog["Post in: [progress channel]<br/>Cadence: [daily/weekly]<br/>Format: what shipped + what's next"]
    PR -- Blocker --> Rep["Ping: project representative (§9)"]
    Rep --> Esc{"Resolved?"}
    Esc -- No --> Owner["Escalate: accountable owner<br/>(Yagya Bhatta — pending)"]
    Esc -- Yes --> Done["Record outcome in [tracker]"]
    Note["Conflicting sources or unclear behavior:<br/>agents STOP and report — they do not guess<br/>(source precedence, docs/START-HERE.md)"]

    style M fill:#e8f0fe,stroke:#4285f4,color:#111
    style Rep fill:#fef7e0,stroke:#f9ab00,color:#111
    style Owner fill:#fce8e6,stroke:#ea4335,color:#111
```

| What                         | Value (to agree)       |
| ---------------------------- | ---------------------- |
| Progress channel + cadence   | TBD                    |
| Blocker / escalation channel | TBD                    |
| Issue tracker / board        | TBD                    |
| Project representative(s)    | TBD (see §9)           |
| Accountable owner (confirm)  | Yagya Bhatta — pending |

---

## 11. Open decisions for the team

```mermaid
flowchart TD
    O["Decide today"]
    O --> a["Confirm accountable owner (pending)"]
    O --> b["CI billing → restore GitHub runner allocation"]
    O --> c["Private/staging mirror? (none provided)"]
    O --> d["Synthetic account lifecycle<br/>(blocks future auth/mutating E2E)"]
    O --> e["Record a gate verdict for AE-PRODUCTS-003"]
    O --> f["Next requirements to promote to active"]

    style O fill:#e8f0fe,stroke:#4285f4,color:#111
```

---

## Suggested agenda

1. Repo purpose + Config → Commands → Tests (§2) — 10 min
2. Current state: products module, 3 requirements, 3 specs (§1) + tier boundary (§3) — 10 min
3. Project profile — what defines this project (§8) — 5 min
4. The 9 rules and why (§5) — 10 min
5. Enforcement reality: 3 tools block writes, Codex guidance, CI manual-only (§6) — 5 min
6. Local setup + `npm run verify` live (Node 22 required) — 10 min
7. Nominate one representative per project (§9) — 5 min
8. Agree how/who to reach for progress & blockers (§10) — 10 min
9. Open decisions and owners (§11) — 10 min
