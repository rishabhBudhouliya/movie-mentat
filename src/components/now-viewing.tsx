import Image from "next/image";
import type { ReactNode } from "react";
import type { CastMember } from "@/lib/api";
import type { Direction, Loadable } from "@/lib/graph";
import { assertNever } from "./assert-never";
import { Avatar } from "./graph/avatar";
import { directionColor } from "./graph/colors";
import { MoviePoster } from "./movie-poster";
import type { MovieSummary } from "./types";

/**
 * The dashboard's main card (decision 20): the movie in focus, its fact, and
 * the actors to go deeper through. The poster, blurred, tints the card.
 */
export function NowViewing({
  movie,
  isFavorite,
  arrivedVia,
  fact,
  directions,
  onOpen,
  onRetryCast,
}: {
  movie: MovieSummary;
  isFavorite: boolean;
  arrivedVia: CastMember[];
  /** The fact panel, or a placeholder while a favorite change is saving. */
  fact: ReactNode;
  /** null hides the list (while a favorite change is saving). */
  directions: Loadable<readonly Direction[]> | null;
  onOpen: (personId: number) => void;
  onRetryCast: () => void;
}) {
  const subtitle = [
    movie.releaseYear ?? "Year unknown",
    isFavorite
      ? "Where your graph starts"
      : arrivedVia.length > 0
        ? `via ${arrivedVia.map((a) => a.name).join(" and ")}`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-labelledby="now-viewing-title"
      className="relative isolate overflow-hidden rounded-xl bg-zinc-900 p-5 sm:p-7"
    >
      {movie.posterUrl ? (
        <Image
          src={movie.posterUrl}
          alt=""
          fill
          sizes="100vw"
          className="-z-10 scale-125 object-cover opacity-40 blur-3xl"
        />
      ) : null}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-zinc-950/55" />

      <div className="flex flex-wrap gap-6 sm:gap-8">
        <div className="hidden shrink-0 sm:block">
          <div className="shadow-[0_20px_48px_rgba(0,0,0,.55)]">
            <MoviePoster title={movie.title} posterUrl={movie.posterUrl} size="xl" />
          </div>
        </div>

        <div className="flex min-w-0 flex-[2_1_360px] flex-col justify-end gap-3">
          <div className="flex items-center gap-3">
            <div className="sm:hidden">
              <MoviePoster title={movie.title} posterUrl={movie.posterUrl} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold tracking-widest text-zinc-300 uppercase">
                Now viewing
              </span>
              {isFavorite ? (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-zinc-950 uppercase">
                  Your favorite
                </span>
              ) : null}
            </div>
          </div>
          <h1
            id="now-viewing-title"
            className="text-3xl leading-none font-extrabold tracking-tight text-white sm:text-5xl"
          >
            {movie.title}
          </h1>
          <p className="text-sm text-zinc-300 sm:text-base">{subtitle}</p>
          <div className="mt-2 max-w-2xl">{fact}</div>
        </div>

        {directions ? (
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1 self-stretch rounded-lg bg-black/30 p-4">
            <h2 className="text-base font-extrabold text-white">Go deeper via</h2>
            <p className="mb-2 text-sm text-zinc-300">
              Pick an actor to add their other leading roles to the graph below.
            </p>
            <Directions directions={directions} onOpen={onOpen} onRetry={onRetryCast} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Directions({
  directions,
  onOpen,
  onRetry,
}: {
  directions: Loadable<readonly Direction[]>;
  onOpen: (personId: number) => void;
  onRetry: () => void;
}) {
  switch (directions.kind) {
    case "idle":
    case "loading":
      return (
        <ul aria-busy="true" aria-label="Loading cast" className="flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 p-2">
              <span className="h-12 w-12 animate-pulse rounded-full bg-zinc-800 motion-reduce:animate-none" />
              <span className="h-4 w-32 animate-pulse rounded bg-zinc-800 motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      );
    case "failed":
      return (
        <div role="alert" className="flex flex-col items-start gap-2 p-2 text-sm text-zinc-200">
          <p>Couldn't load the cast. {directions.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-zinc-600 px-4 py-1.5 font-semibold hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Retry
          </button>
        </div>
      );
    case "ready":
      if (directions.value.length === 0) {
        return <p className="p-2 text-sm text-zinc-300">TMDB lists no cast for this movie.</p>;
      }
      return (
        <ul className="flex flex-col gap-1">
          {directions.value.map((direction) => (
            <li key={direction.actor.personId}>
              <DirectionRow direction={direction} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      );
    default:
      return assertNever(directions);
  }
}

function DirectionRow({
  direction,
  onOpen,
}: {
  direction: Direction;
  onOpen: (personId: number) => void;
}) {
  const { actor, films } = direction;
  const status =
    films.kind === "idle"
      ? { text: "Explore", className: "text-amber-300" }
      : films.kind === "loading"
        ? { text: "Finding films…", className: "text-zinc-300" }
        : films.kind === "failed"
          ? { text: "Retry", className: "text-amber-300" }
          : {
              text: films.value.length === 0 ? "No other leads" : `Showing ${films.value.length}`,
              className: "text-zinc-300",
            };
  return (
    <button
      type="button"
      onClick={() => onOpen(actor.personId)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
    >
      <Avatar
        name={actor.name}
        url={actor.profileUrl}
        color={directionColor(direction.slot)}
        size={48}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold text-white">{actor.name}</span>
        {actor.character ? (
          <span className="truncate text-xs text-zinc-300">as {actor.character}</span>
        ) : null}
      </span>
      <span className={`shrink-0 text-xs font-bold ${status.className}`}>{status.text}</span>
    </button>
  );
}
