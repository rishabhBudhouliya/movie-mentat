import type { MovieSummary } from "@/components/types";
import type { AuthedUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { type CatalogMovie, type CatalogResult, getMovie, toSummary } from "@/server/tmdb/client";

export type SaveFavoriteResult =
  | { kind: "saved"; movie: MovieSummary }
  | { kind: "not_found" }
  | { kind: "catalog_unavailable" };

type LookupMovie = (tmdbId: number) => Promise<CatalogResult<CatalogMovie | null>>;

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

  const snapshot = {
    title: movie.title,
    releaseYear: movie.releaseYear,
    posterPath: movie.posterPath,
  };
  await getDb().$transaction([
    getDb().movie.upsert({
      where: { tmdbId: movie.tmdbId },
      create: { tmdbId: movie.tmdbId, ...snapshot },
      update: snapshot,
    }),
    getDb().user.update({ where: { id: user.id }, data: { favoriteMovieId: movie.tmdbId } }),
  ]);
  return { kind: "saved", movie: toSummary(movie) };
}
