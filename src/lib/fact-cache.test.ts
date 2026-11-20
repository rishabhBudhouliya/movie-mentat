import { describe, expect, it } from "vitest";
import type { FactResponse } from "./api";
import { CLIENT_CACHE_MS, createLatestGate, factKey, reusable } from "./fact-cache";

const response: FactResponse = {
  source: "fresh",
  fact: { id: "f1", text: "A fact.", generatedAt: "2026-11-19T00:00:00Z", ageSeconds: 0 },
};
const dune = factKey("user-1", 438631);
const arrival = factKey("user-1", 329865);
const t0 = 1_000_000;
const entry = { key: dune, response, receivedAt: t0 };

describe("client fact cache (30s, per user + movie)", () => {
  it("reuses the last fact within 30 seconds", () => {
    expect(reusable(entry, dune, t0 + CLIENT_CACHE_MS - 1, false)).toBe(true);
  });

  it("expires at 30 seconds", () => {
    expect(reusable(entry, dune, t0 + CLIENT_CACHE_MS, false)).toBe(false);
  });

  it("is skipped when the user explicitly asks for a new fact", () => {
    expect(reusable(entry, dune, t0 + 1, true)).toBe(false);
  });

  it("is invalidated by a movie change (different key)", () => {
    expect(reusable(entry, arrival, t0 + 1, false)).toBe(false);
  });

  it("is never shared across users for the same movie", () => {
    expect(reusable(entry, factKey("user-2", 438631), t0 + 1, false)).toBe(false);
  });

  it("is empty at first", () => {
    expect(reusable(null, dune, t0, false)).toBe(false);
  });
});

describe("latest-request gate", () => {
  it("lets only the newest request update the screen", () => {
    const gate = createLatestGate();
    const older = gate.next(); // e.g. fact for the old movie, or results for "du"
    const newer = gate.next(); // e.g. fact for the new movie, or results for "dune"

    expect(gate.isLatest(older)).toBe(false);
    expect(gate.isLatest(newer)).toBe(true);
  });
});
