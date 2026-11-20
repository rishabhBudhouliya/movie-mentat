import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMovieQuery } from "@/lib/movie-query";
import {
  getLeadingFilms,
  getMovie,
  getTopCast,
  LEADING_FILMS_LIMIT,
  MAX_RESULTS,
  searchMovies,
} from "./client";

const now = new Date("2026-11-19T00:00:00Z");

function okQuery(text: string) {
  const parsed = parseMovieQuery(text, now);
  if (parsed.kind !== "ok") throw new Error("expected a valid query");
  return parsed;
}

const dune2021 = { id: 438631, title: "Dune", release_date: "2021-09-15", poster_path: "/p.jpg" };
const dune1984 = { id: 841, title: "Dune", release_date: "1984-12-14", poster_path: null };

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TMDB client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("TMDB_READ_TOKEN", "test-token");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("maps results, sends the bearer token, and skips malformed entries", async () => {
    fetchMock.mockResolvedValue(
      respond({ results: [dune2021, { id: "bad" }, { ...dune1984, release_date: "" }] }),
    );

    const result = await searchMovies(okQuery("Dune"));

    expect(result).toEqual({
      kind: "ok",
      value: [
        { tmdbId: 438631, title: "Dune", releaseYear: 2021, posterPath: "/p.jpg" },
        { tmdbId: 841, title: "Dune", releaseYear: null, posterPath: null },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/search/movie?query=Dune");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("with a trailing year, searches title+year and full text, year matches first, no duplicates", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("year=1984")
        ? respond({ results: [dune1984] })
        : respond({ results: [dune2021, dune1984] }),
    );

    const result = await searchMovies(okQuery("Dune 1984"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind === "ok" && result.value.map((m) => m.tmdbId)).toEqual([841, 438631]);
  });

  it("returns at most five suggestions", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...dune2021, id: 1000 + i }));
    fetchMock.mockResolvedValue(respond({ results: many }));

    const result = await searchMovies(okQuery("Dune"));

    expect(result.kind === "ok" && result.value.length).toBe(MAX_RESULTS);
    expect(MAX_RESULTS).toBe(5);
  });

  it("reports the catalog as unavailable on HTTP errors, timeouts, and bad JSON", async () => {
    fetchMock.mockResolvedValueOnce(respond({}, 503));
    expect(await searchMovies(okQuery("Dune"))).toEqual({ kind: "unavailable" });

    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await searchMovies(okQuery("Dune"))).toEqual({ kind: "unavailable" });

    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await searchMovies(okQuery("Dune"))).toEqual({ kind: "unavailable" });
  });

  it("getMovie: found, not in catalog (404), and unavailable", async () => {
    fetchMock.mockResolvedValueOnce(respond(dune2021));
    expect(await getMovie(438631)).toMatchObject({ kind: "ok", value: { tmdbId: 438631 } });

    fetchMock.mockResolvedValueOnce(respond({ status_message: "not found" }, 404));
    expect(await getMovie(999)).toEqual({ kind: "ok", value: null });

    fetchMock.mockResolvedValueOnce(respond({}, 500));
    expect(await getMovie(1)).toEqual({ kind: "unavailable" });

    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect(await getMovie(1)).toEqual({ kind: "unavailable" });
  });

  describe("graph data (decision 15)", () => {
    // Shapes and quirks taken from live TMDB responses (Inception, Tom Hardy).
    const castEntry = (id: number, name: string, order: number, character = "Role") => ({
      id,
      name,
      character,
      order,
      profile_path: `/${id}.jpg`,
      known_for_department: "Acting",
    });

    it("getTopCast: the three top-billed, in billing order, skipping self credits and repeats", async () => {
      fetchMock.mockResolvedValue(
        respond({
          id: 27205,
          cast: [
            castEntry(3899, "Ken Watanabe", 2, "Saito"),
            castEntry(6193, "Leonardo DiCaprio", 0, "Dom Cobb"),
            castEntry(6193, "Leonardo DiCaprio", 1, "Dom Cobb (voice)"), // same person twice
            castEntry(99, "A Narrator", 1, "Himself"),
            castEntry(24045, "Joseph Gordon-Levitt", 3, "Arthur"),
            castEntry(2524, "Tom Hardy", 4, "Eames"),
            { id: "bad" },
          ],
          crew: [],
        }),
      );

      const result = await getTopCast(27205);

      expect(result).toEqual({
        kind: "ok",
        value: [
          {
            personId: 6193,
            name: "Leonardo DiCaprio",
            character: "Dom Cobb",
            profilePath: "/6193.jpg",
          },
          { personId: 3899, name: "Ken Watanabe", character: "Saito", profilePath: "/3899.jpg" },
          {
            personId: 24045,
            name: "Joseph Gordon-Levitt",
            character: "Arthur",
            profilePath: "/24045.jpg",
          },
        ],
      });
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/movie/27205/credits");
    });

    it("getTopCast: not found, unavailable, and an empty cast", async () => {
      fetchMock.mockResolvedValueOnce(respond({ status_message: "not found" }, 404));
      expect(await getTopCast(1)).toEqual({ kind: "ok", value: null });

      fetchMock.mockResolvedValueOnce(respond({}, 500));
      expect(await getTopCast(1)).toEqual({ kind: "unavailable" });

      fetchMock.mockResolvedValueOnce(respond({ id: 1, cast: [], crew: [] }));
      expect(await getTopCast(1)).toEqual({ kind: "ok", value: [] });
    });

    const credit = (id: number, title: string, order: number, votes: number, extra = {}) => ({
      id,
      title,
      release_date: "2015-05-13",
      poster_path: `/${id}.jpg`,
      order,
      character: "Role",
      vote_count: votes,
      adult: false,
      video: false,
      ...extra,
    });

    it("getLeadingFilms: leading roles only (order < 5), most voted first, no featurettes", async () => {
      fetchMock.mockResolvedValue(
        respond({
          id: 2524,
          cast: [
            credit(281957, "The Revenant", 1, 19959),
            credit(76341, "Mad Max: Fury Road", 0, 24982),
            credit(49026, "The Dark Knight Rises", 2, 25352),
            credit(155, "A cameo", 9, 50000), // billed too low
            credit(1001, "Going Mad: The Battle of Fury Road", 1, 40, { character: "Self" }),
            credit(1002, "It's a Mad Max World", 2, 30, { character: "Self (archive footage)" }),
            credit(1003, "A direct-to-video short", 0, 99999, { video: true }),
            credit(1004, "An adult title", 0, 99999, { adult: true }),
            credit(76341, "Mad Max: Fury Road", 3, 24982), // a second credit, same film
          ],
          crew: [],
        }),
      );

      const result = await getLeadingFilms(2524);

      expect(result.kind === "ok" && result.value?.map((film) => film.title)).toEqual([
        "The Dark Knight Rises",
        "Mad Max: Fury Road",
        "The Revenant",
      ]);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/person/2524/movie_credits");
    });

    it("getLeadingFilms: caps the list, keeping one spare for the film you came from", async () => {
      const many = Array.from({ length: 12 }, (_, i) => credit(500 + i, `Film ${i}`, 0, 100 - i));
      fetchMock.mockResolvedValue(respond({ id: 1, cast: many, crew: [] }));

      const result = await getLeadingFilms(1);

      expect(result.kind === "ok" && result.value?.length).toBe(LEADING_FILMS_LIMIT);
      expect(LEADING_FILMS_LIMIT).toBe(6);
    });

    it("getLeadingFilms: not found and unavailable", async () => {
      fetchMock.mockResolvedValueOnce(respond({}, 404));
      expect(await getLeadingFilms(1)).toEqual({ kind: "ok", value: null });

      fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      expect(await getLeadingFilms(1)).toEqual({ kind: "unavailable" });
    });
  });
});
