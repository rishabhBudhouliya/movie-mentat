import type { MovieSummary } from "@/components/types";
import type { AuthedUser } from "@/server/auth/session";
import { getDb } from "@/server/db";

const POSTER_BASE = "https://image.tmdb.org/t/p/w342";

export function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `${POSTER_BASE}${posterPath}` : null;
}

/** The signed-in user's saved favorite, read from our DB (works during a TMDB outage). */
export async function getFavoriteMovie(user: AuthedUser): Promise<MovieSummary | null> {
  if (user.favoriteMovieId === null) return null;
  const movie = await getDb().movie.findUnique({ where: { tmdbId: user.favoriteMovieId } });
  if (!movie) return null;
  return {
    tmdbId: movie.tmdbId,
    title: movie.title,
    releaseYear: movie.releaseYear,
    posterUrl: posterUrl(movie.posterPath),
  };
}
