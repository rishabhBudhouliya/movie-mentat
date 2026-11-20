"use client";

import { useEffect, useRef, useState } from "react";
import type { MovieSummary } from "@/components/types";
import { api } from "@/lib/api";
import { createLatestGate } from "@/lib/fact-cache";
import {
  parseMovieQuery,
  resolveSubmission,
  type SearchResult,
  type Submission,
  visibleSearchState,
} from "@/lib/movie-query";

const DEBOUNCE_MS = 250;

type Fetched = MovieSummary[] | "error";

/**
 * Typeahead movie search shared by onboarding and inline editing: debounced,
 * repeated queries served from a cache, only the newest request may store a
 * result, and a result is shown only for the exact query it answers.
 */
export function useMovieSearch(initialQuery = "") {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const cache = useRef(new Map<string, MovieSummary[]>());
  const gate = useRef(createLatestGate());
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function fetchMovies(text: string, signal?: AbortSignal): Promise<Fetched> {
    const cached = cache.current.get(text);
    if (cached) return cached;
    const response = await api.searchMovies(text, signal);
    if (!response.ok) {
      // An expired session isn't a catalog outage: send the user to sign in.
      if (response.error.status === 401) window.location.assign("/");
      return "error";
    }
    cache.current.set(text, response.data.movies);
    return response.data.movies;
  }

  function store(text: string, movies: Fetched) {
    setResult({
      forText: text,
      state:
        movies === "error"
          ? { kind: "error", message: "Movie search is unavailable right now." }
          : movies.length === 0
            ? { kind: "empty" }
            : { kind: "results", movies },
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryCount re-runs the search on Retry.
  useEffect(() => {
    const ticket = gate.current.next();
    const parsed = parseMovieQuery(query);
    if (parsed.kind === "invalid") return;

    const controller = new AbortController();
    pending.current = setTimeout(async () => {
      const movies = await fetchMovies(parsed.text, controller.signal);
      if (gate.current.isLatest(ticket)) store(parsed.text, movies);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(pending.current);
      controller.abort();
    };
  }, [query, retryCount]);

  // Unmounting invalidates anything still in flight (including a submit).
  useEffect(() => () => void gate.current.next(), []);

  /** What Enter does for the current query (PRODUCT_DECISIONS.md); null if superseded. */
  async function submit(): Promise<Submission | null> {
    const parsed = parseMovieQuery(query);
    if (parsed.kind === "invalid") return null;
    clearTimeout(pending.current); // this request replaces the debounced one
    const ticket = gate.current.next();
    const movies = await fetchMovies(parsed.text);
    if (!gate.current.isLatest(ticket)) return null;
    if (movies === "error") {
      store(parsed.text, movies);
      return null;
    }
    const submission = resolveSubmission(parsed, movies);
    setResult({
      forText: parsed.text,
      state:
        submission.kind === "ambiguous"
          ? { kind: "ambiguous", candidates: submission.candidates }
          : submission.kind === "empty"
            ? { kind: "empty" }
            : { kind: "results", movies },
    });
    return submission;
  }

  function editSearch() {
    const parsed = parseMovieQuery(query);
    if (parsed.kind !== "ok") return;
    const cached = cache.current.get(parsed.text);
    if (cached) store(parsed.text, cached);
  }

  return {
    query,
    setQuery,
    state: visibleSearchState(result, query),
    submit,
    editSearch,
    retry: () => {
      setResult(null);
      setRetryCount((n) => n + 1);
    },
  };
}
