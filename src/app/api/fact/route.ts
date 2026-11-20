import { type NextRequest, NextResponse } from "next/server";
import type { TmdbId } from "@/lib/brand";
import { getCurrentUser } from "@/server/auth/current-user";
import { type FactOutcome, getFact, type SavedFact } from "@/server/facts/service";
import { jsonError, parseTmdbId, unauthorized, withApiErrors } from "@/server/http";
import { ensureMovie } from "@/server/movies/snapshot";

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
const BUSY_NOTICE = "You're loading a few facts at once, so here's your most recent one.";

// The fact for (signed-in user, movieId), for any movie in the user's graph
// (decision 17). The user comes from the session; there's no parameter that
// could name another user.
export const GET = withApiErrors(async (request: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const movieId = parseTmdbId(request.nextUrl.searchParams.get("movieId"));
  if (movieId === null) return jsonError(400, "invalid_movie_id", "Expected ?movieId=<TMDB id>.");

  // An unknown ID is checked against the catalog before it can become a row.
  const known = await ensureMovie(movieId);
  if (known.kind === "not_found") {
    return jsonError(404, "movie_not_found", "That movie isn't in the catalog.");
  }
  if (known.kind === "catalog_unavailable") {
    return jsonError(503, "catalog_unavailable", "Movie catalog is unavailable. Try again.");
  }

  let outcome: FactOutcome;
  try {
    outcome = await getFact(user, movieId as TmdbId);
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
        notice: outcome.cause === "busy" ? BUSY_NOTICE : FALLBACK_NOTICE,
      });
    case "unavailable":
      return outcome.cause === "busy"
        ? jsonError(
            429,
            "too_many_generations",
            "You're loading a few facts at once. Try this one again in a moment.",
          )
        : jsonError(503, "fact_unavailable", "Couldn't come up with a fact right now. Try again.");
    case "no_movie":
      // ensureMovie just saved it; only a concurrent delete could get here.
      return jsonError(404, "movie_not_found", "That movie isn't in the catalog.");
  }
});
