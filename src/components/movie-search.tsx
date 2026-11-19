"use client";

import type { KeyboardEvent, MutableRefObject } from "react";
import { useId, useRef } from "react";
import { assertNever } from "./assert-never";
import { ErrorNotice } from "./error-notice";
import { MoviePoster } from "./movie-poster";
import type { MovieSummary, SearchState } from "./types";

const EMPTY_COPY = "No match found. Try another title or add a release year.";

/**
 * Typeahead search for picking a catalog movie. The input is always
 * controlled by `query`/`onQueryChange`; everything below it is driven by
 * `state`. Result buttons support Up/Down arrow navigation in addition to
 * normal Tab order.
 */
export function MovieSearch({
  query,
  onQueryChange,
  state,
  onSelect,
  onRetry,
  onEditSearch,
  disabled = false,
  label = "Your favorite movie",
}: {
  query: string;
  onQueryChange: (q: string) => void;
  state: SearchState;
  onSelect: (movie: MovieSummary) => void;
  onRetry: () => void;
  onEditSearch: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputId = useId();
  const statusId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusItem(index: number) {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    items[clamped]?.focus();
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(index - 1);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-neutral-700 dark:text-zinc-300"
        >
          {label}
        </label>
        <input
          id={inputId}
          type="text"
          aria-controls={statusId}
          autoComplete="off"
          value={query}
          disabled={disabled}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="e.g. Dune"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2.5 text-base text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus-visible:ring-offset-zinc-900"
        />
      </div>

      <div id={statusId} aria-live="polite" className="min-h-0">
        <SearchResults
          state={state}
          onSelect={onSelect}
          onRetry={onRetry}
          onEditSearch={onEditSearch}
          itemRefs={itemRefs}
          onItemKeyDown={handleItemKeyDown}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function SearchResults({
  state,
  onSelect,
  onRetry,
  onEditSearch,
  itemRefs,
  onItemKeyDown,
  disabled,
}: {
  state: SearchState;
  onSelect: (movie: MovieSummary) => void;
  onRetry: () => void;
  onEditSearch: () => void;
  itemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  onItemKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  disabled: boolean;
}) {
  switch (state.kind) {
    case "idle":
      return null;

    case "loading":
      return (
        <ul className="flex flex-col gap-2" aria-label="Searching">
          {[0, 1, 2].map((key) => (
            <li
              key={key}
              className="h-[61px] animate-pulse rounded-lg bg-neutral-100 dark:bg-zinc-800/70"
            />
          ))}
        </ul>
      );

    case "results":
      itemRefs.current = [];
      return (
        <ul className="flex flex-col gap-2">
          {state.movies.map((movie, index) => (
            <li key={movie.tmdbId}>
              <button
                type="button"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                onClick={() => onSelect(movie)}
                onKeyDown={(event) => onItemKeyDown(event, index)}
                disabled={disabled}
                className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2.5 text-left transition-colors duration-150 ease-out hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-amber-700/60 dark:hover:bg-zinc-800"
              >
                <MoviePoster title={movie.title} posterUrl={movie.posterUrl} size="sm" />
                <span className="flex flex-col">
                  <span className="font-medium text-neutral-900 dark:text-zinc-50">
                    {movie.title}
                  </span>
                  <span className="text-sm text-neutral-500 dark:text-zinc-400">
                    {movie.releaseYear ?? "Year unknown"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      );

    case "ambiguous": {
      const [first, second] = state.candidates;
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600 dark:text-zinc-400">
            We found more than one match. Which one did you mean?
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[first, second].map((movie) => (
              <button
                key={movie.tmdbId}
                type="button"
                onClick={() => onSelect(movie)}
                disabled={disabled}
                className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-center transition-colors duration-150 ease-out hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-amber-700/60 dark:hover:bg-zinc-800"
              >
                <MoviePoster title={movie.title} posterUrl={movie.posterUrl} size="lg" />
                <span className="flex flex-col">
                  <span className="font-medium text-neutral-900 dark:text-zinc-50">
                    {movie.title}
                  </span>
                  <span className="text-sm text-neutral-500 dark:text-zinc-400">
                    {movie.releaseYear ?? "Year unknown"}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onEditSearch}
            disabled={disabled}
            className="self-start text-sm font-medium text-amber-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-400"
          >
            Edit search
          </button>
        </div>
      );
    }

    case "empty":
      return (
        <p
          role="status"
          className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-zinc-800/60 dark:text-zinc-400"
        >
          {EMPTY_COPY}
        </p>
      );

    case "error":
      return (
        <ErrorNotice
          title="Couldn't search the catalog"
          message={state.message}
          action={
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors duration-150 ease-out hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
            >
              Retry
            </button>
          }
        />
      );

    default:
      return assertNever(state);
  }
}
