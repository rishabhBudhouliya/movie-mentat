import { z } from "zod";

// Typed client for our API routes. Every call resolves to a Result: no thrown
// errors, and every failure (HTTP error, network, bad JSON, wrong shape) is
// normalized into the same `{ code, message }` the server uses.

export type ApiFailure = { status: number; code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

const errorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const movieSummarySchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  releaseYear: z.number().nullable(),
  posterUrl: z.string().nullable(),
});

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
      credentials: "same-origin",
    });
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: "network_error",
        message: "Can't reach the server. Check your connection.",
      },
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    return {
      ok: false,
      error: parsed.success
        ? { status: response.status, ...parsed.data.error }
        : {
            status: response.status,
            code: "http_error",
            message: "Something went wrong. Try again.",
          },
    };
  }

  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : {
        ok: false,
        error: {
          status: response.status,
          code: "bad_response",
          message: "Unexpected response from the server.",
        },
      };
}

const factSchema = z.object({
  id: z.string(),
  text: z.string(),
  generatedAt: z.string(),
  ageSeconds: z.number(),
});

export const factResponseSchema = z.discriminatedUnion("source", [
  z.object({ source: z.enum(["fresh", "cached"]), fact: factSchema }),
  z.object({ source: z.literal("fallback"), fact: factSchema, notice: z.string() }),
]);
export type FactResponse = z.infer<typeof factResponseSchema>;

export const api = {
  searchMovies: (query: string, signal?: AbortSignal) =>
    request(
      `/api/movies/search?${new URLSearchParams({ q: query })}`,
      z.object({ movies: z.array(movieSummarySchema) }),
      { signal },
    ),

  getFact: () => request("/api/fact", factResponseSchema),

  setFavoriteMovie: (tmdbId: number) =>
    request("/api/me/movie", z.object({ movie: movieSummarySchema }), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId }),
    }),
};
