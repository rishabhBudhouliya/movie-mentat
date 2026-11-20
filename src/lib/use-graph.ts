"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MovieSummary } from "@/components/types";
import { api } from "@/lib/api";
import { type Cmd, type Graph, initialGraph, type Msg, update } from "@/lib/graph";

/**
 * Runs the graph (lib/graph.ts) the Elm way: `dispatch` applies `update` and
 * performs the commands it returns; each API result comes back as a message.
 * A late response needs no guarding here: `update` ignores any response
 * nobody is waiting for. The graph starts from `root`; the caller remounts
 * (via `key`) to start over from a new favorite.
 */
export function useGraph(root: MovieSummary): { graph: Graph; dispatch: (msg: Msg) => void } {
  const [start] = useState(() => initialGraph(root));
  const [graph, setGraph] = useState<Graph>(start[0]);
  const latest = useRef<Graph>(start[0]);
  const mounted = useRef(false);

  const dispatch = useCallback((msg: Msg) => {
    if (!mounted.current) return; // a response that outlived this graph
    const [next, cmds] = update(latest.current, msg);
    latest.current = next;
    setGraph(next);
    for (const cmd of cmds) perform(cmd, dispatch);
  }, []);

  useEffect(() => {
    mounted.current = true;
    for (const cmd of start[1]) perform(cmd, dispatch);
    return () => {
      mounted.current = false;
    };
  }, [start, dispatch]);

  return { graph, dispatch };
}

function perform(cmd: Cmd, dispatch: (msg: Msg) => void): void {
  switch (cmd.kind) {
    case "loadCast":
      void api
        .getCast(cmd.movieId)
        .then((result) =>
          dispatch(
            result.ok
              ? { type: "castLoaded", movieId: cmd.movieId, cast: result.data.cast }
              : { type: "castFailed", movieId: cmd.movieId, message: result.error.message },
          ),
        );
      return;
    case "loadFilms":
      void api
        .getLeadingFilms(cmd.personId)
        .then((result) =>
          dispatch(
            result.ok
              ? { ...cmd, type: "filmsLoaded", films: result.data.films }
              : { ...cmd, type: "filmsFailed", message: result.error.message },
          ),
        );
      return;
  }
}
