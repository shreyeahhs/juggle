import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configFromEnv, createServices, type Services } from "@/server/container";
import type { DbHandle } from "@/server/db/client";
import { parseEnv } from "@/server/env";
import { silentLogger } from "@/server/logger";
import { FakeGemini } from "../support/fake-gemini";
import { createTestDb, resetDb, TEST_AUTH_SECRET, TEST_OWNER_PASSWORD } from "../support/test-db";
import { requests } from "@/server/db/schema";

const MODEL = "gemini-3.8-flash";
const KEY_A = "AIzaSyTESTSTREAMAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "AIzaSyTESTSTREAMBBBBBBBBBBBBBBBBBBBBBBB";

const TOKEN = "gw_live_TESTSTREAMtokenoooooooooooooooooo";

let handle: DbHandle;
let services: Services;
let upstream: FakeGemini;
let deferred: Promise<unknown>[];

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await Promise.allSettled(deferred ?? []);
  await resetDb(handle);
  upstream = new FakeGemini();
  deferred = [];
  build(`first=${KEY_A}`);
});

/** Rebuilds the service graph with a given set of environment keys. */
function build(keys: string): void {
  services = createServices({
    db: handle.db,
    config: configFromEnv(
      parseEnv({
        NODE_ENV: "test",
        APP_URL: "http://gw.test",
        AUTH_SECRET: TEST_AUTH_SECRET,
        OWNER_PASSWORD: TEST_OWNER_PASSWORD,
        GEMINI_API_KEYS: keys,
        GATEWAY_API_KEYS: TOKEN,
      }),
    ),
    logger: silentLogger,
    fetchImpl: upstream.fetch,
    defer: (task) => deferred.push(task()),
  });
}

function streamRequest(body: Record<string, unknown> = {}, signal?: AbortSignal): Request {
  return new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Hello" }], stream: true, ...body }),
    signal,
  });
}

interface SseChunk {
  id?: string;
  object?: string;
  model?: string;
  choices?: Array<{ index: number; delta?: { role?: string; content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; type: string; code: string };
}

/** Collects the `data:` payloads of an SSE response. */
async function readSse(response: Response): Promise<{ events: string[]; chunks: SseChunk[]; done: boolean }> {
  const text = await response.text();
  const events = text
    .split("\n\n")
    .map((block) => block.replace(/^data: /, "").trim())
    .filter(Boolean);
  return {
    events,
    chunks: events.filter((event) => event !== "[DONE]").map((event) => JSON.parse(event)),
    done: events.at(-1) === "[DONE]",
  };
}

describe("streaming chat completions", () => {
  it("streams OpenAI-shaped chunks and terminates with [DONE]", async () => {
    upstream.script(KEY_A, { type: "stream", pieces: ["Hello", " there", "!"] });

    const response = await services.gateway.chatCompletions(streamRequest());
    const { chunks, done } = await readSse(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(done).toBe(true);

    // The role is announced once, in the first delta.
    expect(chunks[0]).toMatchObject({ object: "chat.completion.chunk", model: MODEL, choices: [{ index: 0, delta: { role: "assistant" } }] });
    expect(chunks.filter((chunk) => chunk.choices?.[0]?.delta?.role).length).toBe(1);
    expect(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("")).toBe("Hello there!");
    expect(chunks.at(-1)?.choices?.[0]?.finish_reason).toBe("stop");
    // Every chunk shares one completion id.
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
  });

  it("omits usage unless stream_options.include_usage is set", async () => {
    upstream.script(KEY_A, { type: "stream" });

    const withoutUsage = await readSse(await services.gateway.chatCompletions(streamRequest()));
    expect(withoutUsage.chunks.some((chunk) => chunk.usage)).toBe(false);

    upstream.script(KEY_A, { type: "stream", usage: { prompt: 11, candidates: 4 } });
    const withUsage = await readSse(await services.gateway.chatCompletions(streamRequest({ stream_options: { include_usage: true } })));
    const last = withUsage.chunks.at(-1);
    expect(last?.choices).toEqual([]);
    expect(last?.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 });
  });

  it("fails over to another key before the stream starts", async () => {
    build(`first=${KEY_A},second=${KEY_B}`);
    upstream.script(KEY_A, { type: "rate_limit", retryDelay: "30s" });
    upstream.script(KEY_B, { type: "stream", pieces: ["from B"] });

    const response = await services.gateway.chatCompletions(streamRequest());
    const { chunks } = await readSse(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-juggle-attempts")).toBe("2");
    expect(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("")).toBe("from B");
  });

  it("reports a mid-stream failure as an error event instead of retrying", async () => {
    build(`first=${KEY_A},second=${KEY_B}`);
    upstream.defaultBehavior = { type: "stream_error", before: 2 };
    upstream.script(KEY_A, { type: "stream_error", before: 2 });
    upstream.script(KEY_B, { type: "stream_error", before: 2 });

    const response = await services.gateway.chatCompletions(streamRequest());
    const { chunks, done } = await readSse(response);
    await Promise.allSettled(deferred);

    // The status line was already sent, so the failure travels in the stream.
    expect(response.status).toBe(200);
    expect(done).toBe(true);
    const errorEvent = chunks.at(-1);
    expect(errorEvent?.error).toMatchObject({ type: "upstream_error" });
    // Content received before the failure is preserved, and only one key was used.
    expect(chunks.filter((chunk) => chunk.choices?.[0]?.delta?.content).length).toBe(2);
    expect(upstream.calls.filter((call) => call.path.includes("streamGenerateContent")).length).toBe(1);

    const [logged] = await handle.db.select().from(requests);
    expect(logged).toMatchObject({ outcome: "upstream_error", stream: true });
  });

  it("records stream metadata, including time to first byte", async () => {
    upstream.script(KEY_A, { type: "stream", usage: { prompt: 7, candidates: 5 } });

    const response = await services.gateway.chatCompletions(streamRequest({ stream_options: { include_usage: true } }));
    await readSse(response);
    await Promise.allSettled(deferred);

    const [logged] = await handle.db.select().from(requests);
    expect(logged).toMatchObject({
      stream: true,
      outcome: "success",
      statusCode: 200,
      providerKeyHint: "AIza…AAAA",
      promptTokens: 7,
      completionTokens: 5,
    });
    expect(logged!.ttfbMs).not.toBeNull();
  });

  it("releases the concurrency slot when the stream ends", async () => {
    upstream.script(KEY_A, { type: "stream" });

    // The default cap is 10; more than that in sequence proves slots are returned.
    for (let i = 0; i < 12; i++) {
      const response = await services.gateway.chatCompletions(streamRequest());
      expect(response.status).toBe(200);
      await readSse(response);
    }
  });

  it("still rejects a streaming request that uses an unsupported parameter", async () => {
    const response = await services.gateway.chatCompletions(streamRequest({ tools: [{ type: "function", function: { name: "f" } }] }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.param).toBe("tools");
  });
});
