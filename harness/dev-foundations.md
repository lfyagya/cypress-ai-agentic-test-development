## Engineering foundations

- **Tests first.** A behavior is done when a test that failed before the change passes after it.
- **The project's standard is the floor.** Lint, type-check and tests (`wiring.verifyScript`) pass on
  every change; the git gate runs them before push and CI runs them on the PR.
- **New and changed code obeys every rule.** Legacy findings recorded in `evidence/rule-baseline.json`
  pass until their line is touched; the baseline only ever shrinks.
- **Exceptions are explicit.** A genuine exception is a human-recorded waiver with a reason, an owner
  and an expiry. Trust boundaries (secrets, read-only production) are never waived.
- **Smallest correct change.** Reuse before adding; delete before abstracting; fix the root cause once,
  where every caller routes through it.
