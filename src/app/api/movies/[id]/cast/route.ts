import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import {
  CATALOG_CACHE_HEADERS,
  jsonError,
  parseTmdbId,
  unauthorized,
  withApiErrors,
} from "@/server/http";
import { profileUrl } from "@/server/movies/repository";
import { getTopCast } from "@/server/tmdb/client";

// A movie's top-billed cast: the directions the graph offers from it
// (decision 15). Signed-in users only, so this isn't an open TMDB proxy.
export const GET = withApiErrors(
  async (_request: NextRequest, context: RouteContext<"/api/movies/[id]/cast">) => {
    if (!(await getCurrentUser())) return unauthorized();

    const movieId = parseTmdbId((await context.params).id);
    if (movieId === null) return jsonError(400, "invalid_movie_id", "Expected a TMDB movie id.");

    const result = await getTopCast(movieId);
    if (result.kind === "unavailable") {
      return jsonError(503, "catalog_unavailable", "Movie catalog is unavailable. Try again.");
    }
    if (result.value === null) {
      return jsonError(404, "movie_not_found", "That movie isn't in the catalog.");
    }
    const cast = result.value.map((member) => ({
      personId: member.personId,
      name: member.name,
      character: member.character,
      profileUrl: profileUrl(member.profilePath),
    }));
    return NextResponse.json({ cast }, { headers: CATALOG_CACHE_HEADERS });
  },
);
