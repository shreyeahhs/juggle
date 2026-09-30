import OpenAI, { APIError } from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configFromEnv, createServices, type Services } from "@/server/container";
import type { DbHandle } from "@/server/db/client";
import { parseEnv } from "@/server/env";
import { silentLogger } from "@/server/logger";
import { FakeGemini } from "../support/fake-gemini";
import { createTestDb, resetDb, TEST_AUTH_SECRET, TEST_OWNER_PASSWORD } from "../support/test-db";

/**
 * Compatibility check with the real `openai` client: the point of the gateway
 * is that an unmodified OpenAI SDK works against it. The SDK's own fetch is
 * pointed at the gateway handler, so this exercises its request building,
 * response parsing and error types without a network.
 */

const GEMINI_KEY = "AIzaSyTESTKEYSDK00000000000000000000000";
const TOKEN = "gw_live_TESTSDKtokenoooooooooooooooooooooo";
const MODEL = "gemini-3.8-flash";

let handle: DbHandle;
let services: Services;
let upstream: FakeGemini;
let client: OpenAI;
/** Routes SDK requests into the gateway handler instead of the network. */
let gatewayFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await resetDb(handle);
  upstream = new FakeGemini();
  services = createServices({
    db: handle.db,
    config: configFromEnv(
      parseEnv({
        NODE_ENV: "test",
        APP_URL: "http://gw.test",
        AUTH_SECRET: TEST_AUTH_SECRET,
        OWNER_PASSWORD: TEST_OWNER_PASSWORD,
        GEMINI_API_KEYS: GEMINI_KEY,
        GATEWAY_API_KEYS: TOKEN,
      }),
    ),
    logger: silentLogger,
    fetchImpl: upstream.fetch,
    defer: (task) => {
      void task();
    },
  });

  // Healthy by default; individual tests override this.
  upstream.script(GEMINI_KEY, { type: "ok" });

  gatewayFetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.pathname === "/v1/chat/completions") return services.gateway.chatCompletions(request);
    if (url.pathname === "/v1/models") return services.gateway.listModels(request);
    if (url.pathname.startsWith("/v1/models/")) return services.gateway.retrieveModel(request, url.pathname.slice("/v1/models/".length));
    return services.gateway.notFound(request);
  };

  client = new OpenAI({ apiKey: TOKEN, baseURL: "http://gw.test/v1", maxRetries: 0, fetch: gatewayFetch });
});

describe("OpenAI SDK compatibility", () => {
  it("completes a chat request", async () => {
    upstream.script(GEMINI_KEY, { type: "ok", text: "Hello from Gemini", usage: { prompt: 12, candidates: 4 } });

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      temperature: 0.2,
      max_completion_tokens: 128,
    });

    expect(completion.choices[0]?.message.content).toBe("Hello from Gemini");
    expect(completion.choices[0]?.finish_reason).toBe("stop");
    expect(completion.object).toBe("chat.completion");
    expect(completion.usage?.prompt_tokens).toBe(12);
    // The SDK's typed model field round-trips the requested name.
    expect(completion.model).toBe(MODEL);
  });

  it("streams a completion through the SDK's async iterator", async () => {
    upstream.script(GEMINI_KEY, { type: "stream", pieces: ["Streaming", " works", "."], usage: { prompt: 8, candidates: 3 } });

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let finishReason: string | null = null;
    let usage: { total_tokens: number } | null = null;
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? "";
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
      if (chunk.usage) usage = chunk.usage;
    }

    expect(text).toBe("Streaming works.");
    expect(finishReason).toBe("stop");
    expect(usage?.total_tokens).toBe(11);
  });

  it("lists models", async () => {
    const models = await client.models.list();
    expect(models.data.map((model) => model.id)).toContain(MODEL);
  });

  it("raises AuthenticationError for a bad key", async () => {
    const bad = new OpenAI({ apiKey: "gw_live_wrong", baseURL: "http://gw.test/v1", maxRetries: 0, fetch: gatewayFetch });
    await expect(bad.chat.completions.create({ model: MODEL, messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 401,
      type: "authentication_error",
    });
  });

  it("raises RateLimitError with the gateway's message when every key is throttled", async () => {
    upstream.script(GEMINI_KEY, { type: "rate_limit", retryDelay: "30s" });

    const error = await client.chat.completions
      .create({ model: MODEL, messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((caught: unknown) => caught as APIError);

    expect(error).toBeInstanceOf(APIError);
    expect(error?.status).toBe(429);
    expect(error?.code).toBe("all_keys_rate_limited");
    expect(error?.headers?.get?.("retry-after")).toBe("30");
  });

  it("raises BadRequestError with the offending parameter", async () => {
    const error = await client.chat.completions
      // `n: 99` is above the gateway's accepted range.
      .create({ model: MODEL, messages: [{ role: "user", content: "hi" }], n: 99 })
      .then(() => null)
      .catch((caught: unknown) => caught as APIError);

    expect(error?.status).toBe(400);
    expect(error?.param).toBe("n");
  });

  it("reports a useful error when no keys are configured", async () => {
    services = createServices({
      db: handle.db,
      config: configFromEnv(
        parseEnv({
          NODE_ENV: "test",
          APP_URL: "http://gw.test",
          AUTH_SECRET: TEST_AUTH_SECRET,
          OWNER_PASSWORD: TEST_OWNER_PASSWORD,
          GEMINI_API_KEYS: "",
          GATEWAY_API_KEYS: TOKEN,
        }),
      ),
      logger: silentLogger,
      fetchImpl: upstream.fetch,
      defer: (task) => {
        void task();
      },
    });

    const error = await client.chat.completions
      .create({ model: MODEL, messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((caught: unknown) => caught as APIError);

    expect(error?.status).toBe(400);
    expect(error?.code).toBe("no_provider_keys");
    expect(String(error?.message)).toContain("Google Gemini");
  });
});
