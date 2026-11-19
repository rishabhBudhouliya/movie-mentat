import { type NextRequest, NextResponse } from "next/server";
import { expiredCookieOptions, sessionCookieName } from "@/server/auth/cookies";
import { deleteSession } from "@/server/auth/session";
import { getAuthEnv } from "@/server/env";

// POST only, so a link or image tag can't log a user out. SameSite=Lax already
// keeps the cookie off cross-site POSTs; the Origin check is defense in depth.
export async function POST(request: NextRequest) {
  const { APP_URL } = getAuthEnv();
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(APP_URL).origin) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Cross-origin logout is not allowed." } },
      { status: 403 },
    );
  }

  const token = request.cookies.get(sessionCookieName())?.value;
  if (token) await deleteSession(token);

  // 303 turns the POST into a GET of the landing page.
  const response = NextResponse.redirect(new URL("/", APP_URL), 303);
  response.cookies.set(sessionCookieName(), "", expiredCookieOptions());
  return response;
}
