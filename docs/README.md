# Documentation

**Start with [START-HERE.md](START-HERE.md)** — the complete, self-contained harness guide.
Everything below is supporting detail you reach for only when you need it.

Taxonomy is identical in the Playwright adapter: `guides/` for how-to, `reference/` for lookup,
`architecture/` for design and specs.

## Reference

| Topic                                       | Document                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Framework standards                         | [framework-standards.md](reference/framework-standards.md)            |
| Why configs, commands, and tests are split  | [test-organization.md](reference/test-organization.md)                |
| API intercepts and the API config layer     | [api-layer-guide.md](reference/api-layer-guide.md)                    |

## Architecture

| Topic                       | Document                                                                        |
| --------------------------- | ------------------------------------------------------------------------------- |
| Harness lifecycle contract  | [harness-lifecycle-spec.md](architecture/harness-lifecycle-spec.md)             |
| Cross-tool config (4 tools) | [cross-tool-configuration.md](architecture/cross-tool-configuration.md)         |

## Guides

| Topic                                       | Document                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| TypeScript — opt-in per file                | [typescript-guide.md](guides/typescript-guide.md)                            |
| Write-time hooks: events, rules, allowlist  | [hooks-explainer.md](guides/hooks-explainer.md)                              |
| Writing custom commands                     | [support-commands-instructions.md](guides/support-commands-instructions.md)  |
| Adding or updating modules                  | [framework-maintenance-guide.md](guides/framework-maintenance-guide.md)     |
| CI pipeline setup                           | [ci-cd-guide.md](guides/ci-cd-guide.md)                                     |

## Project intake

| Topic | Document |
| ----- | -------- |
| Profile configure prompt (adapters / compose) | [../harness/profiles/configure.prompt.md](../harness/profiles/configure.prompt.md) |
| Project and module context templates | [application-intelligence](application-intelligence/README.md) |
| Requirement authoring guide       | [application-intelligence/requirement-authoring-guide.md](application-intelligence/requirement-authoring-guide.md) |

Application-specific context is created only after intake. The canonical requirement registry is
`evidence/requirements.json`.

## Decisions

An append-only log of significant technical decisions: [decisions](decisions/README.md).
