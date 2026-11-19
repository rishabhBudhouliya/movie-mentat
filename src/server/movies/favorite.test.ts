import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId } from "@/lib/brand";
import { createSession, getSessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import type { CatalogMovie, CatalogResult } from "@/server/tmdb/client";
import { resetDb } from "../../../test/reset-db";
import { saveFavoriteMovie } from "./favorite";

const db = getDb();

const dune: CatalogMovie = {
  tmdbId: 438631,
  title: "Dune",
  releaseYear: 2021,
  posterPath: "/p.jpg",
};

async function signedIn(sub: string) {
  const row = await db.user.create({ data: { googleSub: sub, email: `${sub}@example.com` } });
  const user = await getSessionUser((await createSession(row.id as UserId)).token);
  if (!user) throw new Error("expected a session user");
  return user;
}

const catalog = (result: CatalogResult<CatalogMovie | null>) => vi.fn(async () => result);

describe("saveFavoriteMovie", () => {
  beforeEach(resetDb);

  it("re-fetches the entry from the catalog, snapshots it, and sets the session user's favorite", async () => {
    const user = await signedIn("a");
    const lookup = catalog({ kind: "ok", value: dune });

    const result = await saveFavoriteMovie(user, 438631, lookup);

    expect(lookup).toHaveBeenCalledWith(438631);
    expect(result).toEqual({
      kind: "saved",
      movie: {
        tmdbId: 438631,
        title: "Dune",
        releaseYear: 2021,
        posterUrl: "https://image.tmdb.org/t/p/w342/p.jpg",
      },
    });
    expect(await db.movie.findUnique({ where: { tmdbId: 438631 } })).toMatchObject({
      title: "Dune",
    });
    expect((await db.user.findUnique({ where: { id: user.id } }))?.favoriteMovieId).toBe(438631);
  });

  it("only changes the signed-in user, never another user", async () => {
    const a = await signedIn("a");
    const b = await signedIn("b");

    await saveFavoriteMovie(a, 438631, catalog({ kind: "ok", value: dune }));

    expect((await db.user.findUnique({ where: { id: b.id } }))?.favoriteMovieId).toBeNull();
  });

  it("refuses IDs the catalog doesn't know, and saves nothing", async () => {
    const user = await signedIn("a");

    expect(await saveFavoriteMovie(user, 999, catalog({ kind: "ok", value: null }))).toEqual({
      kind: "not_found",
    });
    expect(await db.movie.count()).toBe(0);
  });

  it("reports a catalog outage without changing the saved favorite", async () => {
    const user = await signedIn("a");
    await saveFavoriteMovie(user, 438631, catalog({ kind: "ok", value: dune }));

    const result = await saveFavoriteMovie(user, 841, catalog({ kind: "unavailable" }));

    expect(result).toEqual({ kind: "catalog_unavailable" });
    expect((await db.user.findUnique({ where: { id: user.id } }))?.favoriteMovieId).toBe(438631);
  });
});
