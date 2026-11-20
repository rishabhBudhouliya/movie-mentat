"use client";

import { useEffect, useState } from "react";
import { assertNever } from "./assert-never";
import { ErrorNotice } from "./error-notice";
import type { FactState } from "./types";

const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DIVISIONS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "seconds"],
  [60, "minutes"],
  [24, "hours"],
  [7, "days"],
  [4.34524, "weeks"],
  [12, "months"],
  [Number.POSITIVE_INFINITY, "years"],
];

function formatRelativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";

  let duration = (then - nowMs) / 1000; // seconds; negative = in the past
  for (const [amount, unit] of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return RELATIVE_TIME.format(Math.round(duration), unit);
    }
    duration /= amount;
  }
  return RELATIVE_TIME.format(Math.round(duration), "years");
}

/**
 * Ticking "now" reference, null until the first client effect runs so the
 * server-rendered and first client-rendered markup match (avoids a
 * hydration mismatch from Date.now() differing between server and client).
 */
function useNowMs(): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);
  return nowMs;
}

function GeneratedAt({ iso }: { iso: string }) {
  const nowMs = useNowMs();
  return (
    <p className="text-xs text-neutral-500 dark:text-zinc-400">
      {nowMs === null ? "Generated…" : `Generated ${formatRelativeTime(iso, nowMs)}`}
    </p>
  );
}

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`animate-spin motion-reduce:animate-none ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FactBody({
  state,
  onRetry,
  textClass,
}: {
  state: FactState;
  onRetry: () => void;
  textClass: string;
}) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-100 dark:bg-zinc-800/70" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-neutral-100 dark:bg-zinc-800/70" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-zinc-800/70" />
        </div>
      );

    case "fact":
      return (
        <div className="flex flex-col gap-2">
          {state.refreshing ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Spinner />
              Fetching a new fact…
            </p>
          ) : null}
          <p className={textClass}>{state.text}</p>
          <GeneratedAt iso={state.generatedAt} />
        </div>
      );

    case "fallback":
      return (
        <div className="flex flex-col gap-3">
          <p className={textClass}>{state.text}</p>
          <GeneratedAt iso={state.generatedAt} />
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0">
              <path
                fill="currentColor"
                d="M12 2 1 21h22L12 2Zm0 6.5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1ZM12 17a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
              />
            </svg>
            <span>{state.notice}</span>
          </div>
        </div>
      );

    case "error":
      return (
        <ErrorNotice
          title="Couldn't load a fact"
          message={state.message}
          action={
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors duration-150 ease-out hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
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

/**
 * The fact card: current fact text (or its loading/fallback/error variant)
 * plus the "New fact" action, which respects the server's cooldown window
 * via `canRequestNew` / `nextAvailableInSeconds`.
 */
const VARIANTS = {
  // A card of its own (the dev screens).
  card: {
    section:
      "flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900",
    text: "text-base leading-relaxed text-neutral-900 dark:text-zinc-50",
    actions: "flex flex-wrap items-center gap-2 border-t border-black/5 pt-4 dark:border-white/10",
  },
  // Inside the dashboard's "Now viewing" card: the fact is the headline.
  hero: {
    section: "flex flex-col gap-4",
    text: "text-lg font-medium leading-relaxed text-white sm:text-xl",
    actions: "flex flex-wrap items-center gap-3",
  },
} as const;

export function FactPanel({
  state,
  canRequestNew,
  nextAvailableInSeconds,
  onRequestNew,
  onRetry,
  variant = "card",
}: {
  state: FactState;
  canRequestNew: boolean;
  nextAvailableInSeconds: number | null;
  onRequestNew: () => void;
  onRetry: () => void;
  variant?: keyof typeof VARIANTS;
}) {
  const styles = VARIANTS[variant];
  return (
    <section className={styles.section}>
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
          <path
            d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        Spoiler-free fact
      </h2>

      <div aria-live="polite" className="min-h-[4.5rem]">
        {state.kind === "loading" && <span className="sr-only">Loading fact…</span>}
        <FactBody state={state} onRetry={onRetry} textClass={styles.text} />
      </div>

      {state.kind !== "error" ? (
        <div className={styles.actions}>
          <button
            type="button"
            onClick={onRequestNew}
            disabled={!canRequestNew}
            className="rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 ease-out hover:bg-amber-700 dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 motion-reduce:transition-none dark:focus-visible:ring-offset-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            New fact
          </button>
          {!canRequestNew && nextAvailableInSeconds !== null ? (
            <span className="text-xs text-neutral-500 dark:text-zinc-400">
              Available in {nextAvailableInSeconds}s
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
