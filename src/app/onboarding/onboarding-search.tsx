"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/error-notice";
import { MovieSearch } from "@/components/movie-search";
import type { MovieSummary, SearchState } from "@/components/types";
import { api } from "@/lib/api";
import { parseMovieQuery, resolveSubmission } from "@/lib/movie-query";

const DEBOUNCE_MS = 250;

export function OnboardingSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Repeated queries reuse earlier results (PRODUCT_DECISIONS.md).
  const cache = useRef(new Map<string, MovieSummary[]>());
  // Only the latest query may update the screen; older responses are ignored.
  const latestQuery = useRef("");

  async function fetchMovies(
    text: string,
    signal?: AbortSignal,
  ): Promise<MovieSummary[] | "error"> {
    const cached = cache.current.get(text);
    if (cached) return cached;
    const result = await api.searchMovies(text, signal);
    if (!result.ok) return "error";
    cache.current.set(text, result.data.movies);
    return result.data.movies;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryCount re-runs the search on Retry.
  useEffect(() => {
    const parsed = parseMovieQuery(query);
    latestQuery.current = parsed.kind === "ok" ? parsed.text : "";
    if (parsed.kind === "invalid") {
      setState(
        parsed.reason === "too_long"
          ? { kind: "error", message: "That title is too long." }
          : { kind: "idle" },
      );
      return;
    }

    const text = parsed.text;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!cache.current.has(text)) setState({ kind: "loading" });
      const movies = await fetchMovies(text, controller.signal);
      if (latestQuery.current !== text) return; // a newer query owns the screen
      if (movies === "error") {
        setState({ kind: "error", message: "Movie search is unavailable right now." });
      } else {
        setState(movies.length === 0 ? { kind: "empty" } : { kind: "results", movies });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, retryCount]);

  async function save(movie: MovieSummary) {
    setSaving(true);
    setSaveError(null);
    const result = await api.setFavoriteMovie(movie.tmdbId);
    if (result.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setSaving(false);
    setSaveError(result.error.message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseMovieQuery(query);
    if (parsed.kind === "invalid") return;
    const movies = await fetchMovies(parsed.text);
    if (latestQuery.current !== parsed.text) return;
    if (movies === "error") {
      setState({ kind: "error", message: "Movie search is unavailable right now." });
      return;
    }

    const submission = resolveSubmission(parsed, movies);
    switch (submission.kind) {
      case "exact":
        await save(submission.movie);
        return;
      case "ambiguous":
        setState({ kind: "ambiguous", candidates: submission.candidates });
        return;
      case "choose":
        setState({ kind: "results", movies: submission.movies });
        return;
      case "empty":
        setState({ kind: "empty" });
        return;
    }
  }

  function handleEditSearch() {
    const cached = cache.current.get(latestQuery.current);
    setState(cached && cached.length > 0 ? { kind: "results", movies: cached } : { kind: "idle" });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {saveError ? <ErrorNotice title="Couldn't save your movie" message={saveError} /> : null}
      <MovieSearch
        query={query}
        onQueryChange={setQuery}
        state={state}
        onSelect={save}
        onRetry={() => setRetryCount((n) => n + 1)}
        onEditSearch={handleEditSearch}
        disabled={saving}
      />
      <p className="text-xs text-neutral-500 dark:text-zinc-400">
        Press Enter to pick an exact match. Add a year to tell remakes apart, e.g. &ldquo;Dune
        1984&rdquo;.
      </p>
    </form>
  );
}
