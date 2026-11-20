import { NextResponse } from "next/server";

/** The one error shape used by every API route: `{ error: { code, message } }`. */
export type ApiError = { error: { code: string; message: string } };

export function jsonError(status: number, code: string, message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const unauthorized = () => jsonError(401, "unauthorized", "Sign in to continue.");

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
