import { describe, expect, it } from "vitest";
import type { ChatRequest } from "@/server/ai/chat-schema";
import { GeminiAdapter } from "@/server/providers/gemini/adapter";
import type { GeminiRequestBody } from "@/server/providers/gemini/api-types";
import { classifyGeminiError, parseDurationMs, parseRetryAfterHeader } from "@/server/providers/gemini/errors";
import { fromGeminiResponse, mapFinishReason, toGeminiRequest, TranslationError } from "@/server/providers/gemini/translate";
import { FakeGemini } from "../support/fake-gemini";

const KEY = "AIzaSyTESTKEY000000000000000000000000000";

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return { model: "gemini-3.8-flash", messages: [{ role: "user", content: "Hello" }], stream: false, ...overrides } as ChatRequest;
}

const httpFailure = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ type: "http", status, body: JSON.stringify(body), headers: new Headers(headers) }) as const;

const googleError = (code: number, status: string, message: string, details: unknown[] = []) => ({ error: { code, status, message, details } });

describe("OpenAI → Gemini request translation", () => {
  it("maps roles, merging system messages into systemInstruction", () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
          { role: "user", content: "Bye" },
          { role: "developer", content: "Answer in English." },
        ],
      }),
    );

    expect(body.systemInstruction?.parts[0]?.text).toBe("Be brief.\n\nAnswer in English.");
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hi" }] },
      { role: "model", parts: [{ text: "Hello!" }] },
      { role: "user", parts: [{ text: "Bye" }] },
    ]);
  });

  it("merges consecutive same-role messages into one turn", () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: "user", content: "One" },
          { role: "user", content: "Two" },
        ],
      }),
    );
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "One" }, { text: "Two" }] }]);
  });

  it("supports array text content", () => {
    const body = toGeminiRequest(
      request({
        messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
      }),
    );
    expect(body.contents[0]?.parts).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("translates generation parameters", () => {
    const body = toGeminiRequest(
      request({
        temperature: 0.4,
        top_p: 0.9,
        max_completion_tokens: 256,
        stop: ["END"],
        n: 2,
        presence_penalty: 0.5,
        frequency_penalty: -0.5,
        seed: 42,
      }),
    );
    expect(body.generationConfig).toEqual({
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 256,
      stopSequences: ["END"],
      candidateCount: 2,
      presencePenalty: 0.5,
      frequencyPenalty: -0.5,
      seed: 42,
    });
  });

  it("prefers max_completion_tokens over the deprecated max_tokens and accepts a string stop", () => {
    const body = toGeminiRequest(request({ max_tokens: 10, max_completion_tokens: 20, stop: "STOP" }));
    expect(body.generationConfig?.maxOutputTokens).toBe(20);
    expect(body.generationConfig?.stopSequences).toEqual(["STOP"]);
  });

  it("omits generationConfig entirely when nothing was set", () => {
    expect(toGeminiRequest(request()).generationConfig).toBeUndefined();
  });

  it("rejects features that are not supported yet, naming the parameter", () => {
    const cases: Array<[Partial<ChatRequest>, string]> = [
      [{ tools: [{ type: "function", function: { name: "f" } }] }, "tools"],
      [{ response_format: { type: "json_object" } }, "response_format"],
      [{ reasoning_effort: "high" }, "reasoning_effort"],
      [{ logprobs: true }, "logprobs"],
    ];
    for (const [overrides, param] of cases) {
      try {
        toGeminiRequest(request(overrides));
        throw new Error(`expected rejection for ${param}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationError);
        expect((error as TranslationError).param).toBe(param);
      }
    }
  });

  it("accepts streaming requests", () => {
    expect(() => toGeminiRequest(request({ stream: true }))).not.toThrow();
  });

  it("rejects non-text content parts and tool messages for now", () => {
    expect(() =>
      toGeminiRequest(request({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }] }] })),
    ).toThrow(TranslationError);
    expect(() => toGeminiRequest(request({ messages: [{ role: "tool", content: "42", tool_call_id: "call_1" }] }))).toThrow(/Tool messages/);
  });

  it("requires at least one non-system message", () => {
    try {
      toGeminiRequest(request({ messages: [{ role: "system", content: "only system" }] }));
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as TranslationError).code).toBe("invalid_request");
    }
  });
});

describe("Gemini → OpenAI response translation", () => {
  it("maps candidates, usage and finish reason", () => {
    const completion = fromGeminiResponse(
      {
        candidates: [{ index: 0, content: { role: "model", parts: [{ text: "Hello" }, { text: " world" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6, cachedContentTokenCount: 2, totalTokenCount: 20 },
        responseId: "resp-1",
      },
      "gemini-3.8-flash",
      1_700_000_000_000,
    );

    expect(completion).toMatchObject({
      id: "chatcmpl-resp-1",
      object: "chat.completion",
      created: 1_700_000_000,
      model: "gemini-3.8-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello world", refusal: null }, finish_reason: "stop", logprobs: null }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
        prompt_tokens_details: { cached_tokens: 2 },
        completion_tokens_details: { reasoning_tokens: 6 },
      },
    });
  });

  it("excludes thought parts from visible content", () => {
    const completion = fromGeminiResponse(
      { candidates: [{ content: { role: "model", parts: [{ text: "secret reasoning", thought: true }, { text: "answer" }] }, finishReason: "STOP" }] },
      "gemini-3.8-flash",
    );
    expect(completion.choices[0]?.message.content).toBe("answer");
  });

  it("represents a blocked prompt as content_filter with no content", () => {
    const completion = fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }, "gemini-3.8-flash");
    expect(completion.choices[0]).toMatchObject({ finish_reason: "content_filter", message: { content: null } });
    expect(completion.choices[0]?.message.refusal).toContain("SAFETY");
  });

  it("maps finish reasons", () => {
    expect(mapFinishReason("STOP", false)).toBe("stop");
    expect(mapFinishReason("MAX_TOKENS", false)).toBe("length");
    expect(mapFinishReason("SAFETY", false)).toBe("content_filter");
    expect(mapFinishReason("PROHIBITED_CONTENT", false)).toBe("content_filter");
    expect(mapFinishReason("STOP", true)).toBe("tool_calls");
    expect(mapFinishReason(undefined, false)).toBeNull();
  });

  it("handles a response with no usage metadata", () => {
    expect(fromGeminiResponse({ candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] }, "m").usage).toBeUndefined();
  });
});

describe("Gemini error classification", () => {
  it("parses RetryInfo durations and Retry-After headers", () => {
    expect(parseDurationMs("34s")).toBe(34_000);
    expect(parseDurationMs("1.5s")).toBe(1_500);
    expect(parseDurationMs("nonsense")).toBeUndefined();
    expect(parseRetryAfterHeader("120")).toBe(120_000);
    expect(parseRetryAfterHeader(null)).toBeUndefined();
  });

  it("classifies a 429 with per-minute quota and retry delay", () => {
    const error = classifyGeminiError(
      httpFailure(
        429,
        googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded", [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" },
        ]),
      ),
    );
    expect(error).toMatchObject({ kind: "rate_limited", quotaScope: "minute", retryAfterMs: 34_000 });
  });

  it("classifies a per-day quota violation", () => {
    const error = classifyGeminiError(
      httpFailure(
        429,
        googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded", [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
        ]),
      ),
    );
    expect(error.quotaScope).toBe("day");
  });

  it("falls back to the Retry-After header when RetryInfo is absent", () => {
    const error = classifyGeminiError(httpFailure(429, googleError(429, "RESOURCE_EXHAUSTED", "slow down"), { "retry-after": "17" }));
    expect(error.retryAfterMs).toBe(17_000);
  });

  it("classifies invalid keys from 400 API_KEY_INVALID without echoing provider text", () => {
    const error = classifyGeminiError(
      httpFailure(
        400,
        googleError(400, "INVALID_ARGUMENT", `API key not valid: ${KEY}`, [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }]),
      ),
      [KEY],
    );
    expect(error.kind).toBe("invalid_key");
    expect(error.message).not.toContain(KEY);
    expect(error.reason).toBe("API_KEY_INVALID");
  });

  it("treats leaked-key and blocked-key responses as invalid keys", () => {
    expect(classifyGeminiError(httpFailure(403, googleError(403, "PERMISSION_DENIED", "Your API key was reported as leaked."))).kind).toBe("invalid_key");
    expect(classifyGeminiError(httpFailure(401, googleError(401, "UNAUTHENTICATED", "Unauthenticated"))).kind).toBe("invalid_key");
  });

  it("classifies other 403s as permission problems and hides project identifiers", () => {
    const error = classifyGeminiError(httpFailure(403, googleError(403, "PERMISSION_DENIED", "Permission denied on resource project 987654321.")));
    expect(error.kind).toBe("permission_denied");
    expect(error.message).not.toContain("987654321");
  });

  it("maps the remaining status codes", () => {
    const cases: Array<[number, string, string]> = [
      [400, "INVALID_ARGUMENT", "bad_request"],
      [404, "NOT_FOUND", "not_found"],
      [408, "DEADLINE_EXCEEDED", "timeout"],
      [500, "INTERNAL", "upstream_error"],
      [502, "BAD_GATEWAY", "upstream_error"],
      [503, "UNAVAILABLE", "overloaded"],
      [504, "DEADLINE_EXCEEDED", "timeout"],
    ];
    for (const [status, googleStatus, kind] of cases) {
      expect(classifyGeminiError(httpFailure(status, googleError(status, googleStatus, "x"))).kind).toBe(kind);
    }
  });

  it("classifies FAILED_PRECONDITION separately so it is not retried", () => {
    const error = classifyGeminiError(
      httpFailure(400, googleError(400, "FAILED_PRECONDITION", "User location is not supported for the API use.")),
    );
    expect(error.kind).toBe("precondition");
    expect(error.message).toContain("User location");
  });

  it("classifies exceptions", () => {
    const base = { type: "exception", error: new Error("x") } as const;
    expect(classifyGeminiError({ ...base, timedOut: true, cancelled: false }).kind).toBe("timeout");
    expect(classifyGeminiError({ ...base, timedOut: false, cancelled: true }).kind).toBe("cancelled");
    expect(classifyGeminiError({ ...base, timedOut: false, cancelled: false }).kind).toBe("network");
  });

  it("survives non-JSON and array-wrapped error bodies", () => {
    expect(classifyGeminiError({ type: "http", status: 500, body: "<html>oops</html>", headers: new Headers() }).kind).toBe("upstream_error");
    const wrapped = classifyGeminiError({
      type: "http",
      status: 429,
      body: JSON.stringify([googleError(429, "RESOURCE_EXHAUSTED", "limit")]),
      headers: new Headers(),
    });
    expect(wrapped.kind).toBe("rate_limited");
  });
});

describe("GeminiAdapter transport", () => {
  it("sends the key in the x-goog-api-key header and never in the URL", async () => {
    const upstream = new FakeGemini().script(KEY, { type: "ok" });
    const adapter = new GeminiAdapter({ fetch: upstream.fetch });
    const prepared = adapter.prepareRequest(request(), "gemini-3.8-flash");
    if (!prepared.ok) throw new Error("prepare failed");

    const result = await adapter.sendRequest(KEY, prepared.prepared, { signal: new AbortController().signal, timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    const call = upstream.calls[0]!;
    expect(call.key).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(call.path).toBe("/v1beta/models/gemini-3.8-flash:generateContent");
    expect((call.body as GeminiRequestBody).contents[0]?.parts[0]?.text).toBe("Hello");
  });

  it("rejects model names that could escape the URL path", () => {
    const adapter = new GeminiAdapter({ fetch: new FakeGemini().fetch });
    const result = adapter.prepareRequest(request({ model: "../../v1beta/models/evil" }), "../../v1beta/models/evil");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_request");
  });

  it("validates a key with models.list (no generation quota spent)", async () => {
    const upstream = new FakeGemini().script(KEY, { type: "ok" });
    const adapter = new GeminiAdapter({ fetch: upstream.fetch });

    const result = await adapter.validateKey(KEY, { signal: new AbortController().signal, timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    expect(upstream.calls[0]?.path).toBe("/v1beta/models");
    expect(upstream.generateCalls()).toHaveLength(0);
  });

  it("reports invalid and rate-limited keys distinctly", async () => {
    const upstream = new FakeGemini();
    const adapter = new GeminiAdapter({ fetch: upstream.fetch });
    upstream.script("BAD", { type: "invalid_key" });
    upstream.script("BUSY", { type: "rate_limit" });
    const ctx = { signal: new AbortController().signal, timeoutMs: 5_000 };

    const invalid = await adapter.validateKey("BAD", ctx);
    const busy = await adapter.validateKey("BUSY", ctx);

    expect(invalid).toEqual({ ok: false, reason: "invalid_key", message: "Invalid API key." });
    // A throttled key is still a valid key.
    expect(busy).toEqual({ ok: true, note: "rate_limited" });
  });

  it("lists only models that support generateContent", async () => {
    const upstream = new FakeGemini().script(KEY, { type: "ok" });
    const adapter = new GeminiAdapter({ fetch: upstream.fetch });

    const result = await adapter.getAvailableModels(KEY, { signal: new AbortController().signal, timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models.map((model) => model.id)).toEqual(["gemini-3.8-flash", "gemini-pro-latest"]);
    expect(result.models[0]).toMatchObject({ provider: "gemini", inputTokenLimit: 1048576 });
  });

  it("recognises the models it serves", () => {
    const adapter = new GeminiAdapter({ fetch: new FakeGemini().fetch });
    expect(adapter.supportsModel("gemini-3.8-flash")).toBe(true);
    expect(adapter.supportsModel("models/gemini-3.8-flash")).toBe(true);
    expect(adapter.supportsModel("gemma-3-27b-it")).toBe(true);
    expect(adapter.supportsModel("gpt-4o")).toBe(false);
  });
});
