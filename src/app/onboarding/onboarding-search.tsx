"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/error-notice";
import { MovieSearch } from "@/components/movie-search";
import type { MovieSummary } from "@/components/types";
import { api } from "@/lib/api";
import { useMovieSearch } from "@/lib/use-movie-search";

// During onboarding, choosing a movie commits it immediately.
export function OnboardingSearch() {
  const router = useRouter();
  const search = useMovieSearch();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false); // synchronous guard against double submits
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function save(movie: MovieSummary) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const result = await api.setFavoriteMovie(movie.tmdbId);
    if (!mounted.current) return; // the user left; don't navigate them back
    if (result.ok) {
      router.push("/dashboard");
      router.refresh();
      return;
    }
    savingRef.current = false;
    setSaving(false);
    setSaveError(result.error.message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submission = await search.submit();
    if (submission?.kind === "exact" && mounted.current) await save(submission.movie);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {saveError ? <ErrorNotice title="Couldn't save your movie" message={saveError} /> : null}
      <MovieSearch
        query={search.query}
        onQueryChange={search.setQuery}
        state={search.state}
        onSelect={save}
        onRetry={search.retry}
        onEditSearch={search.editSearch}
        disabled={saving}
      />
      <p className="text-xs text-neutral-500 dark:text-zinc-400">
        Press Enter to pick an exact match. Add a year to tell remakes apart, e.g. &ldquo;Dune
        1984&rdquo;.
      </p>
    </form>
  );
}
