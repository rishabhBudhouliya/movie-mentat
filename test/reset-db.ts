import { db } from "@/server/db";

/** Empties every table between tests. */
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(
    "TRUNCATE fact_gen_states, facts, sessions, users, movies RESTART IDENTITY CASCADE",
  );
}
