import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthedUser } from "@/server/auth/session";

// Route-level contract tests. The session lookup needs Next's request
// context, so it's mocked; everything after it is the real handler.
const getCurrentUser = vi.fn<() => Promise<AuthedUser | null>>();
vi.mock("@/server/auth/current-user", () => ({ getCurrentUser: () => getCurrentUser() }));
const getFavoriteMovie = vi.fn();
vi.mock("@/server/movies/repository", () => ({ getFavoriteMovie: () => getFavoriteMovie() }));
const getFact = vi.fn();
vi.mock("@/server/facts/service", () => ({ getFact: () => getFact() }));

const { GET: getMe } = await import("./me/route");
const { GET: getFactRoute } = await import("./fact/route");

const user = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  avatarUrl: null,
  favoriteMovieId: 438631,
} as unknown as AuthedUser;

const factRequest = (movieId?: number) =>
  new NextRequest(`http://localhost:3000/api/fact${movieId ? `?movieId=${movieId}` : ""}`);

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

  it("GET /api/fact refuses to answer for a movie that's no longer the favorite (409)", async () => {
    getCurrentUser.mockResolvedValue(user);

    const response = await getFactRoute(factRequest(329865)); // the tab still shows Arrival

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("favorite_changed");
    expect(getFact).not.toHaveBeenCalled(); // no OpenAI call for the wrong movie
  });

  it("GET /api/fact answers for the current favorite", async () => {
    getCurrentUser.mockResolvedValue(user);
    getFact.mockResolvedValue({
      kind: "cached",
      fact: {
        id: "f1",
        text: "A fact.",
        createdAt: new Date("2026-11-19T00:00:00Z"),
        ageSeconds: 12,
      },
    });

    const response = await getFactRoute(factRequest(438631));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      source: "cached",
      fact: { id: "f1", text: "A fact.", generatedAt: "2026-11-19T00:00:00.000Z", ageSeconds: 12 },
    });
  });

  it("GET /api/fact maps an unavailable fact to a retryable 503", async () => {
    getCurrentUser.mockResolvedValue(user);
    getFact.mockResolvedValue({ kind: "unavailable", cause: "timeout" });

    const response = await getFactRoute(factRequest(438631));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("fact_unavailable");
  });
});
