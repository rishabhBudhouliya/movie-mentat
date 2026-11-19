import { z } from "zod";
import { getAuthEnv, isSecureOrigin } from "@/server/env";
import type { LoginTransaction } from "./google";

// `__Host-` cookies must be Secure with Path=/ and no Domain, so the browser
// rejects them from subdomains or plain http. Local http dev uses plain names.

type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge?: number;
  expires?: Date;
};

function secure(): boolean {
  return isSecureOrigin(getAuthEnv().APP_URL);
}

export function sessionCookieName(): string {
  return secure() ? "__Host-session" : "session";
}

export function loginCookieName(): string {
  return secure() ? "__Host-login" : "login";
}

// Lax, not Strict: the OAuth callback is a top-level navigation from Google,
// and Lax still blocks cross-site POSTs (logout CSRF).
function baseOptions(): CookieOptions {
  return { httpOnly: true, secure: secure(), sameSite: "lax", path: "/" };
}

export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return { ...baseOptions(), expires: expiresAt };
}

/**
 * Clearing must repeat Secure and Path=/, or browsers ignore the expiry for
 * `__Host-` cookies (a bare `cookies.delete(name)` would leave them in place).
 */
export function expiredCookieOptions(): CookieOptions {
  return { ...baseOptions(), maxAge: 0 };
}

export const LOGIN_COOKIE_MAX_AGE_S = 10 * 60;

export function loginCookieOptions(): CookieOptions {
  return { ...baseOptions(), maxAge: LOGIN_COOKIE_MAX_AGE_S };
}

const loginTransactionSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
});

export function encodeLoginTransaction(transaction: LoginTransaction): string {
  return Buffer.from(JSON.stringify(transaction)).toString("base64url");
}

export function decodeLoginTransaction(value: string | undefined): LoginTransaction | null {
  if (!value) return null;
  try {
    const parsed = loginTransactionSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
