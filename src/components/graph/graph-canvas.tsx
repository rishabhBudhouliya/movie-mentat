"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { type PointerEvent, useCallback, useEffect, useMemo, useRef } from "react";
import {
  type Direction,
  findDirection,
  focusPoint,
  type Graph,
  JUNCTION_HALF,
  NODE_HALF,
  type Point,
} from "@/lib/graph";
import { MoviePoster } from "../movie-poster";
import { Avatar } from "./avatar";
import { directionColor } from "./colors";

gsap.registerPlugin(useGSAP);

// React renders every element at its final position (positions never change,
// decision 19). GSAP only animates: new elements grow out of where they were
// reached from, and the camera glides to whatever is in focus. Under
// prefers-reduced-motion everything simply appears and the camera jumps.

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Line = {
  key: string;
  from: Point;
  to: Point;
  color: string;
  dashed: boolean;
};

type Junction = {
  key: string;
  movieId: number;
  direction: Direction;
  movieTitle: string;
};

/** What to draw: lines, the actors on them, and the movies. */
function scene(graph: Graph) {
  const lines: Line[] = [];
  const junctions: Junction[] = [];

  for (const [movieId, node] of graph.nodes) {
    if (node.directions.kind !== "ready") continue;
    for (const direction of node.directions.value) {
      const taken = direction.films.kind !== "idle";
      // Untaken directions show only on the selected movie, as dashed stubs.
      if (!taken && movieId !== graph.selectedId) continue;
      const key = `${movieId}:${direction.actor.personId}`;
      junctions.push({ key, movieId, direction, movieTitle: node.movie.title });
      lines.push({
        key: `trunk:${key}`,
        from: node.pos,
        to: direction.junction,
        color: directionColor(direction.slot),
        dashed: direction.films.kind !== "ready",
      });
    }
  }

  for (const edge of graph.edges.values()) {
    const target = graph.nodes.get(edge.to);
    if (!target) continue;
    for (const personId of edge.via) {
      const direction = findDirection(graph, edge.from, personId);
      if (!direction) continue;
      lines.push({
        key: `branch:${edge.from}:${personId}>${edge.to}`,
        from: direction.junction,
        to: target.pos,
        color: directionColor(direction.slot),
        dashed: false,
      });
    }
  }
  return { lines, junctions };
}

/** Where a newly added element should grow from. */
function origin(graph: Graph, key: string): Point | null {
  const [kind, rest = ""] = key.split("|");
  if (kind === "node") {
    const via = graph.nodes.get(Number(rest))?.discoveredVia;
    return via ? (findDirection(graph, via.from, via.personId)?.junction ?? null) : null;
  }
  if (kind === "junction") {
    const [movieId] = rest.split(":");
    return graph.nodes.get(Number(movieId))?.pos ?? null;
  }
  return null;
}

export function GraphCanvas({
  graph,
  onSelect,
  onOpen,
  disabled = false,
}: {
  graph: Graph;
  onSelect: (movieId: number) => void;
  onOpen: (movieId: number, personId: number) => void;
  disabled?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const drag = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);
  const { lines, junctions } = useMemo(() => scene(graph), [graph]);
  const focus = focusPoint(graph);

  /** Moves the camera so `point` is in the middle of the viewport. */
  const centerOn = useCallback((point: Point, instant = false) => {
    const view = viewport.current;
    if (!view || !world.current) return;
    const x = view.clientWidth / 2 - point.x;
    const y = view.clientHeight / 2 - point.y;
    if (instant || reducedMotion()) gsap.set(world.current, { x, y });
    else gsap.to(world.current, { x, y, duration: 0.7, ease: "power3.out", overwrite: "auto" });
  }, []);

  // Grow in whatever wasn't on screen before.
  useGSAP(
    () => {
      const root = world.current;
      if (!root) return;
      const fresh = [...root.querySelectorAll<HTMLElement | SVGElement>("[data-key]")].filter(
        (el) => !seen.current.has(el.dataset.key ?? ""),
      );
      for (const el of fresh) seen.current.add(el.dataset.key ?? "");
      if (fresh.length === 0 || reducedMotion()) return;

      fresh.forEach((el, i) => {
        const key = el.dataset.key ?? "";
        const delay = Math.min(i, 8) * 0.04;
        if (el instanceof SVGLineElement) {
          gsap.from(el, {
            attr: { x2: el.x1.baseVal.value, y2: el.y1.baseVal.value },
            opacity: 0,
            duration: 0.45,
            delay,
            ease: "power2.out",
          });
          return;
        }
        const from = origin(graph, key);
        const left = Number(el.dataset.x);
        const top = Number(el.dataset.y);
        gsap.from(el, {
          x: from ? from.x - left : 0,
          y: from ? from.y - top : 0,
          scale: 0.3,
          opacity: 0,
          duration: 0.6,
          delay: delay + 0.1,
          ease: "back.out(1.5)",
          clearProps: "transform,opacity",
        });
      });
    },
    { dependencies: [graph], scope: world },
  );

  // Follow the focus: the selected movie, or the direction just opened. Keyed
  // on the coordinates, so only a real move re-centers (not every render).
  const { x: focusX, y: focusY } = focus;
  const first = useRef(true);
  useEffect(() => {
    centerOn({ x: focusX, y: focusY }, first.current);
    first.current = false;
  }, [focusX, focusY, centerOn]);

  // Keep the focus centered when the viewport changes size.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const observer = new ResizeObserver(() => centerOn(focusRef.current, true));
    observer.observe(view);
    return () => observer.disconnect();
  }, [centerOn]);

  // Drag the background to look around.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button") || !world.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      camX: Number(gsap.getProperty(world.current, "x")),
      camY: Number(gsap.getProperty(world.current, "y")),
    };
    gsap.killTweensOf(world.current);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || !world.current) return;
    gsap.set(world.current, {
      x: start.camX + event.clientX - start.x,
      y: start.camY + event.clientY - start.y,
    });
  }
  const endDrag = () => {
    drag.current = null;
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a pannable canvas of buttons, not a form; a fieldset would misdescribe it.
    <div
      ref={viewport}
      role="group"
      aria-label="Movie graph"
      aria-describedby="graph-help"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative h-[440px] touch-none overflow-hidden rounded-lg bg-[radial-gradient(circle,_#26262b_1px,_transparent_1.2px)] bg-[length:24px_24px] select-none sm:h-[600px] ${
        disabled ? "pointer-events-none opacity-50" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <p id="graph-help" className="sr-only">
        Movies are buttons: select one to see its fact. Actors are buttons too: open one to add
        their other leading roles to the graph. Drag the background to look around.
      </p>

      <div ref={world} className="absolute top-0 left-0" style={{ willChange: "transform" }}>
        <svg
          aria-hidden="true"
          className="absolute top-0 left-0 overflow-visible"
          width="1"
          height="1"
        >
          {lines.map((line) => (
            <line
              key={line.key}
              data-key={`line|${line.key}`}
              x1={line.from.x}
              y1={line.from.y}
              x2={line.to.x}
              y2={line.to.y}
              stroke={line.color}
              strokeWidth={line.key.startsWith("trunk") ? 3 : 2}
              strokeOpacity={line.key.startsWith("trunk") ? 0.9 : 0.5}
              strokeDasharray={line.dashed ? "6 6" : undefined}
              strokeLinecap="round"
            />
          ))}
        </svg>

        {junctions.map(({ key, movieId, direction, movieTitle }) => {
          const { actor, films, junction } = direction;
          const left = junction.x - JUNCTION_HALF.w;
          const top = junction.y - 22; // centers the avatar on the line's end
          const hint =
            films.kind === "idle"
              ? "Explore"
              : films.kind === "loading"
                ? "Finding films…"
                : films.kind === "failed"
                  ? "Retry"
                  : `${films.value.length} films`;
          return (
            <button
              key={key}
              type="button"
              data-key={`junction|${key}`}
              data-x={junction.x}
              data-y={junction.y}
              onClick={() => onOpen(movieId, actor.personId)}
              aria-label={`${actor.name}: ${films.kind === "ready" ? "show their films" : `explore their films from ${movieTitle}`}`}
              className="group absolute flex flex-col items-center gap-1 rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ left, top, width: JUNCTION_HALF.w * 2 }}
            >
              <Avatar
                name={actor.name}
                url={actor.profileUrl}
                color={directionColor(direction.slot)}
              />
              <span className="rounded-md bg-zinc-950/90 px-1.5 py-0.5 text-xs leading-tight font-bold text-zinc-100">
                {actor.name}
              </span>
              <span className="-mt-0.5 rounded-md bg-zinc-950/90 px-1.5 text-[11px] text-zinc-400 group-hover:text-zinc-200">
                {hint}
              </span>
            </button>
          );
        })}

        {[...graph.nodes].map(([movieId, node]) => {
          const selected = movieId === graph.selectedId;
          const left = node.pos.x - NODE_HALF.w;
          const top = node.pos.y - 52; // centers the poster on the lines' ends
          return (
            <button
              key={movieId}
              type="button"
              data-key={`node|${movieId}`}
              data-x={node.pos.x}
              data-y={node.pos.y}
              onClick={() => onSelect(movieId)}
              onFocus={() => centerOn(node.pos)}
              aria-pressed={selected}
              aria-label={`${node.movie.title}${node.movie.releaseYear ? ` (${node.movie.releaseYear})` : ""}${movieId === graph.rootId ? ", your favorite" : ""}`}
              className="group absolute flex flex-col items-center gap-1.5 rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ left, top, width: NODE_HALF.w * 2 }}
            >
              <span
                className={`rounded-md transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none ${
                  selected
                    ? "shadow-[0_0_0_3px_#09090b,0_0_0_6px_#fbbf24,0_14px_32px_rgba(0,0,0,.6)]"
                    : "shadow-[0_8px_20px_rgba(0,0,0,.5)]"
                }`}
              >
                <MoviePoster title={node.movie.title} posterUrl={node.movie.posterUrl} size="md" />
              </span>
              <span
                className={`line-clamp-2 text-xs leading-tight ${
                  selected ? "font-extrabold text-white" : "font-semibold text-zinc-300"
                }`}
              >
                {node.movie.title}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => centerOn(focus)}
        className="absolute right-3 bottom-3 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Recenter
      </button>
    </div>
  );
}
