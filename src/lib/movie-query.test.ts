import { describe, expect, it } from "vitest";
import type { MovieSummary, SearchState } from "@/components/types";
import {
  normalizeTitle,
  parseMovieQuery,
  QUERY_MAX,
  resolveSubmission,
  visibleSearchState,
} from "./movie-query";

const now = new Date("2026-11-19T00:00:00Z");
const movie = (tmdbId: number, title: string, releaseYear: number | null): MovieSummary => ({
  tmdbId,
  title,
  releaseYear,
  posterUrl: null,
});

describe("parseMovieQuery (server-side validation: trim, min/max length)", () => {
  it("trims and collapses whitespace", () => {
    expect(parseMovieQuery("   The   Matrix  ", now)).toEqual({
      kind: "ok",
      text: "The Matrix",
      title: "The Matrix",
      year: null,
    });
  });

  it("rejects empty and over-long input", () => {
    expect(parseMovieQuery("   ", now)).toEqual({ kind: "invalid", reason: "empty" });
    expect(parseMovieQuery("x".repeat(QUERY_MAX), now).kind).toBe("ok");
    expect(parseMovieQuery("x".repeat(QUERY_MAX + 1), now)).toEqual({
      kind: "invalid",
      reason: "too_long",
    });
  });

  it("splits a trailing year, with or without parentheses", () => {
    expect(parseMovieQuery("Dune 1984", now)).toMatchObject({ title: "Dune", year: 1984 });
    expect(parseMovieQuery("Dune (1984)", now)).toMatchObject({ title: "Dune", year: 1984 });
  });

  it("keeps numbers that can't be a release year as part of the title", () => {
    expect(parseMovieQuery("1917", now)).toMatchObject({ title: "1917", year: null });
    expect(parseMovieQuery("Blade Runner 2049", now)).toMatchObject({ year: null });
    expect(parseMovieQuery("Apollo 13", now)).toMatchObject({ year: null });
  });
});

describe("normalizeTitle", () => {
  it("ignores case, punctuation, and accents", () => {
    expect(normalizeTitle("Dune: Part Two")).toBe(normalizeTitle("dune part two"));
    expect(normalizeTitle("Amélie")).toBe(normalizeTitle("Amelie"));
  });
});

describe("resolveSubmission (what Enter does)", () => {
  const dune2021 = movie(438631, "Dune", 2021);
  const dune1984 = movie(841, "Dune", 1984);
  const partTwo = movie(693134, "Dune: Part Two", 2024);

  it("shows the two best exact matches as cards for an ambiguous title", () => {
    expect(resolveSubmission(parseMovieQuery("dune", now), [dune2021, partTwo, dune1984])).toEqual({
      kind: "ambiguous",
      candidates: [dune2021, dune1984],
    });
  });

  it("goes straight through when title and year identify one movie", () => {
    expect(resolveSubmission(parseMovieQuery("Dune 1984", now), [dune1984, dune2021])).toEqual({
      kind: "exact",
      movie: dune1984,
    });
  });

  it("asks the user to choose when nothing matches exactly", () => {
    expect(resolveSubmission(parseMovieQuery("Dun", now), [dune2021, partTwo])).toEqual({
      kind: "choose",
      movies: [dune2021, partTwo],
    });
  });

  it("reports no match for empty results or invalid input", () => {
    expect(resolveSubmission(parseMovieQuery("zzqx", now), [])).toEqual({ kind: "empty" });
    expect(resolveSubmission(parseMovieQuery("", now), [dune2021])).toEqual({ kind: "empty" });
  });
});

describe("visibleSearchState (results only for the query they answer)", () => {
  const results: SearchState = { kind: "results", movies: [movie(1, "Dune", 2021)] };
  const forDune = { forText: "Dune", state: results };

  it("shows results for the exact query they answer", () => {
    expect(visibleSearchState(forDune, "  Dune ")).toBe(results);
  });

  it("hides the previous query's results the moment the input changes (no stale clicks)", () => {
    expect(visibleSearchState(forDune, "Arrival")).toEqual({ kind: "loading" });
  });

  it("is idle for empty input and an error for over-long input", () => {
    expect(visibleSearchState(forDune, "   ")).toEqual({ kind: "idle" });
    expect(visibleSearchState(null, "x".repeat(QUERY_MAX + 1))).toMatchObject({ kind: "error" });
  });

  it("is loading before any result has arrived", () => {
    expect(visibleSearchState(null, "Dune")).toEqual({ kind: "loading" });
  });
});
