import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { UserId } from "@/lib/brand";
import { createSession, getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { resetDb } from "../../../../../test/reset-db";
import { POST } from "./route";

async function sessionToken(): Promise<string> {
  const user = await db.user.create({ data: { googleSub: "s", email: "u@example.com" } });
  return (await createSession(user.id as UserId)).token;
}

function logoutRequest(token: string, origin: string | null): NextRequest {
  const headers = new Headers({ cookie: `session=${token}` });
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest("http://localhost:3000/api/auth/logout", { method: "POST", headers });
}

describe("POST /api/auth/logout", () => {
  beforeEach(resetDb);

  it("revokes the session and clears the cookie for a same-origin POST", async () => {
    const token = await sessionToken();

    const response = await POST(logoutRequest(token, "http://localhost:3000"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.headers.get("set-cookie")).toMatch(/session=;.*Max-Age=0/);
    expect(await getSessionUser(token)).toBeNull();
  });

  it.each([
    ["a foreign origin", "https://evil.example"],
    ["a sibling origin", "http://localhost:4000"],
    ["no Origin header", null],
  ])("refuses %s and keeps the session", async (_label, origin) => {
    const token = await sessionToken();

    const response = await POST(logoutRequest(token, origin));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Cross-origin logout is not allowed." },
    });
    expect(await getSessionUser(token)).not.toBeNull();
  });
});
