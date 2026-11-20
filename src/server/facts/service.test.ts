import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TmdbId, UserId } from "@/lib/brand";
import { createSession, getSessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { resetDb } from "../../../test/reset-db";
import type { FactGenerator, GenerateResult } from "./generator";
import {
  type FactOutcome,
  FRESH_WINDOW_S,
  getFact,
  isFresh,
  latestFact,
  type SavedFact,
} from "./service";

// The proposed tests from spec/README.md, against real Postgres with OpenAI
// stubbed. Test names cite the invariant or finding they come from.

const db = getDb();
const DUNE = 438631;
const DUNE_ID = DUNE as TmdbId;

async function userWithFavorite(sub: string, movieId = DUNE) {
  await db.movie.upsert({
    where: { tmdbId: movieId },
    create: { tmdbId: movieId, title: "Dune", releaseYear: 2021 },
    update: {},
  });
  const row = await db.user.create({
    data: { googleSub: sub, email: `${sub}@example.com`, favoriteMovieId: movieId },
  });
  const user = await getSessionUser((await createSession(row.id as UserId)).token);
  if (!user) throw new Error("expected a session user");
  return user;
}

/** Inserts a fact that is `ageSeconds` old by the DB clock. */
async function seedFact(userId: string, ageSeconds: number, text = "seeded fact", movieId = DUNE) {
  await db.$executeRaw`
    INSERT INTO facts (id, user_id, movie_id, text, created_at)
    VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${movieId}, ${text},
            clock_timestamp() - make_interval(secs => ${ageSeconds}))`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stub generator that counts calls and answers after `delayMs`. */
function stubGenerator(answer: GenerateResult | (() => GenerateResult), delayMs = 0) {
  return vi.fn<FactGenerator>(async () => {
    await sleep(delayMs);
    return typeof answer === "function" ? answer() : answer;
  });
}

const factCount = () => db.fact.count();
const ok = (text = "A fresh fact.") => ({ kind: "fact", text }) as const;

describe("getFact: 60-second cache window", () => {
  beforeEach(resetDb);

  it("generates, stores, and returns a fact when there is none", async () => {
    const user = await userWithFavorite("a");
    const generate = stubGenerator(ok());

    const outcome = await getFact(user, DUNE_ID, generate);

    expect(outcome).toMatchObject({ kind: "fresh", fact: { text: "A fresh fact." } });
    expect(generate).toHaveBeenCalledOnce();
    expect(await factCount()).toBe(1);
  });

  it("S3 boundary: a fact under 60s old is returned without calling OpenAI", async () => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, FRESH_WINDOW_S - 0.5);
    const generate = stubGenerator(ok());

    expect(await getFact(user, DUNE_ID, generate)).toMatchObject({
      kind: "cached",
      fact: { text: "seeded fact" },
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("S3 boundary: at 60s the fact is eligible and a new one is generated", async () => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, FRESH_WINDOW_S);
    const generate = stubGenerator(ok());

    expect(await getFact(user, DUNE_ID, generate)).toMatchObject({ kind: "fresh" });
    expect(generate.mock.calls[0]?.[0]).toEqual({
      title: "Dune",
      releaseYear: 2021,
      previousFact: "seeded fact", // asks for a different detail
    });
  });

  it("S3 exact boundary: 59.999s is fresh, exactly 60s is not", () => {
    const aged = (ageSeconds: number) => ({ ageSeconds }) as SavedFact;
    expect(isFresh(aged(FRESH_WINDOW_S - 0.001))).toBe(true);
    expect(isFresh(aged(FRESH_WINDOW_S))).toBe(false);
    expect(isFresh(null)).toBe(false);
  });

  it("G1: age uses clock_timestamp(), so time spent inside a transaction counts", async () => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, FRESH_WINDOW_S - 0.5);

    const age = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_sleep(1)`;
      return (await latestFact(tx, user.id, DUNE))?.ageSeconds;
    });

    expect(age).toBeGreaterThanOrEqual(FRESH_WINDOW_S); // with now() it would still read 59.5
  });
});

describe("getFact: burst protection (advisory lock)", () => {
  beforeEach(resetDb);

  it("S2: three simultaneous requests make one OpenAI call and store one fact", async () => {
    const user = await userWithFavorite("a");
    const generate = stubGenerator(ok(), 200);

    const outcomes = await Promise.all([
      getFact(user, DUNE_ID, generate),
      getFact(user, DUNE_ID, generate),
      getFact(user, DUNE_ID, generate),
    ]);

    expect(generate).toHaveBeenCalledOnce();
    expect(await factCount()).toBe(1);
    const ids = outcomes.map((o) => (o.kind === "fresh" || o.kind === "cached" ? o.fact.id : null));
    expect(new Set(ids).size).toBe(1);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["cached", "cached", "fresh"]);
  });

  it("S4: a request that waited on a failing attempt shares its failure instead of retrying", async () => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, 120, "old fact");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn<FactGenerator>(async () => {
      await gate;
      return { kind: "error" };
    });

    const first = getFact(user, DUNE_ID, generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce()); // first holds the lock
    const waiter = getFact(user, DUNE_ID, generate); // starts while the attempt is in flight
    await sleep(100);
    release();

    expect(await first).toMatchObject({
      kind: "fallback",
      cause: "error",
      fact: { text: "old fact" },
    });
    expect(await waiter).toMatchObject({
      kind: "fallback",
      cause: "shared",
      fact: { text: "old fact" },
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("S7: a request made after a failure was committed retries immediately", async () => {
    const user = await userWithFavorite("a");
    const failing = stubGenerator({ kind: "timeout" });
    expect(await getFact(user, DUNE_ID, failing)).toEqual({
      kind: "unavailable",
      cause: "timeout",
    });

    const succeeding = stubGenerator(ok());
    expect(await getFact(user, DUNE_ID, succeeding)).toMatchObject({ kind: "fresh" });
    expect(succeeding).toHaveBeenCalledOnce();
  });

  it("F2: if the holder's transaction rolls back, a waiter generates itself", async () => {
    const user = await userWithFavorite("a");
    let calls = 0;
    const generate = vi.fn<FactGenerator>(async () => {
      calls += 1;
      if (calls === 1) {
        await sleep(150);
        throw new Error("process died mid-attempt");
      }
      return ok("Second try.");
    });

    const [first, second] = await Promise.all([
      getFact(user, DUNE_ID, generate),
      (async () => {
        await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
        return getFact(user, DUNE_ID, generate);
      })(),
    ]);

    expect(first).toEqual({ kind: "unavailable", cause: "aborted" });
    expect(second).toMatchObject({ kind: "fresh", fact: { text: "Second try." } });
    expect(await factCount()).toBe(1);
  });

  it("L1/G3: a hung OpenAI call is cut off at the deadline, waiters give up at lock_timeout, and the lock is reusable", async () => {
    const user = await userWithFavorite("a");
    const options = { lockTimeout: "300ms", genTimeoutMs: 800 };
    const hung = vi.fn<FactGenerator>(() => new Promise<GenerateResult>(() => {}));

    const holder = getFact(user, DUNE_ID, hung, options);
    await vi.waitFor(() => expect(hung).toHaveBeenCalledOnce());
    const waiter = await getFact(user, DUNE_ID, hung, options);
    expect(waiter).toEqual({ kind: "unavailable", cause: "lock_timeout" });

    expect(await holder).toEqual({ kind: "unavailable", cause: "timeout" });
    const next = await getFact(user, DUNE_ID, stubGenerator(ok()), options);
    expect(next).toMatchObject({ kind: "fresh" });
  });
});

describe("getFact: transaction deadline (Codex review)", () => {
  beforeEach(resetDb);

  it("S2 under expiry: the OpenAI call is aborted before the transaction can expire", async () => {
    const user = await userWithFavorite("a");
    let seenSignal: AbortSignal | undefined;
    const hung = vi.fn<FactGenerator>((_prompt, signal) => {
      seenSignal = signal;
      return new Promise<GenerateResult>(() => {});
    });

    // 3s transaction, 2s reserved for the commit: the call gets about 1s, not 10s.
    const started = Date.now();
    const outcome = await getFact(user, DUNE_ID, hung, {
      txTimeoutMs: 3_000,
      genTimeoutMs: 10_000,
    });

    expect(outcome).toEqual({ kind: "unavailable", cause: "timeout" }); // committed, not rolled back
    expect(seenSignal?.aborted).toBe(true); // the fetch is cancelled, not left running
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("getFact: database pool acquisition", () => {
  beforeEach(resetDb);

  it("bounds the wait for a read before the transaction when the pool is full", async () => {
    const user = await userWithFavorite("pool");
    const generate = stubGenerator(ok());
    let release = () => {};
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    // node-postgres defaults to ten connections per pool.
    const poolSize = 10;
    let acquired = 0;
    const holders = Array.from({ length: poolSize }, () =>
      db.$transaction(
        async () => {
          acquired += 1;
          await waitForRelease;
        },
        { timeout: 12_000 },
      ),
    );
    const held = Promise.all(holders);
    try {
      await Promise.race([vi.waitFor(() => expect(acquired).toBe(poolSize)), held]);
      const start = Date.now();
      await expect(getFact(user, DUNE_ID, generate)).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(8_000);
      expect(generate).not.toHaveBeenCalled();
    } finally {
      release();
      await held;
    }
    expect(await getFact(user, DUNE_ID, generate)).toMatchObject({ kind: "fresh" });
  }, 15_000);
});

describe("getFact: failure handling", () => {
  beforeEach(resetDb);

  it.each<[string, GenerateResult]>([
    ["timeout", { kind: "timeout" }],
    ["error", { kind: "error" }],
    ["abstained", { kind: "abstained" }],
  ])("S6: on %s, returns the most recent saved fact", async (cause, result) => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, 300, "last good fact");

    expect(await getFact(user, DUNE_ID, stubGenerator(result))).toMatchObject({
      kind: "fallback",
      cause,
      fact: { text: "last good fact" },
    });
  });

  it("S6: with nothing saved, returns unavailable (shown as a retryable error)", async () => {
    const user = await userWithFavorite("a");

    expect(await getFact(user, DUNE_ID, stubGenerator({ kind: "error" }))).toEqual({
      kind: "unavailable",
      cause: "error",
    });
  });

  it("S5: a failure stores nothing, so freshness doesn't advance", async () => {
    const user = await userWithFavorite("a");
    await seedFact(user.id, 300);

    await getFact(user, DUNE_ID, stubGenerator({ kind: "error" }));

    expect(await factCount()).toBe(1);
    expect((await latestFact(db, user.id, DUNE))?.ageSeconds).toBeGreaterThanOrEqual(300);
  });

  it("returns no_movie for a movie we hold no snapshot of", async () => {
    const row = await db.user.create({ data: { googleSub: "x", email: "x@example.com" } });
    const user = await getSessionUser((await createSession(row.id as UserId)).token);
    if (!user) throw new Error("expected a session user");
    const generate = stubGenerator(ok());

    expect(await getFact(user, 999_999 as TmdbId, generate)).toEqual({ kind: "no_movie" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("getFact: authorization (S1)", () => {
  beforeEach(resetDb);

  it("never returns another user's fact for the same movie, cached or fallback", async () => {
    const ada = await userWithFavorite("ada");
    const bob = await userWithFavorite("bob");
    await seedFact(bob.id, 1, "bob's fresh fact");

    // Bob has a fresh fact for Dune; Ada still gets her own generation.
    const fresh = await getFact(ada, DUNE_ID, stubGenerator(ok("Ada's fact.")));
    expect(fresh).toMatchObject({ kind: "fresh", fact: { text: "Ada's fact." } });

    // And when Ada's generation fails with nothing of her own saved, she gets
    // an error, not Bob's fact.
    await resetDb();
    const ada2 = await userWithFavorite("ada2");
    const bob2 = await userWithFavorite("bob2");
    await seedFact(bob2.id, 300, "bob's old fact");
    const failed: FactOutcome = await getFact(ada2, DUNE_ID, stubGenerator({ kind: "error" }));
    expect(failed).toEqual({ kind: "unavailable", cause: "error" });
  });
});

const ARRIVAL = 329865 as TmdbId;
const HER = 152601 as TmdbId;

async function addMovie(tmdbId: TmdbId, title: string) {
  await db.movie.create({ data: { tmdbId, title, releaseYear: 2016 } });
}

/** A generator that holds until `release()` is called, then answers. */
function heldGenerator(text: string) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = vi.fn<FactGenerator>(async () => {
    await released;
    return ok(text);
  });
  return { generate, release: () => release() };
}

/** Polls until `n` OpenAI calls have started. */
async function untilCalls(generate: { mock: { calls: unknown[] } }, n: number) {
  for (let i = 0; i < 200 && generate.mock.calls.length < n; i += 1) await sleep(10);
  expect(generate.mock.calls.length).toBe(n);
}

describe("getFact: any movie in the graph (decision 17)", () => {
  beforeEach(resetDb);

  it("answers for a movie that isn't the favorite, with its own history", async () => {
    const user = await userWithFavorite("a");
    await addMovie(ARRIVAL, "Arrival");
    await seedFact(user.id, 1, "fresh Dune fact");

    const arrival = await getFact(user, ARRIVAL, stubGenerator(ok("An Arrival fact.")));

    expect(arrival).toMatchObject({ kind: "fresh", fact: { text: "An Arrival fact." } });
    // Dune's fresh fact neither answered for Arrival nor was replaced by it.
    expect((await latestFact(db, user.id, DUNE))?.text).toBe("fresh Dune fact");
  });
});

describe("getFact: per-user generation slots (decision 18)", () => {
  beforeEach(resetDb);

  it("a third simultaneous generation for another movie is busy, and writes nothing", async () => {
    const user = await userWithFavorite("a");
    await addMovie(ARRIVAL, "Arrival");
    await addMovie(HER, "Her");
    const held = heldGenerator("held");

    const first = getFact(user, DUNE_ID, held.generate);
    const second = getFact(user, ARRIVAL, held.generate);
    await untilCalls(held.generate, 2);

    const third = stubGenerator(ok());
    expect(await getFact(user, HER, third)).toEqual({ kind: "unavailable", cause: "busy" });
    expect(third).not.toHaveBeenCalled();
    // No attempt was claimed for Her, so nothing can be shared as a failure.
    expect(await db.factGenState.count({ where: { movieId: HER } })).toBe(0);

    held.release();
    await Promise.all([first, second]);
    // With the slots free again, Her generates normally.
    expect(await getFact(user, HER, stubGenerator(ok()))).toMatchObject({ kind: "fresh" });
  });

  it("busy falls back to the saved fact when there is one", async () => {
    const user = await userWithFavorite("a");
    await addMovie(ARRIVAL, "Arrival");
    await seedFact(user.id, 300, "an old Dune fact");
    const held = heldGenerator("held");

    const holder = getFact(user, ARRIVAL, held.generate);
    await untilCalls(held.generate, 1);

    expect(await getFact(user, DUNE_ID, stubGenerator(ok()), { generationSlots: 1 })).toMatchObject(
      { kind: "fallback", cause: "busy", fact: { text: "an old Dune fact" } },
    );
    held.release();
    await holder;
  });

  it("requests waiting on a movie's lock don't hold a slot", async () => {
    const user = await userWithFavorite("a");
    await addMovie(ARRIVAL, "Arrival");
    const held = heldGenerator("Dune, generated once.");

    const holder = getFact(user, DUNE_ID, held.generate); // slot 1, generating
    await untilCalls(held.generate, 1);
    const waiter = getFact(user, DUNE_ID, held.generate); // waits on Dune's lock, no slot
    await sleep(100);

    // Slot 2 is still free for another movie.
    expect(await getFact(user, ARRIVAL, stubGenerator(ok()))).toMatchObject({ kind: "fresh" });

    held.release();
    expect(await holder).toMatchObject({ kind: "fresh" });
    expect(await waiter).toMatchObject({ kind: "cached", fact: { text: "Dune, generated once." } });
    expect(held.generate).toHaveBeenCalledOnce();
  });

  it("slots are per user: another user's generations don't count", async () => {
    const ada = await userWithFavorite("ada");
    const bob = await userWithFavorite("bob");
    await addMovie(ARRIVAL, "Arrival");
    const held = heldGenerator("held");

    const busyAda = [getFact(ada, DUNE_ID, held.generate), getFact(ada, ARRIVAL, held.generate)];
    await untilCalls(held.generate, 2);

    expect(await getFact(bob, DUNE_ID, stubGenerator(ok()))).toMatchObject({ kind: "fresh" });
    held.release();
    await Promise.all(busyAda);
  });
});
