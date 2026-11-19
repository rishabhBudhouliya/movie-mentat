import { z } from "zod";
import type { MovieSummary } from "@/components/types";
import type { ParsedQuery } from "@/lib/movie-query";
import { getTmdbEnv } from "@/server/env";
import { posterUrl } from "@/server/movies/repository";

// The catalog is a dependency that fails: every call has a timeout and returns
// a result instead of throwing, so callers must handle "unavailable".

const API = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 4000;

/** A catalog entry as we persist it (poster *path*, not URL). */
export type CatalogMovie = {
  tmdbId: number;
  title: string;
  releaseYear: number | null;
  posterPath: string | null;
};

export type CatalogResult<T> = { kind: "ok"; value: T } | { kind: "unavailable" };

const movieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1),
  release_date: z.string().optional().nullable(),
  poster_path: z.string().optional().nullable(),
});

const searchSchema = z.object({ results: z.array(z.unknown()) });

function toCatalogMovie(raw: z.infer<typeof movieSchema>): CatalogMovie {
  const year = Number(raw.release_date?.slice(0, 4));
  return {
    tmdbId: raw.id,
    title: raw.title,
    releaseYear: Number.isInteger(year) && year > 0 ? year : null,
    posterPath: raw.poster_path ?? null,
  };
}

export function toSummary(movie: CatalogMovie): MovieSummary {
  return {
    tmdbId: movie.tmdbId,
    title: movie.title,
    releaseYear: movie.releaseYear,
    posterUrl: posterUrl(movie.posterPath),
  };
}

async function get(path: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${getTmdbEnv().TMDB_READ_TOKEN}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function searchOnce(query: string, year: number | null): Promise<CatalogMovie[]> {
  const params: Record<string, string> = { query, include_adult: "false", language: "en-US" };
  if (year !== null) params.year = String(year);
  const response = await get("/search/movie", params);
  if (!response.ok) throw new Error(`TMDB search ${response.status}`);
  const { results } = searchSchema.parse(await response.json());
  // Skip malformed entries rather than failing the whole search.
  return results.flatMap((entry) => {
    const parsed = movieSchema.safeParse(entry);
    return parsed.success ? [toCatalogMovie(parsed.data)] : [];
  });
}

/**
 * Searches the full text, and also title + year when the input ends in a year.
 * Both, because "Dune 1984" means Dune from 1984 while "Wonder Woman 1984" is a
 * title. Year-filtered matches come first.
 */
export async function searchMovies(
  query: Extract<ParsedQuery, { kind: "ok" }>,
): Promise<CatalogResult<CatalogMovie[]>> {
  try {
    const searches = [searchOnce(query.text, null)];
    if (query.year !== null) searches.unshift(searchOnce(query.title, query.year));
    const pages = await Promise.all(searches);

    const seen = new Set<number>();
    const movies = pages.flat().filter((movie) => {
      if (seen.has(movie.tmdbId)) return false;
      seen.add(movie.tmdbId);
      return true;
    });
    return { kind: "ok", value: movies.slice(0, 10) };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Looks up one catalog entry; `null` if TMDB has no such movie. */
export async function getMovie(tmdbId: number): Promise<CatalogResult<CatalogMovie | null>> {
  try {
    const response = await get(`/movie/${tmdbId}`, { language: "en-US" });
    if (response.status === 404) return { kind: "ok", value: null };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = movieSchema.safeParse(await response.json());
    return { kind: "ok", value: parsed.success ? toCatalogMovie(parsed.data) : null };
  } catch {
    return { kind: "unavailable" };
  }
}
