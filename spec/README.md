# Fact generation: TLA+ model

`FactGeneration.tla` (PlusCal) models Variant A's fact endpoint: a 60-second cache, a per-(user, movie) `pg_advisory_xact_lock`, a recheck after locking, a nondeterministic OpenAI call, and commit-then-release. It checks the approved invariants S1–S7 and L1 (definitions are at the bottom of the `.tla`).

**Run:** `./mkcfg.sh && ./run.sh <config>` (configs are in `cfg/`, outputs in `results/`). Uses TLC from `tla2tools.jar` **v1.7.4** (TLC2 2.19, 2024-08-08), sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. Download it to `tools/`. Java 17.

## Bounds and abstractions
- 2 users × 2 movies × 3 requests. Each request's session (user, movie) is chosen nondeterministically, so every combination is checked.
- A single discrete DB clock (G1). Scaled times: **W = 3** (60 s), **OpenAI timeout = 1**, **lock_timeout = 2**, horizon 5. Only the relation OpenAI timeout < lock_timeout < W matters.
- Postgres behavior that is modeled: a free lock is granted at once, waiters queue FIFO, and a recheck takes no time. Rollback and process death release the lock and commit nothing (G3).
- **Not covered (the model-vs-code gap):** Prisma, HTTP, and Next.js; isolation levels (the code must use READ COMMITTED and read the state row *after* taking the lock); hash collisions in the lock key (these only serialize); more than 3 requests; real latency. Each label is assumed to be one atomic DB step. Tests against real Postgres have to cover these.

## Spec action → planned TypeScript step
| Action | Code |
|---|---|
| `Begin` | `startedAt = clock_timestamp()` (or `seenNo = attemptNo`), then a fast-path read of the state row |
| `Lock` | `$transaction(..., {timeout, maxWait})`: `SET LOCAL lock_timeout`, then `pg_advisory_xact_lock(user, movie)` |
| `Recheck` | Re-read the state row with `clock_timestamp()`: fresh → cached; newer failure → shared; else generate |
| `Gen` success / failure | Insert `Fact` and set `lastSuccessAt`, or set `failedAt`. Commit, which releases the lock |
| `Gen` abort / crash | Prisma tx timeout → catch → fallback/error; a dropped connection releases the lock |

## Results
| Config | Result | Distinct states |
|---|---|---|
| `base` (G2 timestamps, aborts on) = **the design as decided** | **S4 violated** (F1, F2) | 30,739 |
| `timestamp-noabort` | **S4 violated** (F1) | 22,739 |
| `timestamp-noabort-exceptS4` | pass S1–S3, S5–S7, L1 | 2,333,380 |
| `counter` (aborts on) | **S4 violated** (F2) | 30,786 |
| `counter-abort-exceptS4` | pass S1–S3, S5–S7, L1 | 9,333,400 |
| `counter-noabort` | **pass, all invariants** | 2,095,192 |
| `counter-abort-S4committed` (proposed S4′) | **violated** via lock_timeout (F3) | 799,108 |
| **`decided`**: counter (F1) + S4′ (F2) + exemptions for lock_timeout (F3) and pool timeout (F4), **with pool timeouts and aborts enabled** = **the approved design** | **pass**: S1–S3, S4Final, S6, S7, S5, L1 | 13,297,148 |
| `decided-F4-lockOnly` (non-vacuity check: only the F3 exemption) | S4FinalLockOnly violated in 7 steps, as expected | 23,472 |
| `decided-timestamp-F1` (non-vacuity check) | S4Final violated, as expected | 23,693 |
| `decided-mut-noCmp` (non-vacuity check) | S7 violated, as expected | 31,300 |

Mutations, all run on `counter-noabort`, which passes. Every invariant is broken by at least one mutation, so none is vacuous:

| Mutation | Caught by | Mutation | Caught by |
|---|---|---|---|
| (a) no advisory lock | S2 | (f) fact query without the user filter | S1 |
| (b) no post-lock recheck | S3 | (g) `<= W` instead of `< W` | S3 |
| (c) failure advances `lastSuccessAt` | S5 | (h) failure always returns an error | S6 |
| (d) `now()` instead of `clock_timestamp()` | S3 (counter), S4 (timestamps) | (i) lock leaked on failure | S4. **L1 still holds** (lock_timeout) |
| (e) no `failedAt > startedAt` check | S7 | (i)+(j) leaked lock and no lock_timeout | L1 (deadlock) |

Witnesses (each must be violated, which proves the scenario is reachable): shared failure, fallback, retry after failure, waiter served cached, regeneration after expiry. All 5 are reached.

## Findings (all resolved; the approved design is the `decided` config)
- **F1, G2 timestamp ties.** r2 starts at t=0 while r1 is generating. r1 fails with `failedAt = 0`, so `0 > 0` is false and r2 starts its own attempt. With real Postgres this needs the DB wall clock to fail to advance between the two reads (µs resolution, or an NTP step backward). It's rare, but it isn't guaranteed. **Proposal:** order failures with a per-(user, movie) `attemptNo` counter instead of timestamps (`counter` configs). That removes any dependence on the clock.
- **F2, rollback or crash with S4 as written.** The holder's transaction rolls back, nothing is committed, and the waiter starts its own attempt. Any design behaves this way: there is no outcome to share. **Proposal:** S4′ says S4 applies only to committed outcomes.
- **F3, lock_timeout after an abort.** r1 aborts, r2 (waiting) generates, and r3, queued behind both, hits lock_timeout. Its response is fallback/error (S6 holds), but it didn't get r2's outcome. **Proposal:** either exempt lock-timeout responses from S4′, or set lock_timeout ≥ tx timeout + OpenAI timeout.

- **F4, connection-pool timeout (found by the Codex review of the code).** Prisma's `maxWait` can fire while a request waits for a pooled connection, before it reaches the advisory lock. That is a third way to give up while waiting, and without an exemption it breaks S4 (`decided-F4-lockOnly`). **Resolution (author):** exempt it like F3. The model lets a waiter give up at any time (`AllowPoolTimeout`). In both timeout branches, a fact saved meanwhile by another request is returned as a cache hit, matching the code's recovery path.

## Proposed tests (fact service vs. real Postgres, OpenAI stubbed)
1. **S2, from (a):** 3 parallel requests, same user and movie, no fact, stub succeeds after 200 ms → 1 OpenAI call, 1 `Fact` row, all 3 responses carry the same fact id.
2. **S3, from (b):** 2 parallel requests, the first succeeds → the second returns `cached` with the first's id, with no second OpenAI call.
3. **S4, from F1:** request B starts while A is generating, and A's stub fails → B returns A's failure (fallback if an older fact exists, else error). 1 OpenAI call.
4. **S7, from (e):** after a committed failure, a new request with no fresh fact → a second OpenAI call.
5. **S3 boundary, from (g):** seed `lastSuccessAt = clock_timestamp() - 59.9s` → cached; `- 60s` → generates.
6. **G1, from (d):** in one transaction, seed a fact at `clock_timestamp() - 59.5s`, `pg_sleep(1)`, run the freshness query → stale (with `now()` it would say fresh).
7. **S1 / authorization, from (f):** u2 has a fresh fact for m1. u1 requests m1 → u1 never receives u2's fact. Also when u1's stub fails with no fact of its own → error, not u2's fact.
8. **S6, from (h):** an expired fact plus a failing stub → `fallback` with that fact id and the failure disclosed. No fact plus a failing stub → retryable error.
9. **S5, from (c):** after a failure, `lastSuccessAt` is unchanged in the DB.
10. **L1/G3, from (i)/(j):** a holder whose stub never resolves gets rolled back by the tx timeout. Waiters respond within lock_timeout, and the next request can take the lock.
11. **F2:** a holder throws inside the transaction after locking → the waiter calls OpenAI itself (documents S4′).
