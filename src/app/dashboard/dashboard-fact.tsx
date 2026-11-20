"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FactPanel } from "@/components/fact-panel";
import type { FactState } from "@/components/types";
import { api, type FactResponse } from "@/lib/api";
import { type CachedFact, createLatestGate, factKey, reusable } from "@/lib/fact-cache";

const FRESH_WINDOW_S = 60;

/** What the panel shows, tagged with the (user, movie) key it belongs to. */
type Shown = { key: string; state: FactState; eligibleAt: number | null; inFlight: boolean };

/**
 * The fact for `movieId` (any movie in the graph), or a placeholder while
 * `movieId` is null (a favorite change is being saved: the old fact is hidden,
 * and the new one is requested only after the save is confirmed).
 */
export function DashboardFact({
  userId,
  movieId,
  variant = "card",
}: {
  userId: string;
  movieId: number | null;
  variant?: "card" | "hero";
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // One entry per movie (decision 19), so revisiting a node within 30s reuses
  // its fact. It lives as long as this component: the graph remounts it when
  // the favorite changes, which clears it.
  const cache = useRef(new Map<string, CachedFact>());
  const gate = useRef(createLatestGate());
  const currentKey = movieId === null ? null : factKey(userId, movieId);

  const fromEntry = useCallback((entry: CachedFact): Shown => {
    const { fact } = entry.response;
    return {
      key: entry.key,
      // The server's DB-clock age, anchored to when this response arrived.
      eligibleAt: entry.receivedAt + Math.max(0, FRESH_WINDOW_S - fact.ageSeconds) * 1000,
      inFlight: false,
      state:
        entry.response.source === "fallback"
          ? {
              kind: "fallback",
              text: fact.text,
              generatedAt: fact.generatedAt,
              notice: entry.response.notice,
            }
          : { kind: "fact", text: fact.text, generatedAt: fact.generatedAt, refreshing: false },
    };
  }, []);

  const load = useCallback(
    async (key: string, id: number, explicit: boolean) => {
      const cached = cache.current.get(key) ?? null;
      if (cached && reusable(cached, key, Date.now(), explicit)) {
        gate.current.next(); // anything still in flight is now stale
        setShown(fromEntry(cached));
        return;
      }

      const ticket = gate.current.next();
      setShown((prev) =>
        prev?.key === key && (prev.state.kind === "fact" || prev.state.kind === "fallback")
          ? {
              // Keep this movie's text visible while refreshing.
              ...prev,
              inFlight: true,
              state: {
                kind: "fact",
                text: prev.state.text,
                generatedAt: prev.state.generatedAt,
                refreshing: true,
              },
            }
          : { key, state: { kind: "loading" }, eligibleAt: null, inFlight: true },
      );

      const result = await api.getFact(id);
      if (!gate.current.isLatest(ticket)) return; // late response for a movie we left

      if (result.ok) {
        const entry: CachedFact = {
          key,
          response: result.data as FactResponse,
          receivedAt: Date.now(),
        };
        cache.current.set(key, entry);
        setShown(fromEntry(entry));
        return;
      }
      if (result.error.status === 401) {
        window.location.assign("/");
        return;
      }
      setShown((prev) => {
        const previous = prev?.key === key && prev.state.kind === "fact" ? prev.state : null;
        return {
          key,
          inFlight: false,
          eligibleAt: prev?.key === key ? prev.eligibleAt : null,
          state: previous
            ? {
                kind: "fallback",
                text: previous.text,
                generatedAt: previous.generatedAt,
                notice: result.error.message,
              }
            : { kind: "error", message: result.error.message },
        };
      });
    },
    [fromEntry],
  );

  useEffect(() => {
    if (movieId !== null && currentKey !== null) {
      void load(currentKey, movieId, false);
    }
    return () => {
      gate.current.next(); // ignore responses after leaving this movie or dashboard
    };
  }, [currentKey, movieId, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Chosen during render: a fact is only ever shown under the movie it's for,
  // even in the commit before the effect above has run.
  const mine = shown !== null && shown.key === currentKey ? shown : null;
  const secondsLeft = mine?.eligibleAt == null ? null : Math.ceil((mine.eligibleAt - now) / 1000);
  const waiting = secondsLeft !== null && secondsLeft > 0;
  const reload = () => {
    if (currentKey !== null && movieId !== null) void load(currentKey, movieId, true);
  };

  return (
    <FactPanel
      variant={variant}
      state={mine?.state ?? { kind: "loading" }}
      canRequestNew={mine !== null && !mine.inFlight && !waiting}
      nextAvailableInSeconds={waiting ? secondsLeft : null}
      onRequestNew={reload}
      onRetry={reload}
    />
  );
}
