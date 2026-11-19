import { z } from "zod";
import { getOpenAiEnv } from "@/server/env";

// One OpenAI call per attempt, as plain fetch with a hard timeout. The SDK's
// default retries would run while the advisory lock is held and break the
// timeout budget (PLAN.md 1c), so there are deliberately no retries here.

export const OPENAI_TIMEOUT_MS = 8000;

export type FactPrompt = { title: string; releaseYear: number | null; previousFact: string | null };

/** Never throws: every way a call can go wrong is a value. */
export type GenerateResult =
  | { kind: "fact"; text: string }
  | { kind: "abstained" }
  | { kind: "timeout" }
  | { kind: "error" };

export type FactGenerator = (prompt: FactPrompt) => Promise<GenerateResult>;

const SYSTEM_PROMPT = `You share one fun, true fact about a film with someone who may not have seen it yet.
Never spoil it: nothing about events after the opening setup, endings, twists, reveals, or character fates, and no production anecdotes that hint at them.
Prefer casting, production, filming, music, design, or reception trivia.
Write at most two sentences and under 45 words.
If you are not confident a fact is true for this exact film (title and year), set status to "abstain".`;

// Structured output: the model must answer with exactly this shape.
const responseSchema = z.object({
  status: z.enum(["fact", "abstain"]),
  fact: z.string(),
});

const JSON_SCHEMA = {
  name: "movie_fact",
  strict: true,
  schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["fact", "abstain"] },
      fact: { type: "string" },
    },
    required: ["status", "fact"],
    additionalProperties: false,
  },
} as const;

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
});

export function buildUserPrompt({ title, releaseYear, previousFact }: FactPrompt): string {
  const film = releaseYear ? `${title} (${releaseYear})` : title;
  const previous = previousFact
    ? `The user was already shown this fact, so pick a different detail: "${previousFact}"`
    : "This is the first fact the user will see.";
  return `Film: ${film}\n${previous}`;
}

export const generateWithOpenAI: FactGenerator = async (prompt) => {
  const { OPENAI_API_KEY, OPENAI_MODEL } = getOpenAiEnv();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(prompt) },
        ],
        response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (error) {
    return error instanceof DOMException && error.name === "TimeoutError"
      ? { kind: "timeout" }
      : { kind: "error" };
  }
  if (!response.ok) return { kind: "error" };

  try {
    const completion = completionSchema.parse(await response.json());
    const message = completion.choices[0]?.message;
    if (!message?.content || message.refusal) return { kind: "abstained" };
    const answer = responseSchema.parse(JSON.parse(message.content));
    const text = answer.fact.trim();
    if (answer.status === "abstain" || text.length === 0) return { kind: "abstained" };
    return { kind: "fact", text };
  } catch (error) {
    // Body read can also hit the timeout.
    return error instanceof DOMException && error.name === "TimeoutError"
      ? { kind: "timeout" }
      : { kind: "error" };
  }
};
