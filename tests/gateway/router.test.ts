import { beforeEach, describe, expect, it } from "vitest";
import type { ChatRequest } from "@/server/ai/chat-schema";
import type { ChatCompletion } from "@/server/ai/types";
import { DEFAULT_ROUTER_CONFIG, msUntilNextMidnight, type RouterConfig } from "@/server/gateway/policy";
import { KeyRouter, type RouteResult } from "@/server/gateway/router";
import { silentLogger } from "@/server/logger";
import { GeminiAdapter } from "@/server/providers/gemini/adapter";
import type { PreparedRequest } from "@/server/providers/types";
import { FakeGemini } from "../support/fake-gemini";
import { InMemoryKeyStore } from "../support/memory-key-store";

const MODEL = "gemini-3.8-flash";

function chat(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return { model: MODEL, messages: [{ role: "user", content: "Hello" }], stream: false, ...overrides } as ChatRequest;
}

interface Harness {
  store: InMemoryKeyStore;
  upstream: FakeGemini;
  adapter: GeminiAdapter;
  router: KeyRouter;
  clock: { now: number };
  sleeps: number[];
  send: (options?: { signal?: AbortSignal; deadlineMs?: number; timeoutMs?: number }) => Promise<RouteResult<ChatCompletion>>;
}

function harness(config: Partial<RouterConfig> = {}): Harness {
  const store = new InMemoryKeyStore();
  const upstream = new FakeGemini();
  const adapter = new GeminiAdapter({ fetch: upstream.fetch });
  const clock = { now: Date.parse("2026-09-19T12:00:00Z") };
  const sleeps: number[] = [];
  const router = new KeyRouter({
    keyStore: store,
    config: { ...DEFAULT_ROUTER_CONFIG, ...config },
    logger: silentLogger,
    now: () => new Date(clock.now),
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    keysUrl: "http://localhost:3000/dashboard/keys",
  });

  const prepared = adapter.prepareRequest(chat(), MODEL);
  if (!prepared.ok) throw new Error("prepare failed");
  const request: PreparedRequest = prepared.prepared;

  const send: Harness["send"] = (options = {}) =>
    router.route<ChatCompletion>({
      adapter,
      model: MODEL,
      signal: options.signal ?? new AbortController().signal,
      deadline: clock.now + (options.deadlineMs ?? 300_000),
      attempt: async (key, ctx) => {
        const result = await adapter.sendRequest(key, request, { signal: ctx.signal, timeoutMs: options.timeoutMs ?? 5_000 });
        if (!result.ok) return result;
        if (result.kind !== "completion") throw new Error("unexpected stream");
        return { ok: true, value: result.completion };
      },
    });

  return { store, upstream, adapter, router, clock, sleeps, send };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe("KeyRouter", () => {
  it("healthy key → request succeeds and key stats are recorded", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY-ONE-aaaaaaaaaaaaaaaa" });
    h.upstream.script("KEY-ONE-aaaaaaaaaaaaaaaa", { type: "ok", text: "hi there" });

    const result = await h.send();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.choices[0]?.message.content).toBe("hi there");
    expect(result.key.fingerprint).toBe("k1");
    expect(result.attempts).toHaveLength(1);
    const key = h.store.keys.get("k1")!;
    expect(key.successCount).toBe(1);
    expect(key.consecutiveFailures).toBe(0);
    expect(h.upstream.generateCalls()[0]?.key).toBe("KEY-ONE-aaaaaaaaaaaaaaaa");
  });

  it("key 1 rate limited → key 2 succeeds, and key 1 cools down for that model using RetryInfo", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(1_000) });
    h.upstream.script("KEY1", { type: "rate_limit", retryDelay: "42s" });
    h.upstream.script("KEY2", { type: "ok" });

    const result = await h.send();

    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => [a.fingerprint, a.outcome])).toEqual([
      ["k1", "rate_limited"],
      ["k2", "success"],
    ]);
    expect(h.store.modelCooldown("k1", MODEL)?.getTime()).toBe(h.clock.now + 42_000);
    expect(h.store.keys.get("k1")!.rateLimitCount).toBe(1);
    expect(h.store.keys.get("k1")!.status).toBe("active");
    // A rate limit rotates immediately, with no backoff sleep.
    expect(h.sleeps).toEqual([]);
  });

  it("cycles through the pool one key per request instead of draining one", async () => {
    // Ten healthy keys, twenty sequential requests: each key should serve exactly twice.
    const ids = Array.from({ length: 10 }, (_, index) => `k${index + 1}`);
    for (const id of ids) {
      h.store.add({ fingerprint: id, secret: `KEY-${id}` });
      h.upstream.script(`KEY-${id}`, { type: "ok" });
    }

    const served: string[] = [];
    for (let request = 0; request < 20; request++) {
      const result = await h.send();
      if (!result.ok) throw new Error("request failed");
      served.push(result.key.fingerprint);
      // Each attempt advances the clock, so "least recently used" is well ordered.
      h.clock.now += 1_000;
    }

    const counts = ids.map((id) => served.filter((used) => used === id).length);
    expect(counts).toEqual(Array.from({ length: 10 }, () => 2));
    // No key is used twice in a row while others are idle.
    expect(served.slice(0, 10).sort()).toEqual([...ids].sort());
  });

  it("does not immediately reuse a key that was just rate limited", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(1_000) });
    h.upstream.script("KEY1", { type: "rate_limit", retryDelay: "30s" }, { type: "ok" });
    h.upstream.script("KEY2", { type: "ok" });

    await h.send();
    const second = await h.send();

    expect(second.ok && second.key.fingerprint).toBe("k2");
    expect(h.upstream.callsFor("KEY1")).toHaveLength(1);
  });

  it("key 1 invalid → key 2 succeeds, key 1 is marked invalid and never used again", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(1_000) });
    h.upstream.script("KEY1", { type: "invalid_key" });
    h.upstream.script("KEY2", { type: "ok" });

    const first = await h.send();
    await h.send();

    expect(first.ok).toBe(true);
    expect(h.store.keys.get("k1")!.status).toBe("invalid");
    expect(h.store.keys.get("k1")!.statusReason).toBe("invalid_key");
    expect(h.upstream.callsFor("KEY1")).toHaveLength(1);
  });

  it("all keys rate limited → 429 all_keys_rate_limited with Retry-After of the earliest recovery", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.store.add({ fingerprint: "k2", secret: "KEY2" });
    h.upstream.script("KEY1", { type: "rate_limit", retryDelay: "20s" });
    h.upstream.script("KEY2", { type: "rate_limit", retryDelay: "50s" });

    const result = await h.send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(429);
    expect(result.error.code).toBe("all_keys_rate_limited");
    expect(result.error.retryAfterMs).toBe(20_000);
    expect(result.error.message).toContain("2 active Google Gemini keys");
    expect(result.outcome).toBe("rate_limited");
  });

  it("keys already cooling down → 429 without calling the provider", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", cooldownUntil: new Date(h.clock.now + 90_000) });
    h.store.add({ fingerprint: "k2", secret: "KEY2" });
    h.store.setModelCooldown("k2", MODEL, new Date(h.clock.now + 30_000));

    const result = await h.send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(429);
    expect(result.error.retryAfterMs).toBe(30_000);
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("cooldown key is skipped; a model cooldown only affects that model", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(5_000) });
    h.store.setModelCooldown("k1", MODEL, new Date(h.clock.now + 60_000));
    h.store.setModelCooldown("k1", "gemini-pro-latest", new Date(h.clock.now + 60_000));
    h.upstream.script("KEY2", { type: "ok" });

    const result = await h.send();

    expect(result.ok && result.key.fingerprint).toBe("k2");
    expect(h.upstream.callsFor("KEY1")).toHaveLength(0);

    // A cooldown for a different model does not block this one.
    h.store.modelCooldowns.clear();
    h.store.setModelCooldown("k1", "gemini-pro-latest", new Date(h.clock.now + 60_000));
    h.upstream.script("KEY1", { type: "ok" });
    const other = await h.send();
    expect(other.ok && other.key.fingerprint).toBe("k1");
  });

  it("expired cooldown → key becomes available again automatically", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", cooldownUntil: new Date(h.clock.now - 1) });
    h.store.setModelCooldown("k1", MODEL, new Date(h.clock.now - 1));
    h.upstream.script("KEY1", { type: "ok" });

    const result = await h.send();

    expect(result.ok && result.key.fingerprint).toBe("k1");
  });

  it("keys the provider rejected are never used again", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", status: "invalid" });
    h.store.add({ fingerprint: "k2", secret: "KEY2", status: "invalid" });

    const result = await h.send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_active_provider_keys");
    expect(result.error.status).toBe(400);
    expect(h.upstream.calls).toHaveLength(0);
  });

  it("no keys at all → helpful 400 pointing to the dashboard", async () => {
    const result = await h.send();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_provider_keys");
    expect(result.error.message).toContain("/dashboard/keys");
    expect(result.outcome).toBe("no_keys");
  });

  it("provider timeout → retries with backoff and succeeds", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "hang" }, { type: "ok" });

    const result = await h.send({ timeoutMs: 20 });

    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.outcome)).toEqual(["timeout", "success"]);
    expect(h.sleeps).toHaveLength(1);
    // One transient failure doesn't open the breaker; the success resets the counter.
    expect(h.store.keys.get("k1")!.consecutiveFailures).toBe(0);
  });

  it("transient errors prefer a different key before retrying the same one", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(1_000) });
    h.upstream.script("KEY1", { type: "server_error", status: 500 });
    h.upstream.script("KEY2", { type: "ok" });

    const result = await h.send();

    expect(result.attempts.map((a) => [a.fingerprint, a.outcome])).toEqual([
      ["k1", "upstream_error"],
      ["k2", "success"],
    ]);
  });

  it("persistent timeouts → stops after the transient retry budget with 504", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "hang" });

    const result = await h.send({ timeoutMs: 10 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(504);
    expect(result.error.code).toBe("upstream_timeout");
    // 1 initial attempt + maxTransientRetries (2)
    expect(result.attempts).toHaveLength(3);
  });

  it("maximum retry count → stops even when more keys remain", async () => {
    const local = harness({ maxAttempts: 3 });
    for (let i = 1; i <= 6; i++) {
      local.store.add({ fingerprint: `k${i}`, secret: `KEY${i}`, lastUsedAt: new Date(i) });
      local.upstream.script(`KEY${i}`, { type: "rate_limit", retryDelay: "60s" });
    }

    const result = await local.send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.attempts).toHaveLength(3);
    expect(local.upstream.generateCalls()).toHaveLength(3);
    expect(result.error.code).toBe("attempts_exhausted");
    expect(result.error.status).toBe(503);
  });

  it("400 bad request → not retried, provider message passed through (scrubbed)", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.store.add({ fingerprint: "k2", secret: "KEY2" });
    h.upstream.defaultBehavior = { type: "bad_request", message: "Invalid value at 'contents' for key AIzaSyA1234567890abcdefghijklmnopqrstu" };

    const result = await h.send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(400);
    expect(result.error.code).toBe("provider_rejected_request");
    expect(result.error.message).toContain("Invalid value at 'contents'");
    expect(result.error.message).not.toContain("AIzaSyA1234567890");
    expect(result.attempts).toHaveLength(1);
    // Not the key's fault.
    const used = [...h.store.keys.values()].find((key) => key.requestCount === 1)!;
    expect(used.consecutiveFailures).toBe(0);
    expect(used.status).toBe("active");
  });

  it("404 model not found → 404 without retry", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.store.add({ fingerprint: "k2", secret: "KEY2" });
    h.upstream.defaultBehavior = { type: "not_found" };

    const result = await h.send();

    expect(!result.ok && result.error.status).toBe(404);
    expect(result.attempts).toHaveLength(1);
  });

  it("per-day quota exhaustion cools the key until the next Pacific midnight", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "rate_limit", retryDelay: "34s", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" });

    await h.send();

    const until = h.store.modelCooldown("k1", MODEL)!;
    const expected = h.clock.now + msUntilNextMidnight(new Date(h.clock.now), "America/Los_Angeles");
    expect(until.getTime()).toBe(expected);
    // Sanity: 12:00Z is 05:00 PDT → ~19h until midnight.
    expect(until.getTime() - h.clock.now).toBeGreaterThan(18 * 3600_000);
  });

  it("429 with no hint uses the provider's default cooldown", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "raw", status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource exhausted" } } });

    await h.send();

    expect(h.store.modelCooldown("k1", MODEL)!.getTime() - h.clock.now).toBe(h.adapter.config.defaultRateLimitCooldownMs);
  });

  it("a rate limit on one key cools down its whole quota group", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", quotaGroup: "project-a", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", quotaGroup: "project-a", lastUsedAt: new Date(1) });
    h.store.add({ fingerprint: "k3", secret: "KEY3", quotaGroup: "project-b", lastUsedAt: new Date(2) });
    h.upstream.script("KEY1", { type: "rate_limit", retryDelay: "60s" });
    h.upstream.script("KEY3", { type: "ok" });

    const result = await h.send();

    expect(result.ok && result.key.fingerprint).toBe("k3");
    expect(h.upstream.callsFor("KEY2")).toHaveLength(0);
    expect(h.store.modelCooldown("k2", MODEL)).not.toBeNull();
    expect(h.store.modelCooldown("k3", MODEL)).toBeNull();
  });

  it("repeated failures open the circuit breaker and cool the key down", async () => {
    const local = harness({ maxTransientRetries: 5, maxAttempts: 10, breakerThreshold: 3 });
    local.store.add({ fingerprint: "k1", secret: "KEY1" });
    local.upstream.script("KEY1", { type: "server_error", status: 500 });

    const result = await local.send();

    expect(result.ok).toBe(false);
    const key = local.store.keys.get("k1")!;
    expect(key.consecutiveFailures).toBe(3);
    expect(key.cooldownUntil).not.toBeNull();
    // The breaker stops further attempts once the key is cooling down.
    expect(result.attempts).toHaveLength(3);
  });

  it("503 overload is retried but not held against the key", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "server_error", status: 503 }, { type: "ok" });

    const result = await h.send();

    expect(result.ok).toBe(true);
    expect(h.store.keys.get("k1")!.consecutiveFailures).toBe(0);
    expect(h.store.keys.get("k1")!.cooldownUntil).toBeNull();
  });

  it("permission denied → key-wide cooldown and rotation, provider text not exposed", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1", lastUsedAt: new Date(0) });
    h.store.add({ fingerprint: "k2", secret: "KEY2", lastUsedAt: new Date(1) });
    h.upstream.script("KEY1", { type: "permission_denied" });
    h.upstream.script("KEY2", { type: "permission_denied" });

    const result = await h.send();

    expect(result.ok).toBe(false);
    expect(h.store.keys.get("k1")!.cooldownUntil).not.toBeNull();
    if (!result.ok) expect(result.error.message).not.toContain("123456789");
  });


  it("client cancellation stops routing without penalising keys", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.store.add({ fingerprint: "k2", secret: "KEY2" });
    h.upstream.defaultBehavior = { type: "hang" };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const result = await h.send({ signal: controller.signal, timeoutMs: 5_000 });

    expect(!result.ok && result.outcome).toBe("cancelled");
    expect(result.attempts).toHaveLength(1);
    expect([...h.store.keys.values()].every((key) => key.consecutiveFailures === 0)).toBe(true);
  });

  it("respects the overall deadline", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "server_error", status: 500 });

    const result = await h.send({ deadlineMs: 100 });

    expect(!result.ok && result.error.code).toBe("gateway_timeout");
  });

  it("only offers keys the environment still configures", async () => {
    h.store.add({ fingerprint: "k1", secret: "KEY1" });
    h.upstream.script("KEY1", { type: "ok" });
    expect((await h.send()).ok).toBe(true);

    // Removing a key from the environment removes it from rotation entirely.
    h.store.keys.delete("k1");
    const after = await h.send();

    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("no_provider_keys");
  });
});
