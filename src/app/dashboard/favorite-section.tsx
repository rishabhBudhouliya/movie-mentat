"use client";

import { type FormEvent, useCallback, useEffect, useReducer, useRef } from "react";
import { ErrorNotice } from "@/components/error-notice";
import { FavoriteMovieCard } from "@/components/favorite-movie-card";
import { MovieSearch } from "@/components/movie-search";
import type { MovieSummary } from "@/components/types";
import { api } from "@/lib/api";
import {
  type Draft,
  displayedMovie,
  initialMovieState,
  type MovieState,
  reduce,
} from "@/lib/edit-movie";
import { createLatestGate } from "@/lib/fact-cache";
import { useMovieSearch } from "@/lib/use-movie-search";
import { DashboardFact } from "./dashboard-fact";

const button =
  "rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-offset-zinc-900";
const primary = `${button} bg-amber-600 text-white hover:bg-amber-700`;
const secondary = `${button} border border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800`;

/**
 * The favorite movie with inline editing (Variant B), and its fact. All
 * transitions go through the pure reducer in lib/edit-movie.ts; this
 * component only performs the side effects the reducer asks for.
 */
export function FavoriteSection({
  userId,
  userEmail,
  initialMovie,
}: {
  userId: string;
  userEmail: string;
  initialMovie: MovieSummary;
}) {
  const [state, dispatch] = useReducer(reduce, initialMovie, initialMovieState);
  const latest = useRef<MovieState>(state);
  latest.current = state;
  const profileReads = useRef(createLatestGate());
  const changeButton = useRef<HTMLButtonElement>(null);

  /**
   * Re-read the server's favorite (P4: last successful save wins). Only the
   * newest read counts, and none is applied while this tab's own save is in
   * flight; the save triggers a fresh read once it settles.
   */
  const reconcile = useCallback(async () => {
    // A function, not a narrowed property: the ref changes while we await.
    const saving = () => latest.current.view.kind === "saving";
    if (saving()) return;
    const ticket = profileReads.current.next();
    const result = await api.getMe();
    if (!profileReads.current.isLatest(ticket) || saving()) return;
    if (!result.ok) {
      if (result.error.status === 401) window.location.assign("/"); // signed out elsewhere
      return;
    }
    const { user, favoriteMovie } = result.data;
    // Another account signed in from another tab: this page's state belongs
    // to someone else now, so start over rather than mix the two.
    if (user.email !== userEmail || favoriteMovie === null) {
      window.location.reload();
      return;
    }
    dispatch({ type: "serverChanged", movie: favoriteMovie });
  }, [userEmail]);

  function save() {
    const next = reduce(latest.current, { type: "save" });
    dispatch({ type: "save" });
    if (next.view.kind !== "saving") return;
    profileReads.current.next(); // a read from before this save can't apply after it
    void api.setFavoriteMovie(next.view.draft.selected.tmdbId).then((result) => {
      if (result.ok) dispatch({ type: "saveSucceeded", movie: result.data.movie });
      else dispatch({ type: "saveFailed", message: result.error.message });
    });
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      profileReads.current.next(); // drop reads still in flight
    };
  }, [reconcile]);

  // Reacts to view transitions, after React has committed them.
  const previousKind = useRef(state.view.kind);
  useEffect(() => {
    const before = previousKind.current;
    previousKind.current = state.view.kind;
    // A save just settled (either way): re-sync, since another tab may have
    // saved meanwhile. Here, not in the PUT callback, so `latest` is current.
    if (before === "saving" && state.view.kind !== "saving") void reconcile();
    // Return focus to "Change movie" when the editor closes.
    if (state.view.kind === "viewing" && before !== "viewing") changeButton.current?.focus();
  }, [state.view.kind, reconcile]);

  const { view } = state;

  return (
    <>
      <FavoriteMovieCard
        movie={displayedMovie(state)}
        actions={
          view.kind === "viewing" ? (
            <button
              ref={changeButton}
              type="button"
              className={secondary}
              onClick={() => dispatch({ type: "edit" })}
            >
              Change movie
            </button>
          ) : view.kind === "saving" ? (
            <span role="status" className="text-sm text-neutral-500 dark:text-zinc-400">
              Saving…
            </span>
          ) : null
        }
      />

      {view.kind === "editing" ? (
        <MovieEditor
          draft={view.draft}
          error={view.error}
          conflict={state.conflict}
          onDraftChange={(draft) => dispatch({ type: "draftChanged", draft })}
          onSave={save}
          onCancel={() => dispatch({ type: "cancel" })}
        />
      ) : null}

      {/* While saving, the old movie's fact is hidden; the new one loads after confirmation. */}
      <DashboardFact
        userId={userId}
        movieId={view.kind === "saving" ? null : state.confirmed.tmdbId}
        onFavoriteChanged={reconcile}
      />
    </>
  );
}

function MovieEditor({
  draft,
  error,
  conflict,
  onDraftChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  error: string | null;
  conflict: MovieSummary | null;
  onDraftChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Starts from the draft, so a failed save reopens with the search intact.
  const search = useMovieSearch(draft.query);
  const input = useRef<HTMLInputElement>(null);
  const select = (movie: MovieSummary) => onDraftChange({ query: search.query, selected: movie });

  // Focus the search when the editor opens (or reopens after a failed save).
  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (search.query !== draft.query) onDraftChange({ ...draft, query: search.query });
  }, [search.query, draft, onDraftChange]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // During editing, Enter selects a draft; it never saves on its own.
    const submission = await search.submit();
    if (submission?.kind === "exact") select(submission.movie);
  }

  const label = (movie: MovieSummary) =>
    movie.releaseYear ? `${movie.title} (${movie.releaseYear})` : movie.title;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900"
    >
      {conflict ? (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          Another tab just saved <strong>{label(conflict)}</strong>. Save to replace it with your
          choice, or Cancel to keep it.
        </p>
      ) : null}
      {error ? <ErrorNotice title="Couldn't save your change" message={error} /> : null}

      <MovieSearch
        label="Change your favorite movie"
        inputRef={input}
        query={search.query}
        onQueryChange={search.setQuery}
        state={search.state}
        onSelect={select}
        onRetry={search.retry}
        onEditSearch={search.editSearch}
      />

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-neutral-600 dark:text-zinc-300" aria-live="polite">
          {draft.selected ? (
            <>
              Selected: <strong>{label(draft.selected)}</strong>
            </>
          ) : (
            "Pick a movie from the results."
          )}
        </p>
        <button type="button" className={secondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={primary}
          onClick={onSave}
          disabled={draft.selected === null}
        >
          {error ? "Try again" : "Save"}
        </button>
      </div>
    </form>
  );
}
