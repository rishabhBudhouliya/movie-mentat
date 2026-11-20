import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/server/db";
import type { CatalogMovie, CatalogResult } from "@/server/tmdb/client";
import { resetDb } from "../../../test/reset-db";
import { ensureMovie } from "./snapshot";

const db = getDb();

const arrival: CatalogMovie = {
  tmdbId: 329865,
  title: "Arrival",
  releaseYear: 2016,
  posterPath: "/a.jpg",
};

const catalog = (result: CatalogResult<CatalogMovie | null>) => vi.fn(async () => result);

describe("ensureMovie (decision 17)", () => {
  beforeEach(resetDb);

  it("a movie we already hold needs no catalog call", async () => {
    await db.movie.create({ data: { tmdbId: 329865, title: "Arrival" } });
    const lookup = catalog({ kind: "unavailable" });

    expect(await ensureMovie(329865, lookup)).toEqual({ kind: "ok" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("an unknown movie is checked against the catalog and snapshotted", async () => {
    const lookup = catalog({ kind: "ok", value: arrival });

    expect(await ensureMovie(329865, lookup)).toEqual({ kind: "ok" });
    expect(await db.movie.findUnique({ where: { tmdbId: 329865 } })).toMatchObject({
      title: "Arrival",
      releaseYear: 2016,
      posterPath: "/a.jpg",
    });
  });

  it("a made-up ID never becomes a row", async () => {
    expect(await ensureMovie(999_999, catalog({ kind: "ok", value: null }))).toEqual({
      kind: "not_found",
    });
    expect(await ensureMovie(999_999, catalog({ kind: "unavailable" }))).toEqual({
      kind: "catalog_unavailable",
    });
    expect(await db.movie.count()).toBe(0);
  });
});
