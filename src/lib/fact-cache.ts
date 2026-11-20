import type { FactResponse } from "@/lib/api";

// Variant B client cache: the last fact, with when it arrived. Reused for up
// to 30s within the same (user, movie) unless the user explicitly asks for a
// new one. A different movie is a different key, so switching movies can't
// show the old movie's fact. The server's 60s window applies independently.

export const CLIENT_CACHE_MS = 30_000;

export type CachedFact = { key: string; response: FactResponse; receivedAt: number };

export function factKey(userId: string, movieId: number): string {
  return `${userId}:${movieId}`;
}

export function reusable(
  entry: CachedFact | null,
  key: string,
  now: number,
  explicit: boolean,
): boolean {
  return (
    !explicit && entry !== null && entry.key === key && now - entry.receivedAt < CLIENT_CACHE_MS
  );
}

/**
 * Only the newest request may update the screen. A response for an older
 * request, such as a fact for the movie you just switched away from, or
 * results for a shorter query, is dropped.
 */
export function createLatestGate() {
  let latest = 0;
  return {
    next: (): number => {
      latest += 1;
      return latest;
    },
    isLatest: (ticket: number): boolean => ticket === latest,
  };
}
