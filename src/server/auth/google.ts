import * as oidc from "openid-client";
import { getAuthEnv } from "@/server/env";

// Google sign-in via OpenID Connect (decision 3): PKCE + state + nonce. The ID
// token's claims (iss, aud, exp, nonce) are always validated; by default
// openid-client trusts TLS for the signature, so non-repudiation checks are
// enabled to verify it against Google's JWKS as well (Codex review).

export const CALLBACK_PATH = "/api/auth/callback/google";

let configPromise: Promise<oidc.Configuration> | undefined;

function getConfig(): Promise<oidc.Configuration> {
  const env = getAuthEnv();
  configPromise ??= oidc
    .discovery(
      new URL("https://accounts.google.com"),
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      undefined,
      { execute: [oidc.enableNonRepudiationChecks] },
    )
    .catch((error: unknown) => {
      configPromise = undefined; // don't cache a failed discovery
      throw error;
    });
  return configPromise;
}

/** One login attempt's secrets, kept in a short-lived httpOnly cookie. */
export type LoginTransaction = { state: string; nonce: string; codeVerifier: string };

export async function startLogin(): Promise<{ url: URL; transaction: LoginTransaction }> {
  const config = await getConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const transaction: LoginTransaction = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    codeVerifier,
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: new URL(CALLBACK_PATH, getAuthEnv().APP_URL).href,
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state: transaction.state,
    nonce: transaction.nonce,
    prompt: "select_account",
  });
  return { url, transaction };
}

/**
 * Exchanges the code and returns the verified ID token claims. Throws if the
 * state, nonce, PKCE verifier, or token signature don't check out.
 */
export async function finishLogin(
  callbackUrl: URL,
  transaction: LoginTransaction,
): Promise<unknown> {
  const config = await getConfig();
  const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  return tokens.claims();
}
