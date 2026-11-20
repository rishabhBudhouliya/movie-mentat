import type { MovieSummary, SearchState } from "@/components/types";

// Shared by the browser (to decide what Enter does) and the server (to validate
// input), so both apply the same rules. PLAN.md P2: 1–200 chars after trimming.
export const QUERY_MIN = 1;
export const QUERY_MAX = 200;

const FIRST_FILM_YEAR = 1870;

export type ParsedQuery =
  | { kind: "invalid"; reason: "empty" | "too_long" }
  | {
      kind: "ok";
      /** The whole trimmed input. */
      text: string;
      /** Title with a trailing year removed, e.g. "Dune (1984)" → "Dune". */
      title: string;
      year: number | null;
    };

/** Lowercase, drop punctuation and extra spaces: "Dune: Part Two" ~ "dune part two". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "") // accents split off by NFKD: "é" → "e"
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export function parseMovieQuery(raw: string, now: Date = new Date()): ParsedQuery {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < QUERY_MIN) return { kind: "invalid", reason: "empty" };
  if (text.length > QUERY_MAX) return { kind: "invalid", reason: "too_long" };

  // A trailing plausible year, optionally in parentheses: "Dune 1984", "Dune (1984)".
  const match = /^(.*\S)\s*\(?(\d{4})\)?$/.exec(text);
  const year = match ? Number(match[2]) : null;
  if (match?.[1] && year !== null && year >= FIRST_FILM_YEAR && year <= now.getFullYear() + 2) {
    return { kind: "ok", text, title: match[1].replace(/[\s,(-]+$/, ""), year };
  }
  return { kind: "ok", text, title: text, year: null };
}

export type Submission =
  | { kind: "exact"; movie: MovieSummary }
  | { kind: "ambiguous"; candidates: [MovieSummary, MovieSummary] }
  | { kind: "choose"; movies: MovieSummary[] }
  | { kind: "empty" };

/**
 * What pressing Enter does (PRODUCT_DECISIONS.md): one exact title (and year,
 * if given) match goes straight through; several exact matches, like the two
 * *Dune*s, become two cards; otherwise the user picks from the list.
 * `movies` is in relevance order, so the first two exact matches are the best.
 */
export function resolveSubmission(query: ParsedQuery, movies: MovieSummary[]): Submission {
  if (query.kind === "invalid" || movies.length === 0) return { kind: "empty" };

  const wanted = normalizeTitle(query.title);
  const exact = movies.filter(
    (movie) =>
      normalizeTitle(movie.title) === wanted &&
      (query.year === null || movie.releaseYear === query.year),
  );

  const [first, second] = exact;
  if (first && second) return { kind: "ambiguous", candidates: [first, second] };
  if (first) return { kind: "exact", movie: first };
  return { kind: "choose", movies };
}

/** A search outcome together with the exact (normalized) query it answers. */
export type SearchResult = { forText: string; state: SearchState };

/**
 * What the list shows for the current input. Results for any other query,
 * including the previous one during the debounce, are never shown or clickable.
 */
export function visibleSearchState(result: SearchResult | null, query: string): SearchState {
  const parsed = parseMovieQuery(query);
  if (parsed.kind === "invalid") {
    return parsed.reason === "too_long"
      ? { kind: "error", message: "That title is too long." }
      : { kind: "idle" };
  }
  return result?.forText === parsed.text ? result.state : { kind: "loading" };
}
