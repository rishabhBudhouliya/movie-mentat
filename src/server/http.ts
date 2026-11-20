import { NextResponse } from "next/server";

/** The one error shape used by every API route: `{ error: { code, message } }`. */
export type ApiError = { error: { code: string; message: string } };

export function jsonError(status: number, code: string, message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const unauthorized = () => jsonError(401, "unauthorized", "Sign in to continue.");

/**
 * Catalog data (cast lists, filmographies) changes rarely and isn't per-user
 * secret, but it sits behind sign-in, so only the browser may cache it.
 */
export const CATALOG_CACHE_HEADERS = { "Cache-Control": "private, max-age=3600" };

/** A TMDB ID from a URL (query or path segment): a positive integer, or null. */
export function parseTmdbId(raw: string | null | undefined): number | null {
  if (raw == null || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null; // Postgres int
}

/**
 * Wraps a route handler so that any unexpected failure (a database outage,
 * say) still answers with the standard error shape instead of a bare 500.
 */
export function withApiErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(error);
      return jsonError(500, "internal_error", "Something went wrong on our side. Try again.");
    }
  };
}
