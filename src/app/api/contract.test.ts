import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedUser } from "@/server/auth/session";

// Route-level contract tests. The session lookup needs Next's request
// context, so it's mocked; everything after it is the real handler.
const getCurrentUser = vi.fn<() => Promise<AuthedUser | null>>();
vi.mock("@/server/auth/current-user", () => ({ getCurrentUser: () => getCurrentUser() }));
const getFavoriteMovie = vi.fn();
vi.mock("@/server/movies/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/movies/repository")>()),
  getFavoriteMovie: () => getFavoriteMovie(),
}));
const getFact = vi.fn();
vi.mock("@/server/facts/service", () => ({ getFact: () => getFact() }));
const ensureMovie = vi.fn();
vi.mock("@/server/movies/snapshot", () => ({ ensureMovie: () => ensureMovie() }));
const getTopCast = vi.fn();
const getLeadingFilms = vi.fn();
vi.mock("@/server/tmdb/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tmdb/client")>()),
  getTopCast: () => getTopCast(),
  getLeadingFilms: () => getLeadingFilms(),
}));

const { GET: getMe } = await import("./me/route");
const { GET: getFactRoute } = await import("./fact/route");
const { GET: getCastRoute } = await import("./movies/[id]/cast/route");
const { GET: getFilmsRoute } = await import("./people/[id]/films/route");

const user = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  avatarUrl: null,
  favoriteMovieId: 438631,
} as unknown as AuthedUser;

const factRequest = (movieId?: number | string) =>
  new NextRequest(`http://localhost:3000/api/fact${movieId ? `?movieId=${movieId}` : ""}`);

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const anyRequest = () => new NextRequest("http://localhost:3000/");

describe("API error contract: { error: { code, message } }", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 without a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMe();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Sign in to continue." },
    });
  });

  it("500 in the same shape when the database fails, not a bare framework error", async () => {
    getCurrentUser.mockResolvedValue(user);
    getFavoriteMovie.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await getMe();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Something went wrong on our side. Try again." },
    });
  });

  it("GET /api/fact rejects a missing or malformed movieId (400) before any lookup", async () => {
    getCurrentUser.mockResolvedValue(user);

    for (const bad of [undefined, "abc", "-3", "1.5", "99999999999"]) {
      const response = await getFactRoute(factRequest(bad));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_movie_id");
    }
    expect(ensureMovie).not.toHaveBeenCalled();
    expect(getFact).not.toHaveBeenCalled();
  });

  it("GET /api/fact: a movie the catalog doesn't know is 404, and never reaches OpenAI", async () => {
    getCurrentUser.mockResolvedValue(user);
    ensureMovie.mockResolvedValue({ kind: "not_found" });

    const response = await getFactRoute(factRequest(999999));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("movie_not_found");
    expect(getFact).not.toHaveBeenCalled();
  });

  it("GET /api/fact answers for any movie in the graph, not only the favorite", async () => {
    getCurrentUser.mockResolvedValue(user);
    ensureMovie.mockResolvedValue({ kind: "ok" });
    getFact.mockResolvedValue({
      kind: "cached",
      fact: {
        id: "f1",
        text: "A fact.",
        createdAt: new Date("2026-11-19T00:00:00Z"),
        ageSeconds: 12,
      },
    });

    const response = await getFactRoute(factRequest(329865)); // Arrival, not the favorite

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      source: "cached",
      fact: { id: "f1", text: "A fact.", generatedAt: "2026-11-19T00:00:00.000Z", ageSeconds: 12 },
    });
  });

  it("GET /api/fact maps an unavailable fact to a retryable 503", async () => {
    getCurrentUser.mockResolvedValue(user);
    ensureMovie.mockResolvedValue({ kind: "ok" });
    getFact.mockResolvedValue({ kind: "unavailable", cause: "timeout" });

    const response = await getFactRoute(factRequest(438631));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("fact_unavailable");
  });

  it("GET /api/fact: busy with nothing saved is a 429; with a saved fact, a disclosed fallback", async () => {
    getCurrentUser.mockResolvedValue(user);
    ensureMovie.mockResolvedValue({ kind: "ok" });

    getFact.mockResolvedValueOnce({ kind: "unavailable", cause: "busy" });
    const none = await getFactRoute(factRequest(438631));
    expect(none.status).toBe(429);
    expect((await none.json()).error.code).toBe("too_many_generations");

    getFact.mockResolvedValueOnce({
      kind: "fallback",
      cause: "busy",
      fact: { id: "f1", text: "Old.", createdAt: new Date("2026-11-19T00:00:00Z"), ageSeconds: 90 },
    });
    const saved = await getFactRoute(factRequest(438631));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ source: "fallback", notice: expect.any(String) });
  });
});

describe("graph routes (decision 15)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("both require a session (401)", async () => {
    getCurrentUser.mockResolvedValue(null);

    expect((await getCastRoute(anyRequest(), withId("27205"))).status).toBe(401);
    expect((await getFilmsRoute(anyRequest(), withId("2524"))).status).toBe(401);
    expect(getTopCast).not.toHaveBeenCalled();
    expect(getLeadingFilms).not.toHaveBeenCalled();
  });

  it("GET /api/movies/:id/cast returns the cast with image URLs, cacheable by the browser only", async () => {
    getCurrentUser.mockResolvedValue(user);
    getTopCast.mockResolvedValue({
      kind: "ok",
      value: [
        { personId: 6193, name: "Leonardo DiCaprio", character: "Dom Cobb", profilePath: "/p.jpg" },
      ],
    });

    const response = await getCastRoute(anyRequest(), withId("27205"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(await response.json()).toEqual({
      cast: [
        {
          personId: 6193,
          name: "Leonardo DiCaprio",
          character: "Dom Cobb",
          profileUrl: "https://image.tmdb.org/t/p/w185/p.jpg",
        },
      ],
    });
  });

  it("GET /api/people/:id/films returns movie summaries", async () => {
    getCurrentUser.mockResolvedValue(user);
    getLeadingFilms.mockResolvedValue({
      kind: "ok",
      value: [{ tmdbId: 76341, title: "Mad Max: Fury Road", releaseYear: 2015, posterPath: null }],
    });

    const response = await getFilmsRoute(anyRequest(), withId("2524"));

    expect(await response.json()).toEqual({
      films: [{ tmdbId: 76341, title: "Mad Max: Fury Road", releaseYear: 2015, posterUrl: null }],
    });
  });

  it("bad ids are 400, unknown ids 404, and a catalog outage 503", async () => {
    getCurrentUser.mockResolvedValue(user);

    expect((await getCastRoute(anyRequest(), withId("x"))).status).toBe(400);
    expect((await getFilmsRoute(anyRequest(), withId("0"))).status).toBe(400);

    getTopCast.mockResolvedValueOnce({ kind: "ok", value: null });
    expect((await getCastRoute(anyRequest(), withId("1"))).status).toBe(404);
    getLeadingFilms.mockResolvedValueOnce({ kind: "ok", value: null });
    expect((await getFilmsRoute(anyRequest(), withId("1"))).status).toBe(404);

    getTopCast.mockResolvedValueOnce({ kind: "unavailable" });
    const down = await getCastRoute(anyRequest(), withId("1"));
    expect(down.status).toBe(503);
    expect((await down.json()).error.code).toBe("catalog_unavailable");
  });
});
