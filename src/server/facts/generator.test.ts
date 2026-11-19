import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserPrompt, generateWithOpenAI } from "./generator";

const prompt = { title: "Dune", releaseYear: 1984, previousFact: null };

function completion(content: string | null, refusal: string | null = null) {
  return new Response(JSON.stringify({ choices: [{ message: { content, refusal } }] }), {
    status: 200,
  });
}

describe("generateWithOpenAI (never throws)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the fact from a structured response, with no retries", async () => {
    fetchMock.mockResolvedValue(
      completion(JSON.stringify({ status: "fact", fact: "  A true thing.  " })),
    );

    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "fact", text: "A true thing." });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].content).toMatch(/Never spoil/);
  });

  it("treats abstention, refusals, and empty facts as abstained", async () => {
    fetchMock.mockResolvedValueOnce(completion(JSON.stringify({ status: "abstain", fact: "" })));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "abstained" });

    fetchMock.mockResolvedValueOnce(completion(null, "I can't help with that."));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "abstained" });

    fetchMock.mockResolvedValueOnce(completion(JSON.stringify({ status: "fact", fact: "   " })));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "abstained" });
  });

  it("maps timeouts, HTTP errors, network errors, and malformed output", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "timeout" });

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "error" });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "error" });

    fetchMock.mockResolvedValueOnce(completion("not json"));
    expect(await generateWithOpenAI(prompt)).toEqual({ kind: "error" });
  });
});

describe("buildUserPrompt", () => {
  it("identifies the exact film and asks for a different detail than last time", () => {
    expect(buildUserPrompt(prompt)).toContain("Dune (1984)");
    expect(buildUserPrompt({ ...prompt, releaseYear: null, previousFact: "Old fact." })).toBe(
      'Film: Dune\nThe user was already shown this fact, so pick a different detail: "Old fact."',
    );
  });
});
