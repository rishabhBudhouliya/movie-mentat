"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FactPanel } from "@/components/fact-panel";
import type { FactState } from "@/components/types";
import { api, type FactResponse } from "@/lib/api";

const FRESH_WINDOW_S = 60;

type Shown = { text: string; generatedAt: string };

/**
 * Loads the fact on mount and on "New fact". The server enforces the 60s
 * window; this only mirrors it so the button is enabled when a request can
 * actually produce a new fact. Previous text stays visible while refreshing.
 */
export function DashboardFact() {
  const [state, setState] = useState<FactState>({ kind: "loading" });
  const [eligibleAt, setEligibleAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [inFlight, setInFlight] = useState(false);
  const shown = useRef<Shown | null>(null);

  const load = useCallback(async () => {
    setInFlight(true);
    const previous = shown.current;
    if (previous) setState({ kind: "fact", ...previous, refreshing: true });

    const result = await api.getFact();
    setInFlight(false);

    if (result.ok) {
      const data: FactResponse = result.data;
      const { text, generatedAt, ageSeconds } = data.fact;
      shown.current = { text, generatedAt };
      // Convert the server's DB-clock age into a local deadline.
      setEligibleAt(Date.now() + Math.max(0, FRESH_WINDOW_S - ageSeconds) * 1000);
      setState(
        data.source === "fallback"
          ? { kind: "fallback", text, generatedAt, notice: data.notice }
          : { kind: "fact", text, generatedAt, refreshing: false },
      );
      return;
    }

    // Couldn't load: keep showing what we had, and say the refresh failed.
    setState(
      previous
        ? { kind: "fallback", ...previous, notice: result.error.message }
        : { kind: "error", message: result.error.message },
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick once a second so the button enables itself when the window passes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = eligibleAt === null ? null : Math.ceil((eligibleAt - now) / 1000);
  const waiting = secondsLeft !== null && secondsLeft > 0;

  return (
    <FactPanel
      state={state}
      canRequestNew={!inFlight && !waiting}
      nextAvailableInSeconds={waiting ? secondsLeft : null}
      onRequestNew={() => void load()}
      onRetry={() => void load()}
    />
  );
}
