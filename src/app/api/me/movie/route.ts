import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/current-user";
import { jsonError, unauthorized } from "@/server/http";
import { saveFavoriteMovie } from "@/server/movies/favorite";

const bodySchema = z.object({ tmdbId: z.number().int().positive() });

// The user comes from the session, never from the body.
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_body", "Expected { tmdbId: number }.");

  const result = await saveFavoriteMovie(user, body.data.tmdbId);
  switch (result.kind) {
    case "saved":
      return NextResponse.json({ movie: result.movie });
    case "not_found":
      return jsonError(404, "movie_not_found", "That movie isn't in the catalog.");
    case "catalog_unavailable":
      return jsonError(503, "catalog_unavailable", "Movie catalog is unavailable. Try again.");
  }
}
