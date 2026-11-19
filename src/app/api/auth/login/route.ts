import { NextResponse } from "next/server";
import { encodeLoginTransaction, loginCookieName, loginCookieOptions } from "@/server/auth/cookies";
import { startLogin } from "@/server/auth/google";

export async function GET() {
  const { url, transaction } = await startLogin();
  const response = NextResponse.redirect(url);
  response.cookies.set(
    loginCookieName(),
    encodeLoginTransaction(transaction),
    loginCookieOptions(),
  );
  return response;
}
