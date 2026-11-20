import { getDb } from "@/server/db";
import { type CatalogMovie, type CatalogResult, getMovie } from "@/server/tmdb/client";

// A local copy of a catalog entry (PLAN.md decision 5). Facts reference it by
// foreign key, and a saved favorite stays viewable during a TMDB outage.

export type LookupMovie = (tmdbId: number) => Promise<CatalogResult<CatalogMovie | null>>;

export type EnsureMovieResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "catalog_unavailable" };

/** The upsert that saves (or refreshes) a catalog entry's snapshot. */
export function snapshotUpsert(movie: CatalogMovie) {
  const snapshot = {
    title: movie.title,
    releaseYear: movie.releaseYear,
    posterPath: movie.posterPath,
  };
  return getDb().movie.upsert({
    where: { tmdbId: movie.tmdbId },
    create: { tmdbId: movie.tmdbId, ...snapshot },
    update: snapshot,
  });
}

/**
 * Makes sure we hold a snapshot of `tmdbId` before anything references it
 * (decision 17: a fact can be asked for any movie in the graph). An ID we
 * already know needs no catalog call; an unknown one is checked against TMDB,
 * so a made-up ID never becomes a row.
 */
export async function ensureMovie(
  tmdbId: number,
  lookup: LookupMovie = getMovie,
): Promise<EnsureMovieResult> {
  const known = await getDb().movie.findUnique({ where: { tmdbId }, select: { tmdbId: true } });
  if (known) return { kind: "ok" };

  const found = await lookup(tmdbId);
  if (found.kind === "unavailable") return { kind: "catalog_unavailable" };
  if (found.value === null) return { kind: "not_found" };
  await snapshotUpsert(found.value);
  return { kind: "ok" };
}
