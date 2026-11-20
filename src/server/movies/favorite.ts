import type { MovieSummary } from "@/components/types";
import type { AuthedUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getMovie, toSummary } from "@/server/tmdb/client";
import { type LookupMovie, snapshotUpsert } from "./snapshot";

export type SaveFavoriteResult =
  | { kind: "saved"; movie: MovieSummary }
  | { kind: "not_found" }
  | { kind: "catalog_unavailable" };

/**
 * Saves the signed-in user's favorite. The client sends only a catalog ID; the
 * server re-fetches the entry from TMDB, so a forged or stale ID can't save
 * made-up titles. The write is scoped to `user.id` from the session.
 */
export async function saveFavoriteMovie(
  user: AuthedUser,
  tmdbId: number,
  lookup: LookupMovie = getMovie,
): Promise<SaveFavoriteResult> {
  const found = await lookup(tmdbId);
  if (found.kind === "unavailable") return { kind: "catalog_unavailable" };
  if (found.value === null) return { kind: "not_found" };
  const movie = found.value;

  await getDb().$transaction([
    snapshotUpsert(movie),
    getDb().user.update({ where: { id: user.id }, data: { favoriteMovieId: movie.tmdbId } }),
  ]);
  return { kind: "saved", movie: toSummary(movie) };
}
