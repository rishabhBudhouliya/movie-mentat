import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { TmdbId, UserId } from "@/lib/brand";
import { db } from "@/server/db";

// Decision 4 (PLAN.md): the cookie holds a random token; the DB stores only
// its SHA-256 hash. Sessions have a fixed lifetime, checked on every read.

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Proof that a request belongs to a signed-in user. The brand symbol is not
 * exported, so outside this module an AuthedUser can only come from
 * `getSessionUser` — repository functions that take one can't be handed a
 * user ID from the client (PLAN.md, "Capability-typed access").
 */
declare const authed: unique symbol;
export type AuthedUser = {
  readonly id: UserId;
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly favoriteMovieId: TmdbId | null;
} & { readonly [authed]: true };

type UserRow = Prisma.UserGetPayload<object>;

function toAuthedUser(user: UserRow): AuthedUser {
  return {
    id: user.id as UserId,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    favoriteMovieId: user.favoriteMovieId as TmdbId | null,
  } as AuthedUser;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the raw token for the cookie. Only its hash is persisted. */
export async function createSession(
  userId: UserId,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, createdAt: now, expiresAt },
  });
  return { token, expiresAt };
}

/** The session's user, or null if the token is unknown or expired. */
export async function getSessionUser(
  token: string,
  now: Date = new Date(),
): Promise<AuthedUser | null> {
  const tokenHash = hashToken(token);
  const session = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt <= now) {
    await db.session.deleteMany({ where: { tokenHash } });
    return null;
  }
  return toAuthedUser(session.user);
}

export async function deleteSession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
