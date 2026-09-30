/**
 * A scriptable fake of the Gemini REST API. Tests pass `fakeGemini.fetch`
 * into the adapter; no network access and no real keys are ever involved.
 *
 * Each key has a queue of behaviours consumed one per call (the last one
 * repeats), so "429 then success" style scenarios are one line.
 */

export type FakeBehavior =
  | { type: "ok"; text?: string; usage?: { prompt: number; candidates: number; thoughts?: number }; finishReason?: string }
  /** Streaming: emits `pieces` as separate SSE chunks, then finishes. */
  | { type: "stream"; pieces?: string[]; usage?: { prompt: number; candidates: number } }
  /** Streaming: emits `before` chunks, then a mid-stream error event. */
  | { type: "stream_error"; before?: number; status?: number }
  | { type: "rate_limit"; retryDelay?: string; quotaId?: string }
  | { type: "invalid_key" }
  | { type: "permission_denied" }
  | { type: "bad_request"; message?: string }
  | { type: "not_found" }
  | { type: "server_error"; status?: 500 | 502 | 503 | 504 }
  | { type: "hang" }
  | { type: "network_error" }
  | { type: "raw"; status: number; body: unknown; headers?: Record<string, string> };

export interface FakeCall {
  key: string | null;
  method: string;
  path: string;
  body: unknown;
  url: string;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Builds an SSE response body from pre-rendered event payloads. */
function sse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\r\n\r\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function streamChunk(text: string, extra: Record<string, unknown> = {}) {
  return {
    candidates: [{ index: 0, content: { role: "model", parts: [{ text }] } }],
    modelVersion: "gemini-3.8-flash",
    responseId: "resp-stream",
    ...extra,
  };
}

function googleError(code: number, status: string, message: string, details: unknown[] = []): Response {
  return json(code, { error: { code, status, message, details } });
}

export class FakeGemini {
  readonly calls: FakeCall[] = [];
  private readonly scripts = new Map<string, FakeBehavior[]>();
  defaultBehavior: FakeBehavior = { type: "invalid_key" };

  /** Sets the behaviour queue for a key. The final behaviour repeats forever. */
  script(key: string, ...behaviors: FakeBehavior[]): this {
    this.scripts.set(key, [...behaviors]);
    return this;
  }

  callsFor(key: string): FakeCall[] {
    return this.calls.filter((call) => call.key === key);
  }

  generateCalls(): FakeCall[] {
    return this.calls.filter((call) => call.path.includes(":generateContent"));
  }

  private next(key: string | null): FakeBehavior {
    const queue = key ? this.scripts.get(key) : undefined;
    if (!queue?.length) return this.defaultBehavior;
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const key = headers.get("x-goog-api-key");
    let body: unknown = undefined;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    this.calls.push({ key, method: init?.method ?? "GET", path: url.pathname, body, url: url.href });

    // The key must never travel in the URL.
    if (url.searchParams.has("key")) throw new Error("API key leaked into URL");

    const behavior = this.next(key);
    const signal = init?.signal;
    const isModels = url.pathname.endsWith("/models");

    switch (behavior.type) {
      case "stream": {
        const pieces = behavior.pieces ?? ["Hello", " from", " Gemini"];
        const usage = behavior.usage ?? { prompt: 6, candidates: 3 };
        return sse([
          ...pieces.slice(0, -1).map((piece) => streamChunk(piece)),
          streamChunk(pieces.at(-1) ?? "", {
            candidates: [{ index: 0, content: { role: "model", parts: [{ text: pieces.at(-1) ?? "" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: usage.prompt, candidatesTokenCount: usage.candidates, totalTokenCount: usage.prompt + usage.candidates },
          }),
        ]);
      }
      case "stream_error": {
        const status = behavior.status ?? 500;
        return sse([
          ...Array.from({ length: behavior.before ?? 1 }, (_, index) => streamChunk(`part ${index + 1} `)),
          { error: { code: status, status: "INTERNAL", message: "Stream broke midway." } },
        ]);
      }
      case "ok": {
        if (isModels) {
          return json(200, {
            models: [
              { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1048576, outputTokenLimit: 65536 },
              { name: "models/gemini-pro-latest", displayName: "Gemini Pro (latest)", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
            ],
          });
        }
        const usage = behavior.usage ?? { prompt: 5, candidates: 7 };
        return json(200, {
          candidates: [{ index: 0, content: { role: "model", parts: [{ text: behavior.text ?? `Hello from ${key?.slice(-6)}` }] }, finishReason: behavior.finishReason ?? "STOP" }],
          usageMetadata: {
            promptTokenCount: usage.prompt,
            candidatesTokenCount: usage.candidates,
            thoughtsTokenCount: usage.thoughts,
            totalTokenCount: usage.prompt + usage.candidates + (usage.thoughts ?? 0),
          },
          modelVersion: "gemini-3.8-flash",
          responseId: `resp${this.calls.length}`,
        });
      }
      case "rate_limit":
        return googleError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details.", [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: behavior.quotaId ?? "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
                quotaDimensions: { location: "global", model: "gemini-3.8-flash" },
                quotaValue: "10",
              },
            ],
          },
          ...(behavior.retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: behavior.retryDelay }] : []),
        ]);
      case "invalid_key":
        return googleError(400, "INVALID_ARGUMENT", `API key not valid. Please pass a valid API key. (${key})`, [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" },
        ]);
      case "permission_denied":
        return googleError(403, "PERMISSION_DENIED", "Permission denied on resource project 123456789.", []);
      case "bad_request":
        return googleError(400, "INVALID_ARGUMENT", behavior.message ?? "Invalid value at 'generation_config.temperature' (TYPE_FLOAT).");
      case "not_found":
        return googleError(404, "NOT_FOUND", "models/gemini-nope is not found for API version v1beta, or is not supported for generateContent.");
      case "server_error": {
        const status = behavior.status ?? 500;
        const statusText = status === 503 ? "UNAVAILABLE" : status === 504 ? "DEADLINE_EXCEEDED" : "INTERNAL";
        return googleError(status, statusText, status === 503 ? "The model is overloaded. Please try again later." : "An internal error has occurred.");
      }
      case "hang":
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
          if (signal?.aborted) abort();
          signal?.addEventListener("abort", abort, { once: true });
        });
      case "network_error":
        throw new TypeError("fetch failed");
      case "raw":
        return json(behavior.status, behavior.body, behavior.headers);
    }
  };
}
