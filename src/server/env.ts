import { z } from "zod";

// Env is parsed per feature and on first use, so `next build` and tests don't
// need secrets for features they don't touch.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Plain http would drop the cookies' Secure flag, so it's only allowed for
// local development on a loopback host.
export const appUrlSchema = z.url().refine(
  (value) => {
    // Zod still runs refinements after z.url() fails, so guard the parse.
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  },
  { message: "APP_URL must use https (http is allowed only for localhost)" },
);

const authSchema = z.object({
  APP_URL: appUrlSchema,
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

const tmdbSchema = z.object({ TMDB_READ_TOKEN: z.string().min(1) });

let tmdbEnv: z.infer<typeof tmdbSchema> | undefined;

export function getTmdbEnv(): z.infer<typeof tmdbSchema> {
  tmdbEnv ??= tmdbSchema.parse(process.env);
  return tmdbEnv;
}

const openAiSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
});

let openAiEnv: z.infer<typeof openAiSchema> | undefined;

export function getOpenAiEnv(): z.infer<typeof openAiSchema> {
  openAiEnv ??= openAiSchema.parse(process.env);
  return openAiEnv;
}
