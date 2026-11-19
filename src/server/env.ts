import { z } from "zod";

// Env is parsed per feature and on first use, so `next build` and tests don't
// need secrets for features they don't touch.

const authSchema = z.object({
  APP_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type AuthEnv = z.infer<typeof authSchema>;

let authEnv: AuthEnv | undefined;

export function getAuthEnv(): AuthEnv {
  authEnv ??= authSchema.parse(process.env);
  return authEnv;
}

/** Cookies get the `__Host-` prefix and `Secure` only over HTTPS (not local http). */
export function isSecureOrigin(appUrl: string): boolean {
  return new URL(appUrl).protocol === "https:";
}
