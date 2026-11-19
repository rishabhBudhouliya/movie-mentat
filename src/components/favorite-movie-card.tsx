import type { ReactNode } from "react";
import { MoviePoster } from "./movie-poster";
import type { MovieSummary } from "./types";

/**
 * Displays the user's saved favorite movie. `actions` is an open slot for a
 * future "Edit" button so this component doesn't need to change when that
 * lands.
 */
export function FavoriteMovieCard({
  movie,
  actions,
}: {
  movie: MovieSummary;
  actions?: ReactNode;
}) {
  return (
    <section className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5 dark:border-white/10 dark:bg-zinc-900">
      <MoviePoster title={movie.title} posterUrl={movie.posterUrl} size="lg" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
          Favorite movie
        </p>
        <p className="truncate text-lg font-semibold text-neutral-900 dark:text-zinc-50">
          {movie.title}
        </p>
        <p className="text-sm text-neutral-500 dark:text-zinc-400">
          {movie.releaseYear ?? "Year unknown"}
        </p>
      </div>

      {actions ? <div className="shrink-0">{actions}</div> : null}
    </section>
  );
}
