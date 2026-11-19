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

/** Resolves to a timeout result after `ms`; a rejection still propagates (F2). */
async function withDeadline(attempt: Promise<GenerateResult>, ms: number): Promise<GenerateResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<GenerateResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), ms);
  });
  try {
    return await Promise.race([attempt, deadline]);
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
  const before = await latestFact(db, user.id, movieId);
  if (before && isFresh(before)) return { kind: "cached", fact: before };
  const seenAttemptNo = (await readFailedAttempt(db, user.id, movieId))?.attempt_no ?? 0;

  try {
    return await db.$transaction(
      async (tx) => {
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

        const result = await withDeadline(
          generate({
            title: movie.title,
            releaseYear: movie.releaseYear,
            previousFact: latest?.text ?? null,
          }),
          genTimeoutMs,
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
    // Rolled back (F2) or gave up waiting for the lock (F3): nothing was
    // committed, so answer from what's saved.
    return failure(
      await latestFact(db, user.id, movieId),
      isLockTimeout(error) ? "lock_timeout" : "aborted",
    );
  }
}
