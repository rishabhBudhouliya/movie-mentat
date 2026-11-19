"use client";

import { useState } from "react";
import { FactPanel } from "@/components/fact-panel";
import { MovieSearch } from "@/components/movie-search";
import type { FactState, MovieSummary, SearchState } from "@/components/types";

/**
 * Dev-only interactive wrappers around the client components, so the
 * preview page (a server component) can show every fixture state while
 * still exercising real input handling, selection, retry, and "new fact"
 * clicks. Each demo keeps a one-line "last action" log so a reviewer can
 * confirm the handlers actually fire.
 */

function ActionLog({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="rounded-md bg-neutral-900/5 px-2.5 py-1 text-xs text-neutral-600 dark:bg-white/10 dark:text-zinc-300">
      {text}
    </p>
  );
}

export function MovieSearchDemo({
  label,
  initialQuery,
  state,
}: {
  label: string;
  initialQuery: string;
  state: SearchState;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [log, setLog] = useState<string | null>(null);

  function describe(movie: MovieSummary) {
    return `${movie.title}${movie.releaseYear ? ` (${movie.releaseYear})` : ""}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <MovieSearch
        label={label}
        query={query}
        onQueryChange={setQuery}
        state={state}
        onSelect={(movie) => setLog(`Selected: ${describe(movie)}`)}
        onRetry={() => setLog("Retry clicked")}
        onEditSearch={() => setLog("Edit search clicked")}
      />
      <ActionLog text={log} />
    </div>
  );
}

export function FactPanelDemo({
  state,
  canRequestNew,
  nextAvailableInSeconds,
}: {
  state: FactState;
  canRequestNew: boolean;
  nextAvailableInSeconds: number | null;
}) {
  const [log, setLog] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <FactPanel
        state={state}
        canRequestNew={canRequestNew}
        nextAvailableInSeconds={nextAvailableInSeconds}
        onRequestNew={() => setLog("New fact requested")}
        onRetry={() => setLog("Retry clicked")}
      />
      <ActionLog text={log} />
    </div>
  );
}
