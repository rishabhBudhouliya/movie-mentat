import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import {
  CATALOG_CACHE_HEADERS,
  jsonError,
  parseTmdbId,
  unauthorized,
  withApiErrors,
} from "@/server/http";
import { getLeadingFilms, toSummary } from "@/server/tmdb/client";

// Films where this person had a leading role: where a direction leads
// (decision 15). Signed-in users only, so this isn't an open TMDB proxy.
export const GET = withApiErrors(
  async (_request: NextRequest, context: RouteContext<"/api/people/[id]/films">) => {
    if (!(await getCurrentUser())) return unauthorized();

    const personId = parseTmdbId((await context.params).id);
    if (personId === null) return jsonError(400, "invalid_person_id", "Expected a TMDB person id.");

    const result = await getLeadingFilms(personId);
    if (result.kind === "unavailable") {
      return jsonError(503, "catalog_unavailable", "Movie catalog is unavailable. Try again.");
    }
    if (result.value === null) {
      return jsonError(404, "person_not_found", "That person isn't in the catalog.");
    }
    return NextResponse.json(
      { films: result.value.map(toSummary) },
      { headers: CATALOG_CACHE_HEADERS },
    );
  },
);
