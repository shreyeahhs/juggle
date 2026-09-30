import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configFromEnv, createServices, type AppConfig, type Services } from "@/server/container";
import type { DbHandle } from "@/server/db/client";
import { providerKeys, requests } from "@/server/db/schema";
import { parseEnv } from "@/server/env";
import { silentLogger } from "@/server/logger";
import { FakeGemini } from "../support/fake-gemini";
import { createTestDb, resetDb, TEST_AUTH_SECRET, TEST_OWNER_PASSWORD } from "../support/test-db";

const MODEL = "gemini-3.8-flash";
const KEY_A = "AIzaSyTESTKEYAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "AIzaSyTESTKEYBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TOKEN = "gw_live_TESTTOKENoooooooooooooooooooooooo";

/** Builds a config exactly as a deployment's environment would. */
function testConfig(overrides: { keys?: string; tokens?: string; quotaGroup?: string; gateway?: Partial<AppConfig["gateway"]> } = {}): AppConfig {
  const base = configFromEnv(
    parseEnv({
      NODE_ENV: "test",
      APP_URL: "http://gw.test",
      AUTH_SECRET: TEST_AUTH_SECRET,
      OWNER_PASSWORD: TEST_OWNER_PASSWORD,
      GEMINI_API_KEYS: overrides.keys ?? `first=${KEY_A}`,
      GATEWAY_API_KEYS: overrides.tokens ?? `app=${TOKEN}`,
      ...(overrides.quotaGroup ? { GEMINI_QUOTA_GROUP: overrides.quotaGroup } : {}),
    }),
  );
  return { ...base, gateway: { ...base.gateway, ...overrides.gateway } };
}

let handle: DbHandle;
let services: Services;
let upstream: FakeGemini;
let deferred: Promise<unknown>[];

function build(config: AppConfig = testConfig()): Services {
  upstream = new FakeGemini();
  deferred = [];
  services = createServices({
    db: handle.db,
    config,
    logger: silentLogger,
    fetchImpl: upstream.fetch,
    defer: (task) => deferred.push(task()),
  });
  return services;
}

async function flush(): Promise<void> {
  await Promise.allSettled(deferred);
  deferred.length = 0;
}

function chatRequest(body: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}): Request {
  return new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = { model: MODEL, messages: [{ role: "user", content: "Hello" }] };

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.close();
});
beforeEach(async () => {
  if (deferred) await Promise.allSettled(deferred);
  await resetDb(handle);
  build();
});

describe("gateway /v1/chat/completions", () => {
  it("returns an OpenAI-shaped completion and logs metadata only", async () => {
    upstream.script(KEY_A, { type: "ok", text: "Hi!", usage: { prompt: 11, candidates: 5, thoughts: 3 } });

    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    const body = await response.json();
    await flush();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: "chat.completion",
      model: MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 8, total_tokens: 19 },
    });

    const [logged] = await handle.db.select().from(requests);
    expect(logged).toMatchObject({ provider: "gemini", model: MODEL, outcome: "success", attempts: 1, tokenLabel: "app", promptTokens: 11 });
    // There is no column that could hold the prompt or the answer.
    expect(JSON.stringify(logged)).not.toContain("Hello");
    expect(JSON.stringify(logged)).not.toContain("Hi!");
  });

  it("never stores the provider key, only a fingerprint and a hint", async () => {
    upstream.script(KEY_A, { type: "ok" });
    await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    const rows = await handle.db.select().from(providerKeys);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.keyHint).toBe("AIza…AAAA");
    // The whole row, and the whole database, is free of key material.
    expect(JSON.stringify(rows)).not.toContain(KEY_A);
    expect(rows[0]!.fingerprint).not.toContain(KEY_A);
  });

  it("rotates to the next key on 429 and remembers the cooldown", async () => {
    build(testConfig({ keys: `first=${KEY_A},second=${KEY_B}` }));
    upstream.script(KEY_A, { type: "rate_limit", retryDelay: "45s" });
    upstream.script(KEY_B, { type: "ok", text: "from B" });

    const first = await services.gateway.chatCompletions(chatRequest(validBody));
    expect(first.status).toBe(200);
    expect((await first.json()).choices[0].message.content).toBe("from B");
    await flush();

    // The cooling key is skipped entirely on the next request.
    upstream.calls.length = 0;
    const second = await services.gateway.chatCompletions(chatRequest(validBody));
    expect(second.status).toBe(200);
    expect(upstream.callsFor(KEY_A)).toHaveLength(0);

    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    const cooling = keys.find((key) => key.label === "first")!;
    expect(cooling.health).toBe("rate_limited");
    expect(cooling.rateLimitCount).toBe(1);
  });

  it("returns 429 with Retry-After when every key is rate limited", async () => {
    build(testConfig({ keys: `${KEY_A},${KEY_B}` }));
    upstream.defaultBehavior = { type: "rate_limit", retryDelay: "25s" };

    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    const body = await response.json();
    await flush();

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBe(25);
    expect(body.error.code).toBe("all_keys_rate_limited");
    const [logged] = await handle.db.select().from(requests);
    expect(logged).toMatchObject({ outcome: "rate_limited", attempts: 2 });
  });

  it("marks a rejected key invalid and keeps serving from the healthy one", async () => {
    build(testConfig({ keys: `bad=${KEY_A},good=${KEY_B}` }));
    upstream.script(KEY_A, { type: "invalid_key" });
    upstream.script(KEY_B, { type: "ok" });

    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    expect(response.status).toBe(200);
    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys.find((key) => key.label === "bad")!.health).toBe("invalid");
    expect(keys.find((key) => key.label === "good")!.health).toBe("healthy");
  });

  it("cools down a whole quota group together", async () => {
    build(testConfig({ keys: `one=${KEY_A},two=${KEY_B}`, quotaGroup: "shared-project" }));
    upstream.script(KEY_A, { type: "rate_limit", retryDelay: "60s" });
    upstream.script(KEY_B, { type: "rate_limit", retryDelay: "60s" });

    await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    // Both keys draw on one quota, so both are parked rather than tried in turn.
    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys.every((key) => key.health === "rate_limited")).toBe(true);
  });

  it("keeps keys from separate projects on separate quotas", async () => {
    // Written the way a deployment writes it: two projects in one variable.
    build(testConfig({ keys: `one@project-a=${KEY_A},two@project-b=${KEY_B}` }));
    upstream.script(KEY_A, { type: "rate_limit", retryDelay: "60s" });
    upstream.script(KEY_B, { type: "ok" });

    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    // Project A being spent says nothing about project B, so the request is served.
    expect(response.status).toBe(200);
    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys.find((key) => key.label === "one")!.health).toBe("rate_limited");
    expect(keys.find((key) => key.label === "two")!.health).toBe("healthy");
  });

  it("never exposes the provider key in an error", async () => {
    upstream.script(KEY_A, { type: "invalid_key" });
    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    const text = await response.text();
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain("AIzaSy");
  });

  it("reports a useful error when no provider keys are configured", async () => {
    build(testConfig({ keys: "" }));
    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("no_provider_keys");
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("gateway authentication", () => {
  it("rejects a missing token", async () => {
    const response = await services.gateway.chatCompletions(chatRequest(validBody, null));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("missing_api_key");
  });

  it("rejects an unknown token", async () => {
    const response = await services.gateway.chatCompletions(chatRequest(validBody, "gw_live_not-the-configured-token"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid_api_key");
    expect(upstream.calls).toHaveLength(0);
  });

  it("accepts any configured token and records which one was used", async () => {
    const second = "gw_live_SECONDTOKENpppppppppppppppppppppp";
    build(testConfig({ tokens: `app=${TOKEN},ci=${second}` }));
    upstream.defaultBehavior = { type: "ok" };
    upstream.script(KEY_A, { type: "ok" });

    expect((await services.gateway.chatCompletions(chatRequest(validBody, second))).status).toBe(200);
    await flush();

    const [logged] = await handle.db.select().from(requests);
    expect(logged!.tokenLabel).toBe("ci");
  });

  it("hints when a provider key is used as the gateway token", async () => {
    const response = await services.gateway.chatCompletions(chatRequest(validBody, KEY_A));
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toContain("provider key");
  });

  it("accepts x-api-key as well as bearer", async () => {
    upstream.script(KEY_A, { type: "ok" });
    const request = new Request("https://gw.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": TOKEN },
      body: JSON.stringify(validBody),
    });
    expect((await services.gateway.chatCompletions(request)).status).toBe(200);
  });
});

describe("gateway request validation", () => {
  beforeEach(() => {
    upstream.script(KEY_A, { type: "ok" });
  });

  it("rejects malformed JSON", async () => {
    const response = await services.gateway.chatCompletions(chatRequest("{not json"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
  });

  it("rejects a body that fails validation, naming the parameter", async () => {
    const response = await services.gateway.chatCompletions(chatRequest({ model: MODEL, messages: [] }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.param).toBe("messages");
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects an unknown model without calling the provider", async () => {
    const response = await services.gateway.chatCompletions(chatRequest({ ...validBody, model: "gpt-4o" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("model_not_supported");
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects unsupported parameters instead of ignoring them", async () => {
    const response = await services.gateway.chatCompletions(chatRequest({ ...validBody, tools: [{ type: "function", function: { name: "f" } }] }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("unsupported_parameter");
    expect(body.error.param).toBe("tools");
  });

  it("rejects a non-JSON content type", async () => {
    const response = await services.gateway.chatCompletions(chatRequest(validBody, TOKEN, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects an over-sized body", async () => {
    build(testConfig({ gateway: { maxBodyBytes: 1024 } }));
    const big = { model: MODEL, messages: [{ role: "user", content: "x".repeat(200_000) }] };
    const response = await services.gateway.chatCompletions(chatRequest(big));
    expect(response.status).toBe(413);
  });

  it("accepts a provider-prefixed model name", async () => {
    const response = await services.gateway.chatCompletions(chatRequest({ ...validBody, model: "gemini/gemini-3.8-flash" }));
    expect(response.status).toBe(200);
    expect(upstream.generateCalls()[0]?.path).toContain("/models/gemini-3.8-flash:generateContent");
  });
});

describe("gateway limits", () => {
  it("enforces the per-token requests-per-minute limit", async () => {
    build(testConfig({ gateway: { tokenRpm: 2 } }));
    upstream.script(KEY_A, { type: "ok" });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await services.gateway.chatCompletions(chatRequest(validBody))).status);
    await flush();

    expect(statuses).toEqual([200, 200, 429]);
    const logged = await handle.db.select().from(requests);
    expect(logged.some((row) => row.outcome === "rate_limited" && row.errorCode === "rate_limit_exceeded")).toBe(true);
  });

  it("reports rate-limit headers", async () => {
    upstream.script(KEY_A, { type: "ok" });
    const response = await services.gateway.chatCompletions(chatRequest(validBody));
    expect(response.headers.get("x-ratelimit-limit-requests")).toBe("120");
    expect(response.headers.get("x-ratelimit-remaining-requests")).toBe("119");
  });
});

describe("gateway /v1/models", () => {
  it("lists the models the configured keys can serve", async () => {
    upstream.script(KEY_A, { type: "ok" });
    const response = await services.gateway.listModels(new Request("https://gw.test/v1/models", { headers: { authorization: `Bearer ${TOKEN}` } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((model: { id: string }) => model.id)).toEqual(["gemini-3.8-flash", "gemini-pro-latest"]);
  });

  it("returns an empty list when no keys are configured", async () => {
    build(testConfig({ keys: "" }));
    const response = await services.gateway.listModels(new Request("https://gw.test/v1/models", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

  it("404s unknown endpoints", async () => {
    const response = services.gateway.notFound(new Request("https://gw.test/v1/embeddings", { method: "POST" }));
    expect(response.status).toBe(404);
  });
});

describe("key statistics", () => {
  it("records per-key counts and an even share across the pool", async () => {
    build(testConfig({ keys: `one=${KEY_A},two=${KEY_B}` }));
    upstream.defaultBehavior = { type: "ok" };
    upstream.script(KEY_A, { type: "ok" });
    upstream.script(KEY_B, { type: "ok" });

    for (let i = 0; i < 4; i++) await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys.map((key) => key.requestCount)).toEqual([2, 2]);
    expect(keys.every((key) => key.successCount === 2 && key.share === 0.5)).toBe(true);
  });

  it("keeps a key's history when its label changes in the environment", async () => {
    upstream.script(KEY_A, { type: "ok" });
    await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    // Same secret, new label: the fingerprint is unchanged, so stats carry over.
    build(testConfig({ keys: `renamed=${KEY_A}` }));
    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys[0]).toMatchObject({ label: "renamed", requestCount: 1 });
  });

  it("starts a newly configured key with a clean slate", async () => {
    upstream.script(KEY_A, { type: "ok" });
    await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    build(testConfig({ keys: `first=${KEY_A},added=${KEY_B}` }));
    const keys = await services.stats.keyPerformance(services.config.providerKeys);
    expect(keys.find((key) => key.label === "added")).toMatchObject({ requestCount: 0, health: "healthy" });
  });

  it("removes a key's health row only when the database is pruned, not when it leaves the environment", async () => {
    upstream.script(KEY_A, { type: "ok" });
    await services.gateway.chatCompletions(chatRequest(validBody));
    await flush();

    build(testConfig({ keys: `other=${KEY_B}` }));
    const keys = await services.stats.keyPerformance(services.config.providerKeys);

    // The dashboard shows what is configured now…
    expect(keys.map((key) => key.label)).toEqual(["other"]);
    // …while the old row survives until pruned, so re-adding the key restores its history.
    const rows = await handle.db.select().from(providerKeys).where(eq(providerKeys.label, "first"));
    expect(rows).toHaveLength(1);
  });
});
