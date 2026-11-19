import { describe, expect, it } from "vitest";
import { appUrlSchema } from "./env";

describe("APP_URL", () => {
  it("accepts https anywhere", () => {
    expect(appUrlSchema.safeParse("https://movie-mentat.vercel.app").success).toBe(true);
  });

  it("accepts http only on loopback hosts", () => {
    expect(appUrlSchema.safeParse("http://localhost:3000").success).toBe(true);
    expect(appUrlSchema.safeParse("http://127.0.0.1:3000").success).toBe(true);
    expect(appUrlSchema.safeParse("http://movie-mentat.vercel.app").success).toBe(false);
  });

  it("rejects non-URLs and other schemes", () => {
    expect(appUrlSchema.safeParse("movie-mentat.vercel.app").success).toBe(false);
    expect(appUrlSchema.safeParse("ftp://localhost").success).toBe(false);
  });
});
