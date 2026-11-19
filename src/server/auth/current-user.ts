import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName } from "./cookies";
import { type AuthedUser, getSessionUser } from "./session";

/** The signed-in user for this request, or null. */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return token ? getSessionUser(token) : null;
}

/** For pages: signed-out visitors go to the landing page (where sign-in is). */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}
