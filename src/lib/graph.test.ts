import { describe, expect, it } from "vitest";
import type { MovieSummary } from "@/components/types";
import type { CastMember } from "@/lib/api";
import {
  arrivals,
  type Cmd,
  edgeKey,
  FILMS_PER_DIRECTION,
  findDirection,
  focusPoint,
  type Graph,
  initialGraph,
  JUNCTION_HALF,
  type Msg,
  NODE_HALF,
  trail,
  update,
} from "./graph";

const movie = (tmdbId: number, title = `Movie ${tmdbId}`): MovieSummary => ({
  tmdbId,
  title,
  releaseYear: 2010,
  posterUrl: null,
});
const actor = (personId: number, name = `Actor ${personId}`): CastMember => ({
  personId,
  name,
  character: null,
  profileUrl: null,
});

const INCEPTION = movie(27205, "Inception");
const DICAPRIO = actor(6193, "Leonardo DiCaprio");
const GORDON_LEVITT = actor(24045, "Joseph Gordon-Levitt");
const WATANABE = actor(3899, "Ken Watanabe");
const REVENANT = movie(281957, "The Revenant");

/** Applies messages in order, collecting every command issued. */
function run(start: readonly [Graph, readonly Cmd[]], ...msgs: Msg[]) {
  let [graph, cmds] = start;
  const all: Cmd[] = [...cmds];
  for (const msg of msgs) {
    [graph, cmds] = update(graph, msg);
    all.push(...cmds);
  }
  return { graph, cmds: all, last: cmds };
}

const withCast = (...msgs: Msg[]) =>
  run(
    initialGraph(INCEPTION),
    { type: "castLoaded", movieId: INCEPTION.tmdbId, cast: [DICAPRIO, GORDON_LEVITT, WATANABE] },
    ...msgs,
  );

describe("movie graph: the two-step click", () => {
  it("starts at the favorite, selected, with its cast requested", () => {
    const [graph, cmds] = initialGraph(INCEPTION);

    expect(graph.selectedId).toBe(INCEPTION.tmdbId);
    expect(graph.nodes.get(INCEPTION.tmdbId)?.directions.kind).toBe("loading");
    expect(cmds).toEqual([{ kind: "loadCast", movieId: INCEPTION.tmdbId }]);
  });

  it("step one: the cast becomes three directions, in billing order, around the movie", () => {
    const { graph } = withCast();
    const directions = graph.nodes.get(INCEPTION.tmdbId)?.directions;

    expect(directions?.kind).toBe("ready");
    if (directions?.kind !== "ready") return;
    expect(directions.value.map((d) => [d.actor.name, d.slot, d.films.kind])).toEqual([
      ["Leonardo DiCaprio", 0, "idle"],
      ["Joseph Gordon-Levitt", 1, "idle"],
      ["Ken Watanabe", 2, "idle"],
    ]);
    expect(directions.value[0]?.junction.y).toBeLessThan(0); // top billed points up from the root
  });

  it("step two: opening a direction requests the actor's films, once", () => {
    const open: Msg = { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId };
    const first = withCast(open);
    const again = run([first.graph, []], open);

    expect(first.last).toEqual([
      { kind: "loadFilms", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
    ]);
    expect(again.cmds).toEqual([]); // already loading
    expect(again.graph.focus).toEqual({
      kind: "direction",
      movieId: INCEPTION.tmdbId,
      personId: DICAPRIO.personId,
    });
  });

  it("films become nodes linked through the actor; the film we came from is dropped", () => {
    const films = [INCEPTION, REVENANT, movie(1), movie(2), movie(3), movie(4), movie(5)];
    const { graph } = withCast(
      { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
      { type: "filmsLoaded", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId, films },
    );

    const direction = findDirection(graph, INCEPTION.tmdbId, DICAPRIO.personId);
    expect(direction?.films).toEqual({ kind: "ready", value: [281957, 1, 2, 3, 4] });
    expect(graph.nodes.size).toBe(1 + FILMS_PER_DIRECTION);
    expect(graph.edges.has(edgeKey(INCEPTION.tmdbId, INCEPTION.tmdbId))).toBe(false);
    expect(graph.edges.get(edgeKey(INCEPTION.tmdbId, REVENANT.tmdbId))).toEqual({
      from: INCEPTION.tmdbId,
      to: REVENANT.tmdbId,
      via: [DICAPRIO.personId],
    });
    expect(graph.nodes.get(REVENANT.tmdbId)?.discoveredVia).toEqual({
      from: INCEPTION.tmdbId,
      personId: DICAPRIO.personId,
    });
  });

  it("a film reached through two actors is one node with one edge carrying both", () => {
    const { graph } = withCast(
      { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
      {
        type: "filmsLoaded",
        movieId: INCEPTION.tmdbId,
        personId: DICAPRIO.personId,
        films: [REVENANT],
      },
      { type: "open", movieId: INCEPTION.tmdbId, personId: WATANABE.personId },
      {
        type: "filmsLoaded",
        movieId: INCEPTION.tmdbId,
        personId: WATANABE.personId,
        films: [REVENANT, movie(9)],
      },
    );

    expect([...graph.nodes.keys()]).toEqual([INCEPTION.tmdbId, REVENANT.tmdbId, 9]);
    expect(graph.edges.get(edgeKey(INCEPTION.tmdbId, REVENANT.tmdbId))?.via).toEqual([
      DICAPRIO.personId,
      WATANABE.personId,
    ]);
    expect(arrivals(graph, REVENANT.tmdbId).map((a) => a.name)).toEqual([
      "Leonardo DiCaprio",
      "Ken Watanabe",
    ]);
  });

  it("selecting a discovered film loads its own directions; the trail leads back to the root", () => {
    const { graph, last } = withCast(
      { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
      {
        type: "filmsLoaded",
        movieId: INCEPTION.tmdbId,
        personId: DICAPRIO.personId,
        films: [REVENANT],
      },
      { type: "select", movieId: REVENANT.tmdbId },
    );

    expect(graph.selectedId).toBe(REVENANT.tmdbId);
    expect(last).toEqual([{ kind: "loadCast", movieId: REVENANT.tmdbId }]);
    expect(trail(graph, REVENANT.tmdbId).map((s) => [s.movie.title, s.via?.name ?? null])).toEqual([
      ["Inception", null],
      ["The Revenant", "Leonardo DiCaprio"],
    ]);
  });
});

describe("movie graph: late, duplicate, and failed responses", () => {
  it("ignores a cast or films response nobody is waiting for", () => {
    const { graph } = withCast();
    const stale = run(
      [graph, []],
      { type: "castLoaded", movieId: INCEPTION.tmdbId, cast: [actor(1)] }, // already loaded
      { type: "castFailed", movieId: INCEPTION.tmdbId, message: "late" },
      { type: "filmsLoaded", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId, films: [] }, // never opened
      { type: "castLoaded", movieId: 404, cast: [] }, // not in the graph
      { type: "select", movieId: 404 },
    );

    expect(stale.graph).toEqual(graph);
    expect(stale.cmds).toEqual([]);
  });

  it("a failed direction can be retried, and a failed cast reloads on the next select", () => {
    const open: Msg = { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId };
    const failed = withCast(open, {
      type: "filmsFailed",
      movieId: INCEPTION.tmdbId,
      personId: DICAPRIO.personId,
      message: "Movie catalog is unavailable. Try again.",
    });
    expect(findDirection(failed.graph, INCEPTION.tmdbId, DICAPRIO.personId)?.films.kind).toBe(
      "failed",
    );
    expect(run([failed.graph, []], open).cmds).toEqual([
      { kind: "loadFilms", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
    ]);

    const castDown = run(initialGraph(INCEPTION), {
      type: "castFailed",
      movieId: INCEPTION.tmdbId,
      message: "down",
    });
    expect(run([castDown.graph, []], { type: "select", movieId: INCEPTION.tmdbId }).cmds).toEqual([
      { kind: "loadCast", movieId: INCEPTION.tmdbId },
    ]);
  });

  it("a movie with no billed cast simply offers no directions", () => {
    const { graph } = run(initialGraph(INCEPTION), {
      type: "castLoaded",
      movieId: INCEPTION.tmdbId,
      cast: [],
    });
    expect(graph.nodes.get(INCEPTION.tmdbId)?.directions).toEqual({ kind: "ready", value: [] });
  });
});

describe("movie graph: invariants over a long random walk", () => {
  // A deterministic fake catalog: every movie has three billed actors, every
  // actor leads seven films, and films are shared between actors so the walk
  // keeps running into nodes that already exist.
  const castOf = (movieId: number) =>
    [0, 1, 2].map((i) => actor(((movieId * 7 + i * 13) % 40) + 1));
  const filmsOf = (personId: number) =>
    Array.from({ length: 7 }, (_, i) => movie(((personId * 11 + i * 17) % 90) + 100));

  function seeded(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
      return s / 2_147_483_648;
    };
  }

  function walk(seed: number, steps: number) {
    const random = seeded(seed);
    let [graph, pending] = initialGraph(movie(100, "Root"));
    let queue: Cmd[] = [...pending];
    const history: Graph[] = [graph];
    const send = (msg: Msg) => {
      [graph, pending] = update(graph, msg);
      queue.push(...pending);
      history.push(graph);
    };
    for (let i = 0; i < steps; i += 1) {
      // Answer every outstanding request (sometimes with a failure), then act.
      const answering = queue;
      queue = [];
      for (const cmd of answering) {
        const fail = random() < 0.1;
        if (cmd.kind === "loadCast") {
          send(
            fail
              ? { type: "castFailed", movieId: cmd.movieId, message: "down" }
              : { type: "castLoaded", movieId: cmd.movieId, cast: castOf(cmd.movieId) },
          );
        } else {
          send(
            fail
              ? { ...cmd, type: "filmsFailed", message: "down" }
              : { ...cmd, type: "filmsLoaded", films: filmsOf(cmd.personId) },
          );
        }
      }
      const ids = [...graph.nodes.keys()];
      const target = ids[Math.floor(random() * ids.length)] ?? graph.rootId;
      send({ type: "select", movieId: target });
      const directions = graph.nodes.get(target)?.directions;
      if (directions?.kind === "ready" && directions.value.length > 0) {
        const pick = directions.value[Math.floor(random() * directions.value.length)];
        if (pick) send({ type: "open", movieId: target, personId: pick.actor.personId });
      }
    }
    return { graph, history };
  }

  it.each([1, 2, 3])("seed %i: positions never move and nothing is removed", (seed) => {
    const { history } = walk(seed, 60);
    for (let i = 1; i < history.length; i += 1) {
      const before = history[i - 1];
      const after = history[i];
      if (!before || !after) continue;
      for (const [id, node] of before.nodes) {
        expect(after.nodes.get(id)?.pos).toEqual(node.pos);
      }
      for (const [key, edge] of before.edges) {
        expect(after.edges.get(key)?.via.slice(0, edge.via.length)).toEqual(edge.via);
      }
    }
  });

  it.each([1, 2, 3])("seed %i: well-formed edges, capped directions, nothing overlaps", (seed) => {
    const { graph } = walk(seed, 60);
    expect(graph.nodes.size).toBeGreaterThan(20); // the walk really explored

    for (const edge of graph.edges.values()) {
      expect(edge.from).not.toBe(edge.to);
      expect(graph.nodes.has(edge.from) && graph.nodes.has(edge.to)).toBe(true);
      expect(edge.via.length).toBeGreaterThan(0);
      for (const personId of edge.via) {
        const direction = findDirection(graph, edge.from, personId);
        expect(direction?.films.kind === "ready" && direction.films.value).toContain(edge.to);
      }
    }

    const boxes: { pos: { x: number; y: number }; half: { w: number; h: number } }[] = [];
    for (const node of graph.nodes.values()) {
      boxes.push({ pos: node.pos, half: NODE_HALF });
      if (node.directions.kind !== "ready") continue;
      for (const direction of node.directions.value) {
        boxes.push({ pos: direction.junction, half: JUNCTION_HALF });
        if (direction.films.kind === "ready") {
          expect(direction.films.value.length).toBeLessThanOrEqual(FILMS_PER_DIRECTION);
        }
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const overlap =
          Math.abs(a.pos.x - b.pos.x) < a.half.w + b.half.w &&
          Math.abs(a.pos.y - b.pos.y) < a.half.h + b.half.h;
        expect(overlap, `boxes ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  it("the focus point is the movie, or the middle of an opened direction", () => {
    const { graph } = withCast(
      { type: "open", movieId: INCEPTION.tmdbId, personId: DICAPRIO.personId },
      {
        type: "filmsLoaded",
        movieId: INCEPTION.tmdbId,
        personId: DICAPRIO.personId,
        films: [REVENANT],
      },
    );
    const junction = findDirection(graph, INCEPTION.tmdbId, DICAPRIO.personId)?.junction;
    const film = graph.nodes.get(REVENANT.tmdbId)?.pos;
    if (!junction || !film) throw new Error("expected a placed direction");

    expect(focusPoint(graph)).toEqual({
      x: Math.round((junction.x + film.x) / 2),
      y: Math.round((junction.y + film.y) / 2),
    });
    expect(focusPoint(update(graph, { type: "select", movieId: REVENANT.tmdbId })[0])).toEqual(
      film,
    );
  });
});
