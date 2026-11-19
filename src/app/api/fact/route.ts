import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { getFact, type SavedFact } from "@/server/facts/service";
import { jsonError, unauthorized } from "@/server/http";

function toDto(fact: SavedFact) {
  return {
    id: fact.id,
    text: fact.text,
    generatedAt: fact.createdAt.toISOString(),
    // By the DB clock, so the client's countdown doesn't depend on its own clock.
    ageSeconds: fact.ageSeconds,
  };
}

// Worst case: pool wait (5s) + transaction (20s: lock wait plus OpenAI) +
// reads around it (PLAN.md 1c), with headroom, so the platform never cuts a
// request off mid-transaction.
export const maxDuration = 60;

const FALLBACK_NOTICE = "Couldn't get a new fact right now, so here's your most recent one.";

// The fact for the signed-in user's favorite movie. The user comes from the
// session; there's no parameter that could name another user.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let outcome: Awaited<ReturnType<typeof getFact>>;
  try {
    outcome = await getFact(user);
  } catch {
    // The database itself failed before anything could be read.
    return jsonError(503, "fact_unavailable", "Couldn't load your fact right now. Try again.");
  }
  switch (outcome.kind) {
    case "fresh":
    case "cached":
      return NextResponse.json({ source: outcome.kind, fact: toDto(outcome.fact) });
    case "fallback":
      return NextResponse.json({
        source: "fallback",
        fact: toDto(outcome.fact),
        notice: FALLBACK_NOTICE,
      });
    case "unavailable":
      return jsonError(
        503,
        "fact_unavailable",
        "Couldn't come up with a fact right now. Try again.",
      );
    case "no_movie":
      return jsonError(409, "no_favorite_movie", "Pick a favorite movie first.");
  }
}
