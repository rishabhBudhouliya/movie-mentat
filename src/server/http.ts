import { NextResponse } from "next/server";

/** The one error shape used by every API route: `{ error: { code, message } }`. */
export type ApiError = { error: { code: string; message: string } };

export function jsonError(status: number, code: string, message: string): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const unauthorized = () => jsonError(401, "unauthorized", "Sign in to continue.");
