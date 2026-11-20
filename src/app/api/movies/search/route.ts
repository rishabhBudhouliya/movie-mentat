import { type NextRequest, NextResponse } from "next/server";
import { parseMovieQuery, QUERY_MAX } from "@/lib/movie-query";
import { getCurrentUser } from "@/server/auth/current-user";
import { jsonError, unauthorized, withApiErrors } from "@/server/http";
import { searchMovies, toSummary } from "@/server/tmdb/client";

// Signed-in users only, so the endpoint can't be used as an open TMDB proxy.
export const GET = withApiErrors(async (request: NextRequest) => {
  if (!(await getCurrentUser())) return unauthorized();

  const query = parseMovieQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (query.kind === "invalid") {
    const message =
      query.reason === "empty"
        ? "Type a movie title."
        : `Movie titles can be at most ${QUERY_MAX} characters.`;
    return jsonError(400, "invalid_query", message);
  }

  const result = await searchMovies(query);
  if (result.kind === "unavailable") {
    return jsonError(503, "catalog_unavailable", "Movie search is unavailable. Try again.");
  }
  return NextResponse.json({ movies: result.value.map(toSummary) });
});
