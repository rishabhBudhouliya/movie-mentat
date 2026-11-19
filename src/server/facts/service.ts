import { Prisma } from "@/generated/prisma/client";
import type { FactId, TmdbId } from "@/lib/brand";
import type { AuthedUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import {
  type FactGenerator,
  type GenerateResult,
  generateWithOpenAI,
  OPENAI_TIMEOUT_MS,
} from "./generator";

// Variant A: 60-second cache, burst protection, failure handling.
// This is the design verified in spec/FactGeneration.tla (`decided` config);
// comments name the spec action each step implements. PLAN.md decisions 1–1e.

export const FRESH_WINDOW_S = 60;

const DEFAULTS = {
  // Must exceed the OpenAI timeout (8s) and stay below the window (spec: GenTimeout < LockTimeout < W).
  lockTimeout: "10s",
  // A waiter may wait out lock_timeout and then generate itself (TLA+ F2): 10s + 8s, plus slack.
  txTimeoutMs: 20_000,
  // Enforced here too, not just inside the OpenAI call: a generator that never
  // settles would otherwise hold the lock and the transaction forever (L1).
  genTimeoutMs: OPENAI_TIMEOUT_MS,
};
// Time kept back at the end of the transaction for writing the outcome, so the
// OpenAI call always ends before the transaction can expire (Codex review):
// expiry releases the lock, and a still-running call would break S2.
const COMMIT_RESERVE_MS = 2_000;
export type FactServiceOptions = Partial<typeof DEFAULTS>;

export type SavedFact = { id: FactId; text: string; createdAt: Date; ageSeconds: number };

/** Why no new fact was produced. */
export type FailureCause =
  | "timeout" // OpenAI didn't answer within 8s
  | "error" // OpenAI returned an error
  | "abstained" // the model wasn't confident (or refused)
  | "shared" // another request's attempt just failed and we waited on it (S4)
  | "lock_timeout" // waited too long behind other attempts (exempt from S4, F3)
  | "aborted"; // our transaction rolled back (F2)

export type FactOutcome =
  | { kind: "fresh"; fact: SavedFact }
  | { kind: "cached"; fact: SavedFact }
  | { kind: "fallback"; fact: SavedFact; cause: FailureCause }
  | { kind: "unavailable"; cause: FailureCause }
  | { kind: "no_movie" };

type Db = Prisma.TransactionClient | ReturnType<typeof getDb>;

type FactRow = { id: string; text: string; created_at: Date; age_seconds: number };

/**
 * The newest saved fact for (user, movie) and its age by the DB clock.
 * clock_timestamp(), not now(): inside a transaction now() is frozen at the
 * start, so after a lock wait it would make a stale fact look fresh (G1).
 */
export async function latestFact(
  db: Db,
  userId: string,
  movieId: number,
): Promise<SavedFact | null> {
  const rows = await db.$queryRaw<FactRow[]>`
    SELECT id::text, text, created_at,
           EXTRACT(EPOCH FROM clock_timestamp() - created_at)::float8 AS age_seconds
    FROM facts
    WHERE user_id = ${userId}::uuid AND movie_id = ${movieId}
    ORDER BY created_at DESC
    LIMIT 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id as FactId,
        text: row.text,
        createdAt: row.created_at,
        ageSeconds: row.age_seconds,
      }
    : null;
}

/**
 * Begin (one atomic step in the model): the latest fact and the committed
 * attempt counter, read in a single statement so they come from one READ
 * COMMITTED snapshot. Two separate reads could straddle another request's
 * commit and mislabel a failure we waited on as one we'd already seen.
 */
async function readBegin(db: Db, userId: string, movieId: number) {
  const rows = await db.$queryRaw<(Partial<FactRow> & { seen_attempt_no: number })[]>`
    SELECT f.id::text, f.text, f.created_at,
           EXTRACT(EPOCH FROM clock_timestamp() - f.created_at)::float8 AS age_seconds,
           COALESCE((SELECT attempt_no FROM fact_gen_states
                     WHERE user_id = ${userId}::uuid AND movie_id = ${movieId}), 0) AS seen_attempt_no
    FROM (SELECT 1) AS one
    LEFT JOIN LATERAL (
      SELECT id, text, created_at FROM facts
      WHERE user_id = ${userId}::uuid AND movie_id = ${movieId}
      ORDER BY created_at DESC
      LIMIT 1
    ) AS f ON true`;
  const row = rows[0];
  const latest: SavedFact | null =
    row?.id && row.text !== undefined && row.created_at && row.age_seconds !== undefined
      ? {
          id: row.id as FactId,
          text: row.text,
          createdAt: row.created_at,
          ageSeconds: row.age_seconds,
        }
      : null;
  return { latest, seenAttemptNo: row?.seen_attempt_no ?? 0 };
}

async function readFailedAttempt(db: Db, userId: string, movieId: number) {
  const rows = await db.$queryRaw<{ attempt_no: number; failed_attempt_no: number | null }[]>`
    SELECT attempt_no, failed_attempt_no FROM fact_gen_states
    WHERE user_id = ${userId}::uuid AND movie_id = ${movieId}`;
  return rows[0] ?? null;
}

/** The 60s rule: younger than 60s is fresh; at exactly 60s it may be replaced. */
export function isFresh(fact: SavedFact | null): boolean {
  return fact !== null && fact.ageSeconds < FRESH_WINDOW_S;
}

/**
 * Runs the generator with a hard deadline. At the deadline the call is
 * aborted (not just abandoned) and the result is a timeout. A rejection still
 * propagates and rolls the attempt back (F2).
 */
async function withDeadline(
  run: (signal: AbortSignal) => Promise<GenerateResult>,
  ms: number,
): Promise<GenerateResult> {
  if (ms <= 0) return { kind: "timeout" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<GenerateResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("deadline", "TimeoutError"));
      resolve({ kind: "timeout" });
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** S6: on failure, the latest saved fact if there is one, otherwise unavailable. */
function failure(latest: SavedFact | null, cause: FailureCause): FactOutcome {
  return latest ? { kind: "fallback", fact: latest, cause } : { kind: "unavailable", cause };
}

function isLockTimeout(error: unknown): boolean {
  // Postgres 55P03 (lock_not_available), surfaced through Prisma's driver adapter.
  return /55P03|lock timeout/i.test(
    error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "",
  );
}

/**
 * The fact for the signed-in user's favorite movie. Every query is scoped to
 * `user.id` from the session (S1); there is no way to ask for another user's.
 */
export async function getFact(
  user: AuthedUser,
  generate: FactGenerator = generateWithOpenAI,
  options: FactServiceOptions = {},
): Promise<FactOutcome> {
  const { lockTimeout, txTimeoutMs, genTimeoutMs } = { ...DEFAULTS, ...options };
  const movieId: TmdbId | null = user.favoriteMovieId;
  if (movieId === null) return { kind: "no_movie" };
  const db = getDb();
  const movie = await db.movie.findUnique({ where: { tmdbId: movieId } });
  if (!movie) return { kind: "no_movie" };

  // Begin: fast path without the lock, and note which attempts were committed
  // before we started waiting (F1: ordered by counter, not by timestamp).
  const { latest: before, seenAttemptNo } = await readBegin(db, user.id, movieId);
  if (before && isFresh(before)) return { kind: "cached", fact: before };

  try {
    return await db.$transaction(
      async (tx) => {
        const txExpiresAt = Date.now() + txTimeoutMs;
        // Lock: one attempt per (user, movie) at a time, across all server instances.
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), ${movieId})::text`;

        // Recheck: read state only now, after the lock (READ COMMITTED sees
        // everything committed by whoever held it before us).
        const latest = await latestFact(tx, user.id, movieId);
        if (latest && isFresh(latest))
          return { kind: "cached", fact: latest } satisfies FactOutcome;

        const state = await readFailedAttempt(tx, user.id, movieId);
        if (state?.failed_attempt_no != null && state.failed_attempt_no > seenAttemptNo) {
          return failure(latest, "shared"); // S4: an attempt we waited on just failed
        }

        // Gen: claim the next attempt number, then call OpenAI while holding the lock.
        const [claimed] = await tx.$queryRaw<{ attempt_no: number }[]>`
          INSERT INTO fact_gen_states (user_id, movie_id, attempt_no)
          VALUES (${user.id}::uuid, ${movieId}, 1)
          ON CONFLICT (user_id, movie_id)
          DO UPDATE SET attempt_no = fact_gen_states.attempt_no + 1
          RETURNING attempt_no`;
        const attemptNo = claimed?.attempt_no;
        if (attemptNo === undefined) throw new Error("attempt not claimed");

        // However long the lock wait took, the call must end before the
        // transaction can expire, leaving time to write the outcome.
        const budgetMs = Math.min(genTimeoutMs, txExpiresAt - Date.now() - COMMIT_RESERVE_MS);
        const result = await withDeadline(
          (signal) =>
            generate(
              {
                title: movie.title,
                releaseYear: movie.releaseYear,
                previousFact: latest?.text ?? null,
              },
              signal,
            ),
          budgetMs,
        );

        if (result.kind === "fact") {
          const saved = await tx.fact.create({
            data: { userId: user.id, movieId, text: result.text },
          });
          const fact: SavedFact = {
            id: saved.id as FactId,
            text: saved.text,
            createdAt: saved.createdAt,
            ageSeconds: 0,
          };
          return { kind: "fresh", fact } satisfies FactOutcome;
        }

        // Record the failure and commit it before the lock is released, so
        // requests waiting on this attempt share its outcome (S4). Freshness
        // isn't touched: it's derived from saved facts only (S5).
        await tx.$executeRaw`
          UPDATE fact_gen_states
          SET failed_attempt_no = ${attemptNo}, failed_at = clock_timestamp()
          WHERE user_id = ${user.id}::uuid AND movie_id = ${movieId}`;
        return failure(latest, result.kind);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: txTimeoutMs,
        maxWait: 5_000,
      },
    );
  } catch (error) {
    // Rolled back (F2), gave up at lock_timeout (F3), or never got a pooled
    // connection: nothing of ours was committed, so answer from what's saved.
    let latest = before;
    try {
      latest = await latestFact(db, user.id, movieId);
    } catch {
      // The database is struggling; the fact read at Begin is still valid.
    }
    // Someone else may have just succeeded: that's a cache hit, not a failure.
    if (latest && isFresh(latest)) return { kind: "cached", fact: latest };
    return failure(latest, isLockTimeout(error) ? "lock_timeout" : "aborted");
  }
}
