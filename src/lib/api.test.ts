import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function respond(body: unknown, status: number) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("typed API client error handling", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("parses a successful, well-shaped response", async () => {
    const movie = { tmdbId: 1, title: "Dune", releaseYear: 2021, posterUrl: null };
    fetchMock.mockResolvedValue(respond({ movie }, 200));

    expect(await api.setFavoriteMovie(1)).toEqual({ ok: true, data: { movie } });
  });

  it("passes through the server's error shape on 401", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: { code: "unauthorized", message: "Sign in to continue." } }, 401),
    );

    expect(await api.searchMovies("Dune")).toEqual({
      ok: false,
      error: { status: 401, code: "unauthorized", message: "Sign in to continue." },
    });
  });

  it("normalizes a 500 without a JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    expect(await api.searchMovies("Dune")).toEqual({
      ok: false,
      error: { status: 500, code: "http_error", message: "Something went wrong. Try again." },
    });
  });

  it("normalizes network failures and unexpected success shapes", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await api.searchMovies("Dune")).toMatchObject({
      ok: false,
      error: { status: 0, code: "network_error" },
    });

    fetchMock.mockResolvedValueOnce(respond({ movies: "nope" }, 200));
    expect(await api.searchMovies("Dune")).toMatchObject({
      ok: false,
      error: { code: "bad_response" },
    });
  });
});
