import type { MovieSummary } from "@/components/types";
import type { CastMember } from "@/lib/api";

// The movie graph (PLAN.md decisions 15, 16, 19), Elm style: `update` is a
// pure function from (graph, message) to (graph, commands). The component
// runs the commands (API calls) and feeds their results back as messages.
//
// Invariants (graph.test.ts checks them over long random walks):
//   - Nodes are movies. A node's position is set once, when it's added, and
//     never changes. Nothing is ever removed (append-only).
//   - An edge goes from a movie, through one of its top-billed actors, to a
//     film where that actor also had a leading role. Its identity is
//     (from, to); `via` is the set of actors linking them. No self-loops.
//   - A direction shows at most FILMS_PER_DIRECTION films.
//   - Responses only apply to the request still waiting for them; a duplicate
//     or late one is ignored.

export const FILMS_PER_DIRECTION = 5;

export type Point = { readonly x: number; readonly y: number };

export type Loadable<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly message: string };

/** A way out of a movie: one of its top-billed actors. */
export type Direction = {
  readonly actor: CastMember;
  /** Billing position (0 = top billed). Fixes the direction's angle and color. */
  readonly slot: number;
  /** Angle from the movie toward the actor, in radians (screen coordinates: y grows down). */
  readonly heading: number;
  /** Where the actor sits on the canvas, between the movie and their films. */
  readonly junction: Point;
  /** The films this direction leads to, once opened. */
  readonly films: Loadable<readonly number[]>;
};

export type GraphNode = {
  readonly movie: MovieSummary;
  readonly pos: Point;
  /** Angle of arrival (radians), so its directions fan outward; null for the root. */
  readonly heading: number | null;
  /** How the movie was first reached; null for the root. */
  readonly discoveredVia: { readonly from: number; readonly personId: number } | null;
  readonly directions: Loadable<readonly Direction[]>;
};

export type Edge = { readonly from: number; readonly to: number; readonly via: readonly number[] };

/** What the view should center on. */
export type Focus =
  | { readonly kind: "movie"; readonly movieId: number }
  | { readonly kind: "direction"; readonly movieId: number; readonly personId: number };

export type Graph = {
  readonly rootId: number;
  readonly selectedId: number;
  readonly focus: Focus;
  /** In insertion order. */
  readonly nodes: ReadonlyMap<number, GraphNode>;
  readonly edges: ReadonlyMap<string, Edge>;
};

export type Msg =
  | { type: "select"; movieId: number }
  | { type: "castLoaded"; movieId: number; cast: readonly CastMember[] }
  | { type: "castFailed"; movieId: number; message: string }
  | { type: "open"; movieId: number; personId: number }
  | { type: "filmsLoaded"; movieId: number; personId: number; films: readonly MovieSummary[] }
  | { type: "filmsFailed"; movieId: number; personId: number; message: string };

export type Cmd =
  | { kind: "loadCast"; movieId: number }
  | { kind: "loadFilms"; movieId: number; personId: number };

export type Step = readonly [Graph, readonly Cmd[]];

export const edgeKey = (from: number, to: number) => `${from}>${to}`;

// ── Placement ──────────────────────────────────────────────────────────────
// Positions are computed once per node, when it's added, by fanning outward
// from where it was reached and then pushing along that ray until it's clear
// of everything already placed. Nothing already placed ever moves.

const DEG = Math.PI / 180;
/** The root's three directions: up, lower right, lower left. */
const ROOT_HEADINGS = [-90 * DEG, 30 * DEG, 150 * DEG];
/** Elsewhere: top billed straight ahead, the others to either side. */
const SLOT_OFFSETS = [0, -55 * DEG, 55 * DEG];
const JUNCTION_DISTANCE = 130;
const FILM_DISTANCE = 230;
const FILM_SPREAD = 26 * DEG;
const PUSH_STEP = 40;
const MAX_PUSHES = 200;

/** Half-sizes of what's drawn, for overlap checks. */
export const NODE_HALF = { w: 58, h: 76 } as const; // poster + two-line title
export const JUNCTION_HALF = { w: 62, h: 50 } as const; // avatar + name + hint

type Box = { pos: Point; half: { w: number; h: number } };

const along = (from: Point, angle: number, distance: number): Point => ({
  x: Math.round(from.x + Math.cos(angle) * distance),
  y: Math.round(from.y + Math.sin(angle) * distance),
});

const overlaps = (a: Box, b: Box) =>
  Math.abs(a.pos.x - b.pos.x) < a.half.w + b.half.w &&
  Math.abs(a.pos.y - b.pos.y) < a.half.h + b.half.h;

/** Everything on the canvas: movies, and the actors of every loaded movie. */
function occupied(graph: Graph): Box[] {
  const boxes: Box[] = [];
  for (const node of graph.nodes.values()) {
    boxes.push({ pos: node.pos, half: NODE_HALF });
    if (node.directions.kind === "ready") {
      for (const direction of node.directions.value) {
        boxes.push({ pos: direction.junction, half: JUNCTION_HALF });
      }
    }
  }
  return boxes;
}

/** The first point along the ray, from `distance` outward, where `half` fits. */
function placeOnRay(
  taken: Box[],
  origin: Point,
  angle: number,
  distance: number,
  half: Box["half"],
): Point {
  let pos = along(origin, angle, distance);
  for (let i = 0; i < MAX_PUSHES && taken.some((box) => overlaps(box, { pos, half })); i += 1) {
    pos = along(origin, angle, distance + PUSH_STEP * (i + 1));
  }
  return pos;
}

export function slotHeading(node: GraphNode, slot: number): number {
  return node.heading === null
    ? (ROOT_HEADINGS[slot] ?? 0)
    : node.heading + (SLOT_OFFSETS[slot] ?? 0);
}

function placeDirections(graph: Graph, node: GraphNode, cast: readonly CastMember[]): Direction[] {
  const taken = occupied(graph);
  return cast.map((actor, slot) => {
    const heading = slotHeading(node, slot);
    const junction = placeOnRay(taken, node.pos, heading, JUNCTION_DISTANCE, JUNCTION_HALF);
    taken.push({ pos: junction, half: JUNCTION_HALF });
    return { actor, slot, heading, junction, films: { kind: "idle" } };
  });
}

/** Positions for `count` new films fanned around the direction's heading. */
function placeFilms(graph: Graph, direction: Direction, count: number) {
  const taken = occupied(graph);
  return Array.from({ length: count }, (_, k) => {
    const angle = direction.heading + (k - (count - 1) / 2) * FILM_SPREAD;
    const pos = placeOnRay(taken, direction.junction, angle, FILM_DISTANCE, NODE_HALF);
    taken.push({ pos, half: NODE_HALF });
    return { pos, heading: angle };
  });
}

// ── Update ─────────────────────────────────────────────────────────────────

export function initialGraph(root: MovieSummary): Step {
  const node: GraphNode = {
    movie: root,
    pos: { x: 0, y: 0 },
    heading: null,
    discoveredVia: null,
    directions: { kind: "loading" },
  };
  const graph: Graph = {
    rootId: root.tmdbId,
    selectedId: root.tmdbId,
    focus: { kind: "movie", movieId: root.tmdbId },
    nodes: new Map([[root.tmdbId, node]]),
    edges: new Map(),
  };
  return [graph, [{ kind: "loadCast", movieId: root.tmdbId }]];
}

const withNode = (graph: Graph, id: number, node: GraphNode): Graph => ({
  ...graph,
  nodes: new Map(graph.nodes).set(id, node),
});

function withDirection(
  graph: Graph,
  movieId: number,
  personId: number,
  change: (direction: Direction) => Direction,
): Graph {
  const node = graph.nodes.get(movieId);
  if (node?.directions.kind !== "ready") return graph;
  const value = node.directions.value.map((d) => (d.actor.personId === personId ? change(d) : d));
  return withNode(graph, movieId, { ...node, directions: { kind: "ready", value } });
}

export function findDirection(
  graph: Graph,
  movieId: number,
  personId: number,
): Direction | undefined {
  const directions = graph.nodes.get(movieId)?.directions;
  return directions?.kind === "ready"
    ? directions.value.find((d) => d.actor.personId === personId)
    : undefined;
}

export function update(graph: Graph, msg: Msg): Step {
  switch (msg.type) {
    case "select": {
      const node = graph.nodes.get(msg.movieId);
      if (!node) return [graph, []];
      const selected: Graph = {
        ...graph,
        selectedId: msg.movieId,
        focus: { kind: "movie", movieId: msg.movieId },
      };
      // Selecting is step one: show the fact and offer the directions.
      if (node.directions.kind === "idle" || node.directions.kind === "failed") {
        return [
          withNode(selected, msg.movieId, { ...node, directions: { kind: "loading" } }),
          [{ kind: "loadCast", movieId: msg.movieId }],
        ];
      }
      return [selected, []];
    }

    case "castLoaded": {
      const node = graph.nodes.get(msg.movieId);
      if (node?.directions.kind !== "loading") return [graph, []];
      const value = placeDirections(graph, node, msg.cast);
      return [withNode(graph, msg.movieId, { ...node, directions: { kind: "ready", value } }), []];
    }

    case "castFailed": {
      const node = graph.nodes.get(msg.movieId);
      if (node?.directions.kind !== "loading") return [graph, []];
      return [
        withNode(graph, msg.movieId, {
          ...node,
          directions: { kind: "failed", message: msg.message },
        }),
        [],
      ];
    }

    case "open": {
      // Step two: pick an actor. An open direction is only re-centered on.
      const direction = findDirection(graph, msg.movieId, msg.personId);
      if (!direction) return [graph, []];
      const focused: Graph = {
        ...graph,
        focus: { kind: "direction", movieId: msg.movieId, personId: msg.personId },
      };
      if (direction.films.kind === "idle" || direction.films.kind === "failed") {
        return [
          withDirection(focused, msg.movieId, msg.personId, (d) => ({
            ...d,
            films: { kind: "loading" },
          })),
          [{ kind: "loadFilms", movieId: msg.movieId, personId: msg.personId }],
        ];
      }
      return [focused, []];
    }

    case "filmsLoaded": {
      const direction = findDirection(graph, msg.movieId, msg.personId);
      if (direction?.films.kind !== "loading") return [graph, []];

      // The film we came from is in the actor's list too; it isn't a way out.
      const seen = new Set<number>([msg.movieId]);
      const targets = msg.films
        .filter((film) => {
          if (seen.has(film.tmdbId)) return false;
          seen.add(film.tmdbId);
          return true;
        })
        .slice(0, FILMS_PER_DIRECTION);

      // A film already on screen gets a new edge, not a second node.
      const fresh = targets.filter((film) => !graph.nodes.has(film.tmdbId));
      const spots = placeFilms(graph, direction, fresh.length);
      const nodes = new Map(graph.nodes);
      fresh.forEach((film, i) => {
        const spot = spots[i];
        if (!spot) return;
        nodes.set(film.tmdbId, {
          movie: film,
          pos: spot.pos,
          heading: spot.heading,
          discoveredVia: { from: msg.movieId, personId: msg.personId },
          directions: { kind: "idle" },
        });
      });

      const edges = new Map(graph.edges);
      for (const film of targets) {
        const key = edgeKey(msg.movieId, film.tmdbId);
        const existing = edges.get(key);
        if (!existing) {
          edges.set(key, { from: msg.movieId, to: film.tmdbId, via: [msg.personId] });
        } else if (!existing.via.includes(msg.personId)) {
          edges.set(key, { ...existing, via: [...existing.via, msg.personId] });
        }
      }

      const ids = targets.map((film) => film.tmdbId);
      return [
        withDirection({ ...graph, nodes, edges }, msg.movieId, msg.personId, (d) => ({
          ...d,
          films: { kind: "ready", value: ids },
        })),
        [],
      ];
    }

    case "filmsFailed": {
      const direction = findDirection(graph, msg.movieId, msg.personId);
      if (direction?.films.kind !== "loading") return [graph, []];
      return [
        withDirection(graph, msg.movieId, msg.personId, (d) => ({
          ...d,
          films: { kind: "failed", message: msg.message },
        })),
        [],
      ];
    }
  }
}

// ── Queries for the view ───────────────────────────────────────────────────

/** The actors through which a movie was reached, in discovery order. */
export function arrivals(graph: Graph, movieId: number): CastMember[] {
  const actors: CastMember[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.to !== movieId) continue;
    for (const personId of edge.via) {
      const actor = findDirection(graph, edge.from, personId)?.actor;
      if (actor && !actors.some((a) => a.personId === actor.personId)) actors.push(actor);
    }
  }
  return actors;
}

/** The path of first discoveries from the root to `movieId`. */
export function trail(
  graph: Graph,
  movieId: number,
): { movie: MovieSummary; via: CastMember | null }[] {
  const steps: { movie: MovieSummary; via: CastMember | null }[] = [];
  let node = graph.nodes.get(movieId);
  // Bounded by the node count, so a malformed graph can't loop forever.
  for (let i = 0; node && i <= graph.nodes.size; i += 1) {
    const via = node.discoveredVia;
    steps.unshift({
      movie: node.movie,
      via: via ? (findDirection(graph, via.from, via.personId)?.actor ?? null) : null,
    });
    node = via ? graph.nodes.get(via.from) : undefined;
  }
  return steps;
}

/** The point the view should center on. */
export function focusPoint(graph: Graph): Point {
  const { focus } = graph;
  const node = graph.nodes.get(focus.movieId);
  if (!node) return { x: 0, y: 0 };
  if (focus.kind === "movie") return node.pos;
  const direction = findDirection(graph, focus.movieId, focus.personId);
  if (!direction) return node.pos;
  // The middle of the direction's spread: the junction and its films.
  const points = [direction.junction];
  if (direction.films.kind === "ready") {
    for (const id of direction.films.value) {
      const target = graph.nodes.get(id);
      if (target) points.push(target.pos);
    }
  }
  return {
    x: Math.round(points.reduce((sum, p) => sum + p.x, 0) / points.length),
    y: Math.round(points.reduce((sum, p) => sum + p.y, 0) / points.length),
  };
}
