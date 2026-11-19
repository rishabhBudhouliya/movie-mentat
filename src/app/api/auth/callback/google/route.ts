import { type NextRequest, NextResponse } from "next/server";
import {
  decodeLoginTransaction,
  expiredCookieOptions,
  loginCookieName,
  sessionCookieName,
  sessionCookieOptions,
} from "@/server/auth/cookies";
import { CALLBACK_PATH, finishLogin } from "@/server/auth/google";
import { completeLogin } from "@/server/auth/login";
import { getAuthEnv } from "@/server/env";

function toLanding(appUrl: string, error: string): NextResponse {
  const url = new URL("/", appUrl);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { APP_URL } = getAuthEnv();
  const transaction = decodeLoginTransaction(request.cookies.get(loginCookieName())?.value);

  let response: NextResponse;
  if (!transaction) {
    response = toLanding(APP_URL, "login_expired");
  } else {
    // Rebuild the callback URL from APP_URL rather than trusting the Host header.
    const callbackUrl = new URL(CALLBACK_PATH, APP_URL);
    callbackUrl.search = request.nextUrl.search;

    let claims: unknown;
    try {
      claims = await finishLogin(callbackUrl, transaction);
    } catch {
      // Bad state/nonce/PKCE, a denied consent screen, or a Google outage.
      claims = undefined;
    }

    const result = claims === undefined ? null : await completeLogin(claims);
    if (!result || result.kind === "rejected") {
      response = toLanding(APP_URL, "login_failed");
    } else {
      const destination = result.onboarded ? "/dashboard" : "/onboarding";
      response = NextResponse.redirect(new URL(destination, APP_URL));
      response.cookies.set(
        sessionCookieName(),
        result.token,
        sessionCookieOptions(result.expiresAt),
      );
    }
  }

  // The login transaction is single-use either way.
  response.cookies.set(loginCookieName(), "", expiredCookieOptions());
  return response;
}
