"use client";

import { GraphCanvas } from "@/components/graph/graph-canvas";
import { NowViewing } from "@/components/now-viewing";
import type { MovieSummary } from "@/components/types";
import { arrivals, trail } from "@/lib/graph";
import { useGraph } from "@/lib/use-graph";
import { DashboardFact } from "./dashboard-fact";

/**
 * "Now viewing" plus the graph below it (decisions 15, 19, 20). The graph
 * starts at `root`, the confirmed favorite; the parent remounts this
 * component (keyed by the favorite) when that changes, which resets the graph
 * and its fact cache together.
 *
 * `pending` is a favorite change being saved: the card shows it with its fact
 * hidden (Variant B), and the graph waits. If the save fails, `pending` goes
 * back to null and everything is as it was, fact included.
 */
export function Explorer({
  userId,
  root,
  pending,
}: {
  userId: string;
  root: MovieSummary;
  pending: MovieSummary | null;
}) {
  const { graph, dispatch } = useGraph(root);
  const selected = graph.nodes.get(graph.selectedId);
  if (!selected) return null; // unreachable: selection always names a node
  const select = (movieId: number) => dispatch({ type: "select", movieId });
  const steps = trail(graph, graph.selectedId);

  return (
    <>
      {/* One tree for both cases, so DashboardFact (and its cache) stays mounted
          while a save is pending, and a failed save restores the fact at once. */}
      <NowViewing
        movie={pending ?? selected.movie}
        isFavorite={pending !== null || graph.selectedId === graph.rootId}
        arrivedVia={pending ? [] : arrivals(graph, graph.selectedId)}
        fact={
          <>
            {pending ? <SavingFact /> : null}
            <div hidden={pending !== null}>
              <DashboardFact
                userId={userId}
                movieId={pending ? null : graph.selectedId}
                variant="hero"
              />
            </div>
          </>
        }
        directions={pending ? null : selected.directions}
        onOpen={(personId) => dispatch({ type: "open", movieId: graph.selectedId, personId })}
        onRetryCast={() => select(graph.selectedId)}
      />

      <section aria-labelledby="explore-title" className="rounded-xl bg-zinc-900/60 p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 id="explore-title" className="text-lg font-extrabold text-white">
              Explore
            </h2>
            <ol
              aria-label="Path from your favorite"
              className="flex flex-wrap items-center gap-1.5 text-sm"
            >
              {steps.map((step, i) => {
                const last = i === steps.length - 1;
                return (
                  <li key={step.movie.tmdbId} className="flex items-center gap-1.5">
                    {step.via ? (
                      <span className="text-zinc-500">
                        › via <span className="font-semibold text-zinc-300">{step.via.name}</span> ›
                      </span>
                    ) : null}
                    {last ? (
                      <span aria-current="page" className="font-extrabold text-white">
                        {step.movie.title}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={pending !== null}
                        onClick={() => select(step.movie.tmdbId)}
                        className="rounded text-zinc-400 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        {step.movie.title}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          {graph.selectedId !== graph.rootId ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => select(graph.rootId)}
              className="rounded-full border border-zinc-700 px-3.5 py-1.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Back to favorite
            </button>
          ) : null}
        </div>
        <GraphCanvas
          graph={graph}
          onSelect={select}
          onOpen={(movieId, personId) => dispatch({ type: "open", movieId, personId })}
          disabled={pending !== null}
        />
      </section>
    </>
  );
}

function SavingFact() {
  return (
    <p role="status" className="text-lg text-zinc-300">
      Saving your new favorite. Its fact loads once the save is confirmed.
    </p>
  );
}
