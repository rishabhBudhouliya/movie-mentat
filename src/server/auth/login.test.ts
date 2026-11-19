import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db";
import { resetDb } from "../../../test/reset-db";
import { completeLogin, parseGoogleClaims } from "./login";
import { getSessionUser } from "./session";

const db = getDb();

const claims = {
  sub: "google-123",
  email: "ada@example.com",
  email_verified: true,
  name: "Ada Lovelace",
  picture: "https://lh3.googleusercontent.com/a/photo",
};

describe("completeLogin", () => {
  beforeEach(resetDb);

  it("creates a first-time user, starts a session, and routes to onboarding", async () => {
    const result = await completeLogin(claims);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.onboarded).toBe(false);
    const user = await getSessionUser(result.token);
    expect(user).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace" });
  });

  it("routes a returning user with a favorite to the dashboard", async () => {
    await db.movie.create({ data: { tmdbId: 438631, title: "Dune", releaseYear: 2021 } });
    await db.user.create({
      data: { googleSub: "google-123", email: "ada@example.com", favoriteMovieId: 438631 },
    });

    const result = await completeLogin(claims);

    expect(result).toMatchObject({ kind: "ok", onboarded: true });
  });

  it("matches users by Google sub, not email, and refreshes the profile", async () => {
    await completeLogin(claims);
    await completeLogin({ ...claims, email: "ada@new.example.com", name: "Ada King" });

    const users = await db.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "ada@new.example.com", name: "Ada King" });
  });

  it("handles a missing name and photo", async () => {
    const result = await completeLogin({ sub: "s", email: "x@example.com", email_verified: true });

    expect(result.kind).toBe("ok");
    expect(await db.user.findFirst()).toMatchObject({ name: null, avatarUrl: null });
  });

  it("treats a blank name or malformed photo URL as missing, not as an error", async () => {
    const result = await completeLogin({ ...claims, name: "   ", picture: "not a url" });

    expect(result.kind).toBe("ok");
    expect(await db.user.findFirst()).toMatchObject({ name: null, avatarUrl: null });
  });

  it("rejects unverified emails and malformed claims without creating anything", async () => {
    expect(await completeLogin({ ...claims, email_verified: false })).toEqual({
      kind: "rejected",
      reason: "invalid_claims",
    });
    expect(await completeLogin({ email: "no-sub@example.com" })).toMatchObject({
      kind: "rejected",
    });
    expect(await db.user.count()).toBe(0);
    expect(await db.session.count()).toBe(0);
  });
});

describe("parseGoogleClaims", () => {
  it("rejects non-object input", () => {
    expect(parseGoogleClaims(undefined)).toBeNull();
    expect(parseGoogleClaims("sub")).toBeNull();
  });
});
