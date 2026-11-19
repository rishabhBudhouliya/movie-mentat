import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callbackMatchesTransaction,
  decodeLoginTransaction,
  encodeLoginTransaction,
  expiredCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from "./cookies";

const transaction = { state: "s", nonce: "n", codeVerifier: "v" };

describe("login transaction cookie", () => {
  it("round-trips", () => {
    expect(decodeLoginTransaction(encodeLoginTransaction(transaction))).toEqual(transaction);
  });

  it("rejects missing, garbled, or incomplete values", () => {
    expect(decodeLoginTransaction(undefined)).toBeNull();
    expect(decodeLoginTransaction("%%%not-base64-json")).toBeNull();
    const partial = Buffer.from(JSON.stringify({ state: "s" })).toString("base64url");
    expect(decodeLoginTransaction(partial)).toBeNull();
  });
});

describe("cookie hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses plain names without Secure over local http", () => {
    expect(sessionCookieName()).toBe("session");
    expect(sessionCookieOptions(new Date())).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });
  });

  it("uses __Host- names with Secure over https, including when clearing", async () => {
    vi.stubEnv("APP_URL", "https://movie-mentat.vercel.app");
    vi.resetModules();
    const fresh = await import("./cookies");

    expect(fresh.sessionCookieName()).toBe("__Host-session");
    expect(fresh.loginCookieName()).toBe("__Host-login");
    expect(fresh.expiredCookieOptions()).toMatchObject({ secure: true, path: "/", maxAge: 0 });
  });

  it("clears with maxAge 0", () => {
    expect(expiredCookieOptions().maxAge).toBe(0);
  });
});

describe("callbackMatchesTransaction", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("accepts exactly one matching state", () => {
    expect(callbackMatchesTransaction(params("code=c&state=s"), transaction)).toBe(true);
  });

  it("rejects a stale or unsolicited callback, so the pending login survives", () => {
    expect(callbackMatchesTransaction(params("code=c&state=other"), transaction)).toBe(false);
    expect(callbackMatchesTransaction(params("code=c"), transaction)).toBe(false);
    expect(callbackMatchesTransaction(params("code=c&state=s&state=s"), transaction)).toBe(false);
  });
});
