import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ErrorNotice } from "@/components/error-notice";
import { FavoriteMovieCard } from "@/components/favorite-movie-card";
import { LandingHero } from "@/components/landing-hero";
import { OnboardingCard } from "@/components/onboarding-card";
import { ProfileCard } from "@/components/profile-card";
import type { FactState, MovieSummary, SearchState } from "@/components/types";
import { FactPanelDemo, MovieSearchDemo } from "./screens-client";

// Dev-only component gallery. Every variant of every discriminated-union
// state is rendered with fixture data so the other engineer (and reviewers)
// can see each screen without wiring up real data. Never shipped: this
// route 404s outside development.

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const DUNE_2021: MovieSummary = {
  tmdbId: 438_631,
  title: "Dune",
  releaseYear: 2021,
  posterUrl: "https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
};

const DUNE_1984: MovieSummary = {
  tmdbId: 10_545,
  title: "Dune",
  releaseYear: 1984,
  posterUrl: "https://image.tmdb.org/t/p/w342/dV2cfQ2S7ejxuo1KDVbFTfRB6ic.jpg",
};

const INTERSTELLAR: MovieSummary = {
  tmdbId: 157_336,
  title: "Interstellar",
  releaseYear: 2014,
  posterUrl: "https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
};

const ARRIVAL_NO_POSTER: MovieSummary = {
  tmdbId: 329_865,
  title: "Arrival",
  releaseYear: 2016,
  posterUrl: null,
};

const SEARCH_STATES: Array<{ title: string; state: SearchState }> = [
  { title: "idle", state: { kind: "idle" } },
  { title: "loading", state: { kind: "loading" } },
  {
    title: "results",
    state: { kind: "results", movies: [INTERSTELLAR, ARRIVAL_NO_POSTER, DUNE_2021] },
  },
  {
    title: "ambiguous",
    state: { kind: "ambiguous", candidates: [DUNE_2021, DUNE_1984] },
  },
  { title: "empty", state: { kind: "empty" } },
  {
    title: "error",
    state: { kind: "error", message: "The movie catalog is temporarily unavailable." },
  },
];

const FACT_STATES: Array<{
  title: string;
  state: FactState;
  canRequestNew: boolean;
  nextAvailableInSeconds: number | null;
}> = [
  {
    title: "loading",
    state: { kind: "loading" },
    canRequestNew: false,
    nextAvailableInSeconds: null,
  },
  {
    title: "fact",
    state: {
      kind: "fact",
      text: "The sandworms of Arrakis were brought to life using a mix of practical puppetry and CGI, with the production building a 10-foot mechanical worm head for close-up shots.",
      generatedAt: minutesAgoIso(2),
      refreshing: false,
    },
    canRequestNew: true,
    nextAvailableInSeconds: null,
  },
  {
    title: "fact, refreshing: true",
    state: {
      kind: "fact",
      text: "Filming took place across multiple real desert locations, including Wadi Rum in Jordan and the Liwa Desert in Abu Dhabi.",
      generatedAt: minutesAgoIso(6),
      refreshing: true,
    },
    canRequestNew: false,
    nextAvailableInSeconds: null,
  },
  {
    title: "fallback",
    state: {
      kind: "fallback",
      text: "The film's score was recorded with an 80-piece orchestra and featured a custom-built instrument designed to produce the low, droning tones heard throughout.",
      generatedAt: minutesAgoIso(94),
      notice: "We couldn't refresh this fact just now, so here's the last one we saved.",
    },
    canRequestNew: true,
    nextAvailableInSeconds: null,
  },
  {
    title: "error",
    state: { kind: "error", message: "We couldn't generate a fact right now." },
    canRequestNew: true,
    nextAvailableInSeconds: null,
  },
  {
    title: "fact, cooldown active (bonus: nextAvailableInSeconds)",
    state: {
      kind: "fact",
      text: "The costume department produced over 150 individual stillsuits for the cast and background performers.",
      generatedAt: minutesAgoIso(1),
      refreshing: false,
    },
    canRequestNew: false,
    nextAvailableInSeconds: 42,
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-b border-neutral-200 py-10 first:pt-0 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-zinc-50">{title}</h2>
        {description ? (
          <p className="text-sm text-neutral-500 dark:text-zinc-400">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="font-mono text-xs font-medium text-neutral-500 dark:text-zinc-400">{label}</p>
      {children}
    </div>
  );
}

export default function DevScreensPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-10 sm:px-8">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          Dev only — not reachable in production
        </p>
        <h1 className="text-3xl font-semibold text-neutral-900 dark:text-zinc-50">
          Component preview
        </h1>
        <p className="max-w-2xl text-sm text-neutral-600 dark:text-zinc-400">
          Every component in every state variant, rendered with fixture data. Inputs and buttons in
          the interactive demos are wired to local state only (see the "last action" line under each
          one) — nothing here talks to a server.
        </p>
      </div>

      <Section
        title="MovieSearch — SearchState"
        description='All 6 SearchState variants. "ambiguous" uses Dune (2021) and Dune (1984).'
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SEARCH_STATES.map(({ title, state }) => (
            <Variant key={title} label={title}>
              <MovieSearchDemo
                label="Your favorite movie"
                initialQuery={title === "empty" || title === "error" ? "Dune" : ""}
                state={state}
              />
            </Variant>
          ))}
        </div>
      </Section>

      <Section
        title="FactPanel — FactState"
        description="All 4 FactState variants, plus refreshing: true. The last card is a bonus demo of the nextAvailableInSeconds cooldown copy."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FACT_STATES.map(({ title, state, canRequestNew, nextAvailableInSeconds }) => (
            <Variant key={title} label={title}>
              <FactPanelDemo
                state={state}
                canRequestNew={canRequestNew}
                nextAvailableInSeconds={nextAvailableInSeconds}
              />
            </Variant>
          ))}
        </div>
      </Section>

      <Section title="ProfileCard" description="With a name and avatar, and without either.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Variant label="with name + avatar">
            <ProfileCard
              name="Priya Shah"
              email="priya.shah@example.com"
              avatarUrl="https://i.pravatar.cc/96?img=47"
              logoutAction="/auth/logout"
            />
          </Variant>
          <Variant label="without name or avatar">
            <ProfileCard
              name={null}
              email="j.doe@example.com"
              avatarUrl={null}
              logoutAction="/auth/logout"
            />
          </Variant>
        </div>
      </Section>

      <Section title="FavoriteMovieCard" description="With a poster, and without one.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Variant label="with poster">
            <FavoriteMovieCard movie={DUNE_2021} />
          </Variant>
          <Variant label="without poster">
            <FavoriteMovieCard
              movie={ARRIVAL_NO_POSTER}
              actions={<span className="text-xs text-neutral-400">(actions slot empty)</span>}
            />
          </Variant>
        </div>
      </Section>

      <Section title="OnboardingCard" description="With and without a known user name.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Variant label="userName set">
            <OnboardingCard userName="Priya Shah">
              <MovieSearchDemo
                label="Your favorite movie"
                initialQuery=""
                state={{ kind: "idle" }}
              />
            </OnboardingCard>
          </Variant>
          <Variant label="userName null">
            <OnboardingCard userName={null}>
              <MovieSearchDemo
                label="Your favorite movie"
                initialQuery=""
                state={{ kind: "idle" }}
              />
            </OnboardingCard>
          </Variant>
        </div>
      </Section>

      <Section title="LandingHero">
        <div className="rounded-xl border border-neutral-200 dark:border-zinc-800">
          <LandingHero signInHref="/auth/google" />
        </div>
      </Section>

      <Section title="ErrorNotice" description="Standalone, as used inside MovieSearch/FactPanel.">
        <ErrorNotice
          title="Couldn't load a fact"
          message="The fact service didn't respond in time."
          action={
            <button
              type="button"
              className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 dark:border-red-700 dark:text-red-200"
            >
              Retry
            </button>
          }
        />
      </Section>

      <Section
        title="AppShell"
        description="Page chrome: header, main container, and TMDB attribution footer."
      >
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-zinc-800">
          <AppShell>
            <p className="text-sm text-neutral-600 dark:text-zinc-400">
              Page content renders here, inside the shared header/footer chrome.
            </p>
          </AppShell>
        </div>
      </Section>
    </div>
  );
}
