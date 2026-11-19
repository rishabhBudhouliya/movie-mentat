import { z } from "zod";
import type { UserId } from "@/lib/brand";
import { db } from "@/server/db";
import { createSession } from "./session";

// Claims from Google's ID token, which openid-client has already verified
// (signature, issuer, audience, expiry, nonce). Parsed here so the rest of the
// app sees a well-typed identity. Name and picture are optional per the spec.
const googleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().trim().min(1).optional().catch(undefined),
  picture: z.url().optional().catch(undefined),
});

export type GoogleIdentity = z.infer<typeof googleClaimsSchema>;

export type LoginResult =
  | { kind: "ok"; token: string; expiresAt: Date; onboarded: boolean }
  | { kind: "rejected"; reason: "invalid_claims" };

export function parseGoogleClaims(claims: unknown): GoogleIdentity | null {
  const parsed = googleClaimsSchema.safeParse(claims);
  return parsed.success ? parsed.data : null;
}

/**
 * Upserts the user by Google's stable `sub` (not email, which can change) and
 * starts a session. Profile fields refresh on every login.
 */
export async function completeLogin(claims: unknown, now: Date = new Date()): Promise<LoginResult> {
  const identity = parseGoogleClaims(claims);
  if (!identity) return { kind: "rejected", reason: "invalid_claims" };

  const profile = {
    email: identity.email,
    name: identity.name ?? null,
    avatarUrl: identity.picture ?? null,
  };
  const user = await db.user.upsert({
    where: { googleSub: identity.sub },
    create: { googleSub: identity.sub, ...profile },
    update: profile,
  });

  const { token, expiresAt } = await createSession(user.id as UserId, now);
  return { kind: "ok", token, expiresAt, onboarded: user.favoriteMovieId !== null };
}
