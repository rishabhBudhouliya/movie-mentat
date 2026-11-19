import { beforeEach, describe, expect, it } from "vitest";
import type { UserId } from "@/lib/brand";
import { createSession, getSessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { resetDb } from "../../../test/reset-db";
import { getFavoriteMovie, posterUrl } from "./repository";

const db = getDb();

async function signedInUser(favoriteMovieId: number | null) {
  const row = await db.user.create({
    data: { googleSub: "s", email: "u@example.com", favoriteMovieId },
  });
  const { token } = await createSession(row.id as UserId);
  const user = await getSessionUser(token);
  if (!user) throw new Error("expected a session user");
  return user;
}

describe("getFavoriteMovie", () => {
  beforeEach(resetDb);

  it("returns the saved favorite from our DB, with a full poster URL", async () => {
    await db.movie.create({
      data: {
        tmdbId: 438631,
        title: "Dune",
        releaseYear: 2021,
        posterPath: "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
      },
    });
    const user = await signedInUser(438631);

    expect(await getFavoriteMovie(user)).toEqual({
      tmdbId: 438631,
      title: "Dune",
      releaseYear: 2021,
      posterUrl: "https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
    });
  });

  it("returns null before onboarding", async () => {
    expect(await getFavoriteMovie(await signedInUser(null))).toBeNull();
  });
});

describe("posterUrl", () => {
  it("is null without a poster path", () => {
    expect(posterUrl(null)).toBeNull();
  });
});
