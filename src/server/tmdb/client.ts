import { z } from "zod";
import type { MovieSummary } from "@/components/types";
import type { ParsedQuery } from "@/lib/movie-query";
import { getTmdbEnv } from "@/server/env";
import { posterUrl } from "@/server/movies/repository";

// The catalog is a dependency that fails: every call has a timeout and returns
// a result instead of throwing, so callers must handle "unavailable".

const API = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 4000;
// Suggestions shown per search: enough to disambiguate remakes (the two
// *Dune*s are TMDB results 1 and 4), short enough to scan.
export const MAX_RESULTS = 5;

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
    return { kind: "ok", value: movies.slice(0, MAX_RESULTS) };
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

// ── Graph data (PLAN.md decision 15) ───────────────────────────────────────

/** Directions offered from a movie: its top-billed cast. */
export const TOP_BILLED = 3;
/** A "leading role" in the target film: billed in the top five. */
export const LEADING_ORDER_LIMIT = 5;
/**
 * Films returned per actor. The graph shows five per direction; one spare,
 * because the film the user came from is in the actor's list too.
 */
export const LEADING_FILMS_LIMIT = 6;

export type CastMember = {
  personId: number;
  name: string;
  character: string | null;
  profilePath: string | null;
};

const castSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  character: z.string().optional().nullable(),
  order: z.number().int().nonnegative(),
  profile_path: z.string().optional().nullable(),
});

const creditsSchema = z.object({ cast: z.array(z.unknown()) });

const filmCreditSchema = movieSchema.extend({
  order: z.number().int().nonnegative(),
  character: z.string().optional().nullable(),
  vote_count: z.number().nonnegative().optional().nullable(),
  adult: z.boolean().optional().nullable(),
  video: z.boolean().optional().nullable(),
});

// Documentaries and making-of featurettes credit actors as themselves, often
// near the top of the billing. They aren't roles, so they aren't directions.
const SELF_CREDIT = /^(self|himself|herself|themselves)\b/i;

function parseEach<S extends z.ZodType>(schema: S, entries: unknown[]): z.infer<S>[] {
  return entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The movie's top-billed cast, in billing order; `null` if TMDB has no such movie. */
export async function getTopCast(tmdbId: number): Promise<CatalogResult<CastMember[] | null>> {
  try {
    const response = await get(`/movie/${tmdbId}/credits`, { language: "en-US" });
    if (response.status === 404) return { kind: "ok", value: null };
    if (!response.ok) return { kind: "unavailable" };
    const { cast } = creditsSchema.parse(await response.json());
    const seen = new Set<number>();
    const top = parseEach(castSchema, cast)
      .sort((a, b) => a.order - b.order)
      .filter((member) => {
        // One actor can hold two billed roles; they're still one direction.
        if (seen.has(member.id) || SELF_CREDIT.test(member.character ?? "")) return false;
        seen.add(member.id);
        return true;
      })
      .slice(0, TOP_BILLED);
    return {
      kind: "ok",
      value: top.map((member) => ({
        personId: member.id,
        name: member.name,
        character: member.character?.trim() || null,
        profilePath: member.profile_path ?? null,
      })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Films where the person had a leading role (billed in the top five), most
 * voted first; `null` if TMDB has no such person. Excludes self credits,
 * adult titles, and direct-to-video featurettes.
 */
export async function getLeadingFilms(
  personId: number,
): Promise<CatalogResult<CatalogMovie[] | null>> {
  try {
    const response = await get(`/person/${personId}/movie_credits`, { language: "en-US" });
    if (response.status === 404) return { kind: "ok", value: null };
    if (!response.ok) return { kind: "unavailable" };
    const { cast } = creditsSchema.parse(await response.json());
    const seen = new Set<number>();
    const films = parseEach(filmCreditSchema, cast)
      .filter(
        (credit) =>
          credit.order < LEADING_ORDER_LIMIT &&
          !SELF_CREDIT.test(credit.character ?? "") &&
          credit.adult !== true &&
          credit.video !== true,
      )
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
      .filter((credit) => {
        if (seen.has(credit.id)) return false;
        seen.add(credit.id);
        return true;
      })
      .slice(0, LEADING_FILMS_LIMIT);
    return { kind: "ok", value: films.map(toCatalogMovie) };
  } catch {
    return { kind: "unavailable" };
  }
}
