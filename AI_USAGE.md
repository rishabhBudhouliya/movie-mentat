# AI usage

Logged during the build, not reconstructed afterwards. **The author made every design decision.** AI proposed options with a recommendation, and each decision is recorded in `PLAN.md`.

## Tools
- **Claude Code (Claude Opus):** planning partner, main implementer, orchestrator.
- **Claude subagents:** a TLA+ modeling agent, and a Sonnet agent for UI components (in an isolated git worktree).
- **Codex CLI:** independent, read-only security review (a different model family, so it catches different mistakes).

## Log

| Step | What AI did | What the author did / what changed because of it |
|---|---|---|
| Constraints | Argued that AI makes code cheap but not judgment, verification, setup time, or reviewer attention. Proposed constraints that target those. | Kept the dependency budget, always-shippable, and depth-first constraints. Dropped two. |
| Research | Read and summarized Dan Luu on agentic testing and four Andrew Nesbitt articles on npm supply chain. Disclosed that it read model-written summaries, not full text. | Set the testing and dependency policies from them. |
| Auth library | Compared Auth.js (maintenance mode, v5 still beta), Better Auth, next-auth v4, and Arctic. | Chose Arctic. **Correction:** during install, pnpm flagged Arctic as deprecated by its maintainer. Claude's vetting had missed the `deprecated` field. Switched to `openid-client`, and added deprecation and provenance checks to the vetting checklist. |
| Rust idea | Explained why a Rust proof of concept wouldn't verify this design: the race is across serverless instances through Postgres, and Rust prevents shared-memory data races, not check-then-act races. | Dropped Rust in favor of TLA+. |
| TLA+ | A subagent modeled the fact-generation guard in PlusCal, checked it with TLC, and ran mutation checks so no invariant was vacuous. | Found that the timestamp-based waiter rule fails on clock ties (F1). Author approved an `attemptNo` counter plus narrowed invariants (F2, F3). The approved design passes over 9.3M states. |
| Supply chain | Vetted every package for downloads, transitive deps, license, maintainers, deprecation, provenance, and install scripts, and read install scripts before deciding. | `trustPolicy` refused the `prisma` CLI 7.10.x (published by token, no provenance; prisma/orm#30850). Author pinned 7.9.1. The author later dropped per-package pre-approval; additions are logged in `PLAN.md` for later triage. |
| UI | A Sonnet subagent built props-only components with typed state unions, in a worktree, under a brief that banned installs. | Claude reviewed the diff before merging it. |
| Auth review | Codex reviewed the auth code read-only and reported four findings. | All four fixed, with tests: (1) ID-token **signature** now verified (`enableNonRepudiationChecks`); the earlier claim of a "verified ID token" was only true for its claims. (2) `APP_URL` must be https except on localhost. (3) A stale or unsolicited callback no longer cancels the login in progress. (4) Logout requires an exact Origin match. A new test also caught a zod 4 refinement that threw instead of failing. |
| Tests | Wrote tests against real Postgres and ran mutation checks (off-by-one expiry, storing the raw token, accepting unverified email). | Each mutation was caught by a failing test. |
