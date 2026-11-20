import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMovieQuery } from "@/lib/movie-query";
import { getMovie, MAX_RESULTS, searchMovies } from "./client";

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
});
