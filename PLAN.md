# Movie Memory: Plan

The exercise PDF sets the required features and deliverables. `PRODUCT_DECISIONS.md` sets the product behavior. This file records **how** we build it and **why**. Every design decision was proposed with options, and the author made the call.

## Scope

- Base experience, then **Variant A as the submitted variant**. Variant B is built on top only after A passes its gate (see `PRODUCT_DECISIONS.md`, "Gate before B").
- If time runs short, cut in this order: B extras, UI polish, video. Never cut auth, authorization, or Variant A correctness.

## Constraints

AI makes code cheap. It doesn't make design judgment, verification, setup time, or reviewer attention cheap, so the constraints target those.

1. **Every design decision goes through the author.** It's proposed as options plus a recommendation, and recorded here.
2. **Dependency budget.** Every dependency is a design decision with a written reason (see Dependencies).
3. **Always shippable.** After each checkpoint, the deployed `main` is a valid submission.
4. **Depth before breadth.** Variant A's correctness comes before any Variant B work.
5. **README written for a 20-minute reader.** Decisions and tradeoffs first, setup last.

## Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Concurrency guard | Postgres `pg_advisory_xact_lock` per (user, movie); recheck freshness after acquiring it | Works across serverless instances. Transaction-scoped, so it's safe behind Neon's transaction-mode pooler, where session-level advisory locks are not. |
| 1a | Clock | Every timestamp comes from Postgres `clock_timestamp()` | `now()` is the transaction *start* time, so it's stale after a lock wait. App-server clocks drift across instances. One clock is also what the TLA+ model assumes. |
| 1b | Waiter vs. retry | Per-(user, movie) **`attemptNo` counter**. A request reads the committed `attemptNo` before waiting for the lock. After locking, it shares a failure only if one was recorded with a higher number. | Requests that waited during a failed attempt get that attempt's outcome. A request that arrives after the failure starts a new attempt immediately. TLA+ finding F1: the original `failedAt > startedAt` timestamp rule fails on a clock tie; a counter can't tie. |
| 1c | Timeout budget | OpenAI 8s; transaction timeout about 12s; Postgres `lock_timeout` set | Prisma's defaults (5s timeout, 2s maxWait) are shorter than the OpenAI call. `lock_timeout` guarantees every request terminates. |
| 1d | Isolation | READ COMMITTED (Postgres's default). Read the state row **after** `pg_advisory_xact_lock`. | From the TLA+ model: a snapshot taken before the lock would make the recheck stale. |
| 1e | Guarantee boundaries | Waiters share only **committed** outcomes (S4′). Responses that hit `lock_timeout` are exempt and degrade to fallback or error. | TLA+ findings F2 and F3. A crashed or rolled-back holder commits nothing to share, and a longer `lock_timeout` would hold pooled connections longer. The `decided` config passes all invariants (9.3M states). |
| 2 | "New fact" button | Skips the client cache and still respects the server's 60s window | From `PRODUCT_DECISIONS.md` |
| 3 | Auth | **`openid-client`** (Google OIDC: PKCE, state, nonce, **verified ID token**) + our own session table | Auth.js is in maintenance mode and v5 is still beta. Better Auth is heavy (~17 direct deps). Arctic was chosen first, but it turned out to be deprecated by its maintainer (29 Jul 2026) along with its `@oslojs` deps. `openid-client` is OpenID-certified, has 2 deps (`jose`, `oauth4webapi`; same maintainer, 0 deps each), trusted publishing with provenance, and it verifies the ID token instead of only decoding it. We own the session code, so it gets tests. |
| 4 | Sessions | Random token in an `httpOnly`/`secure`/`sameSite=lax` cookie. The DB stores only its **SHA-256 hash**. Fixed expiry, checked on every read. POST logout deletes the row. | A DB leak doesn't yield live sessions. Logout is real revocation. Pattern from Acadia's `Users.db`. |
| 5 | Movie identity | TMDB ID + title + release year saved in Postgres | From `PRODUCT_DECISIONS.md`. Facts are keyed by catalog ID, so the two *Dune*s have separate histories. |
| 6 | Formal verification | TLA+/PlusCal, checked with TLC (`spec/`) | Checks the design before the schema is fixed. Counterexamples become tests. tla-ts was rejected: v0.0.x, three weeks old, one maintainer. |
| 7 | Database host | **Neon** Postgres, AWS us-east-1 (next to Vercel `iad1`). Pooled URL at runtime, direct URL for migrations. | Serverless-friendly pooling (PgBouncer, transaction mode), a `dev` branch separate from production, free tier, plain Postgres so no lock-in. **Accepted costs:** free-tier compute scales to zero, so the first request after idle is slow (warm it before review). The advisory-lock design holds a pooled connection for up to about 12s per generating request, which is fine at this traffic. |
| 8 | TypeScript | **6.0.3** (not 7.x) | TS 7 is the native Go port. Next.js type-checks through TypeScript's JS API, and compatibility with Next 16.4 is unverified. A reliable build matters more than the newest compiler. |
| 9 | Lint/format | **Biome** (not ESLint) | One package with zero dependencies (platform binaries only). Lints and formats, with React-hook and Next.js rules. ESLint plus `eslint-config-next` is about 40 direct deps. |
| 10 | Schema | `Movie` (TMDB ID PK, title, year, poster); `User` (`googleSub` unique, optional name/avatar, `favoriteMovieId?`); `Session` (SHA-256 `tokenHash` PK, `expiresAt`); `Fact` indexed on `(userId, movieId, createdAt DESC)`; `FactGenState` (PK `(userId, movieId)`, `attemptNo`, `failedAttemptNo?`/`failedAt?` with CHECK constraints). **No stored `lastSuccessAt`**: it's derived from the newest `Fact`. | A `Movie` table gives foreign-key integrity and keeps the user's favorite viewable during a TMDB outage. Deriving freshness makes S5 (failure never advances freshness) true by construction. |

### Type-level design (Elm / Acadia patterns)

- **Capability-typed access.** Repository functions require an `AuthedUser` that only `requireSession()` can construct. "Never take a user ID from the client" is then enforced by the compiler.
- **Branded IDs:** `UserId`, `TmdbId`, `FactId`.
- **Sum types for outcomes:** `FactOutcome = fresh | cached | fallback | unavailable`, checked exhaustively with `assertNever`. Model abstention is a structured-output union.
- **Parse, don't validate.** Zod turns input into branded types at the boundary.
- **Impossible states can't be stored.** The generation-state row uses a status enum plus a `CHECK` constraint, and is parsed into a TypeScript union at the repository boundary.
- **Explicit public data types.** Prisma rows never reach the client.
- **No FP library** (no fp-ts or Effect). A hand-written `Result` is about 10 lines.

### Pending

| # | Question | Recommendation |
|---|---|---|
| P2 | Input length limits | Search query 1–200 chars after trimming (the longest real titles are near 200) |
| P3 | Client cache (Variant B) | Hand-rolled reducer, no React Query (dependency budget, Elm architecture) |
| P4 | How a tab learns of a save made in another tab (Variant B) | Refetch on focus; decide when we reach B |

## Dependencies

- **pnpm 10.34.9** via corepack, pinned in `packageManager` with its hash. pnpm 12 ships a native binary that corepack 0.33 can't launch, and Vercel picks pnpm 9/10 for a v9 lockfile unless experimental corepack is on. 10.x has the same supply-chain controls.
- **Exact versions** only, with a **72-hour release-age cooldown**.
- **Install scripts denied by default**, with an explicit allowlist.
- **`--frozen-lockfile`** in CI and on Vercel. The lockfile changes only in a commit that adds a dependency.
- **No unpinned `dlx`/`npx`.** That includes scaffolding.
- **Agents never add a dependency.** Each one is proposed with its dependents count, transitive deps, license and maintainers, approved by the author, and committed on its own with the lockfile diff.
- **Prisma pinned to 7.9.1.** Prisma's `latest` tag currently points to an 8.0 RC. The `prisma` CLI 7.10.x is published with a token and no provenance (prisma/orm#30850), so `trustPolicy` refuses it. 7.9.1 has provenance on every Prisma package, so the policy has no exceptions.
- **Vetting checklist** for every dependency: dependents/downloads, transitive deps, license, maintainers, **deprecation status**, **trusted publishing + provenance**, and install scripts (read before deciding).
- **Reviewed and blocked install scripts:** `prisma` preinstall (Node version check only) and `@prisma/engines` postinstall (schema-engine download; the CLI fetches it on first use instead, verified).

Runtime: `next`, `react`, `@prisma/client` + `@prisma/adapter-pg` (7.9.1; `adapter-pg` because the same TCP driver works against local Docker Postgres in tests and Neon in production, and it supports the interactive transaction the advisory lock needs), `openid-client`, `zod`, `openai` (later).
Dev: `prisma` (7.9.1), `typescript` (6.0.3), `@biomejs/biome`, `tailwindcss`, `vitest` and `@vitest/coverage-v8` (later).
shadcn/ui is still to be decided. It copies component code into the repo and pulls in Radix and related packages.

## Delegation

- **Sonnet subagents** take bounded tasks that don't need decisions, each in its own git worktree with a written brief: no installs, no `npx`/`dlx`, named files only. Claude reviews every diff before the author commits.
- **Codex** independently reviews security- and correctness-critical code (sessions, fact service, TLA+ spec) before each checkpoint. A different model family catches different mistakes.
- **Claude keeps:** sessions, schema, the fact service, and every design decision.

## Testing

- **Real Postgres, not mocks.** Docker locally, a Postgres service container in CI. Time is injected via `now()`, not fake timers.
- **High coverage gate on core modules only:** fact service, concurrency guard, session/auth, validation, API client. Elsewhere, only the tests the spec requires.
- **TLA+ loop:** counterexample → failing test against the real code → fix → keep it as a regression test.
- **Mutation checks against vacuous tests** (agents tend to write tests that can't fail). Remove the guard from the spec and confirm TLC fails. Remove it from the code and confirm the parallel-request test fails.
- **CI:** GitHub Actions on the personal account, Ubuntu runners only, `cancel-in-progress`. Typecheck, lint and tests on every push.

## Build order

| Step | Work | Notes |
|---|---|---|
| 0 | Account setup (`ACCOUNT_SETUP.md`) | Author, in parallel with step 1 |
| 1 | Scaffold, pnpm policy, CI, deploy | Deploy while the app is tiny |
| 2 | Arctic auth, sessions, onboarding, dashboard | TLA+ runs in the background |
| — | **Checkpoint 1:** base app deployed | |
| 3 | Schema (decision 10), TMDB search | P2 needed for search input |
| 4 | Variant A fact service + tests | |
| — | **Checkpoint 2:** A passes its gate and is deployed. **This is a complete submission.** | |
| 5 | Variant B | Only after Checkpoint 2 |
| 6 | UI states, README, `AI_USAGE.md`, video | |

## AI usage

Logged in `AI_USAGE.md` as we go, not reconstructed at the end.
