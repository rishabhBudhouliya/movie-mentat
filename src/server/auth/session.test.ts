import { beforeEach, describe, expect, it } from "vitest";
import type { UserId } from "@/lib/brand";
import { db } from "@/server/db";
import { resetDb } from "../../../test/reset-db";
import { createSession, deleteSession, getSessionUser, hashToken, SESSION_TTL_MS } from "./session";

async function makeUser(sub = "google-sub-1"): Promise<UserId> {
  const user = await db.user.create({ data: { googleSub: sub, email: `${sub}@example.com` } });
  return user.id as UserId;
}

describe("sessions", () => {
  beforeEach(resetDb);

  it("resolves a fresh token to its user", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    const user = await getSessionUser(token);

    expect(user?.id).toBe(userId);
    expect(user?.email).toBe("google-sub-1@example.com");
  });

  it("stores only the token's hash, never the token", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    const rows = await db.session.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(rows[0]?.tokenHash).not.toContain(token);
  });

  it("rejects an unknown or tampered token", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    expect(await getSessionUser(`${token}x`)).toBeNull();
    expect(await getSessionUser("not-a-token")).toBeNull();
  });

  it("expires at the fixed lifetime and deletes the stale row", async () => {
    const userId = await makeUser();
    const start = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(userId, start);

    const justBefore = new Date(start.getTime() + SESSION_TTL_MS - 1);
    const atExpiry = new Date(start.getTime() + SESSION_TTL_MS);

    expect(await getSessionUser(token, justBefore)).not.toBeNull();
    expect(await getSessionUser(token, atExpiry)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("logout revokes the session server-side", async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    await deleteSession(token);

    expect(await getSessionUser(token)).toBeNull();
  });

  it("only revokes the session it was given", async () => {
    const a = await createSession(await makeUser("a"));
    const b = await createSession(await makeUser("b"));

    await deleteSession(a.token);

    expect(await getSessionUser(a.token)).toBeNull();
    expect((await getSessionUser(b.token))?.email).toBe("b@example.com");
  });
});
