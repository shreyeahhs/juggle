import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { chatRequestSchema } from "@/server/ai/chat-schema";
import type { ModelInfo } from "@/server/ai/types";
import type { Logger } from "@/server/logger";
import type { ProviderRegistry } from "@/server/providers/registry";
import { SSE_DONE, sseEvent } from "@/server/providers/sse";
import type { ConfiguredGatewayToken } from "@/server/keys/env-keys";
import type { ProviderAdapter, ProviderResult, ProviderStreamEvent } from "@/server/providers/types";
import { authenticateGatewayRequest, type GatewayPrincipal } from "./auth";
import { errorResponse, gatewayError, outcomeForStatus, type GatewayError, type RequestOutcome } from "./errors";
import { clientIp, decide, type AuthFailureThrottle, type ConcurrencyLimiter, type RateLimiter, type RateLimitRule } from "./limits";
import type { RateLimitEventEntry, RequestLogEntry, RequestLogSink } from "./request-log";
import type { AttemptRecord, KeyRouter } from "./router";

export interface GatewayConfig {
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  streamIdleTimeoutMs: number;
  requestDeadlineMs: number;
  tokenRpm: number;
  totalRpm: number;
  dailyRequests: number;
  maxConcurrency: number;
  corsOrigins: readonly string[];
  trustProxy: boolean;
}

export interface GatewayDeps {
  config: GatewayConfig;
  registry: ProviderRegistry;
  router: KeyRouter;
  tokens: readonly ConfiguredGatewayToken[];
  rateLimiter: RateLimiter;
  concurrency: ConcurrencyLimiter;
  authThrottle: AuthFailureThrottle;
  requestLog: RequestLogSink;
  logger: Logger;
  now?: () => Date;
  /** Schedules post-response work (Next.js `after`, Vercel `waitUntil`). Defaults to fire-and-forget. */
  defer?: (task: () => Promise<unknown>) => void;
}

type Endpoint = RequestLogEntry["endpoint"];

/** Per-request bookkeeping that ends up in the metadata log. */
interface RequestContext {
  id: string;
  publicId: string;
  startedAt: Date;
  principal: GatewayPrincipal;
  endpoint: Endpoint;
  headers: Record<string, string>;
  release: () => void;
  provider: string | null;
  model: string | null;
  stream: boolean;
  attempts: AttemptRecord[];
  providerKey: { fingerprint: string; label: string; hint: string } | null;
  usage: { prompt: number | null; completion: number | null; reasoning: number | null; total: number | null };
  gatewayLimitEvent?: RateLimitEventEntry;
}

const MODEL_CACHE_TTL_MS = 10 * 60_000;
const MODEL_CACHE_MAX_ENTRIES = 5_000;
const OWNERS: Record<string, string> = { gemini: "google" };

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function zodIssueToError(error: z.ZodError): GatewayError {
  const issue = error.issues[0];
  const param = issue
    ? issue.path.reduce<string>((acc, part) => (typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)), "")
    : null;
  const message = issue ? `${param ? `${param}: ` : ""}${issue.message}` : "Invalid request body.";
  return gatewayError(400, "invalid_request_error", "invalid_request", message, { param });
}

type BodyResult = { ok: true; value: unknown } | { ok: false; error: GatewayError };

/** Reads and parses a JSON body, enforcing the size cap while streaming (Content-Length can lie). */
async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const tooLarge = gatewayError(413, "invalid_request_error", "request_too_large", `Request body exceeds the ${Math.floor(maxBytes / 1024)} KiB limit.`);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, error: tooLarge };
  if (!request.body) return { ok: false, error: gatewayError(400, "invalid_request_error", "invalid_json", "Request body is empty.") };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: tooLarge };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, error: gatewayError(400, "invalid_request_error", "invalid_json", "Request body is not valid JSON.") };
  }
}

export class Gateway {
  private readonly now: () => Date;
  private readonly defer: (task: () => Promise<unknown>) => void;
  private readonly modelCache = new Map<string, { expires: number; models: ModelInfo[] }>();

  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly deps: GatewayDeps) {
    this.now = deps.now ?? (() => new Date());
    this.defer =
      deps.defer ??
      ((task) => {
        const promise = task()
          .catch((error: unknown) => deps.logger.error("deferred task failed", { error }))
          .finally(() => this.pending.delete(promise));
        this.pending.add(promise);
      });
  }

  /**
   * Resolves once the post-response writes started so far have finished.
   * Route handlers hand this to Next's `after()` so serverless functions are
   * not frozen before the metadata log is written.
   */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /* ─── public endpoints ──────────────────────────────────────────────────── */

  async chatCompletions(request: Request): Promise<Response> {
    const begun = await this.begin(request, "chat.completions");
    if (begun instanceof Response) return begun;
    const ctx = begun;
    let streaming = false;

    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^application\/json\b/i.test(contentType)) {
        return this.finish(ctx, gatewayError(415, "invalid_request_error", "unsupported_media_type", "Content-Type must be application/json."));
      }
      const body = await readJsonBody(request, this.deps.config.maxBodyBytes);
      if (!body.ok) return this.finish(ctx, body.error);

      const parsed = chatRequestSchema.safeParse(body.value);
      if (!parsed.success) return this.finish(ctx, zodIssueToError(parsed.error));
      const chat = parsed.data;

      const resolved = this.deps.registry.resolveModel(chat.model);
      if (!resolved.ok) return this.finish(ctx, gatewayError(400, "invalid_request_error", resolved.code, resolved.message, { param: "model" }));
      const { adapter } = resolved;

      const preparedResult = adapter.prepareRequest(chat, resolved.model);
      if (!preparedResult.ok) {
        return this.finish(ctx, gatewayError(400, "invalid_request_error", preparedResult.code, preparedResult.message, { param: preparedResult.param ?? null }));
      }
      const prepared = preparedResult.prepared;
      ctx.provider = adapter.id;
      ctx.model = prepared.model;
      ctx.stream = prepared.stream;

      const { config } = this.deps;
      const result = await this.deps.router.route<ProviderResult & { ok: true }>({
        adapter,
        model: prepared.model,
        signal: request.signal,
        deadline: ctx.startedAt.getTime() + config.requestDeadlineMs,
        attempt: async (key, attempt) => {
          const response = await adapter.sendRequest(key, prepared, {
            signal: attempt.signal,
            timeoutMs: Math.min(config.upstreamTimeoutMs, attempt.remainingMs),
            streamIdleTimeoutMs: config.streamIdleTimeoutMs,
          });
          return response.ok ? { ok: true, value: response } : response;
        },
      });
      ctx.attempts = result.attempts;
      if (!result.ok) return this.finish(ctx, result.error, result.outcome);
      ctx.providerKey = result.key;

      const value = result.value;
      if (value.kind === "completion") {
        const usage = value.completion.usage;
        if (usage) {
          ctx.usage = {
            prompt: usage.prompt_tokens,
            completion: usage.completion_tokens,
            reasoning: usage.completion_tokens_details?.reasoning_tokens ?? null,
            total: usage.total_tokens,
          };
        }
        return this.finish(ctx, 200, value.completion);
      }

      // Streaming: hand the response back immediately and keep the slot held until the stream ends.
      streaming = true;
      return this.streamResponse(ctx, value.stream);
    } catch (error) {
      this.deps.logger.error("gateway request failed", { requestId: ctx.publicId, error });
      return this.finish(ctx, gatewayError(500, "server_error", "internal_error", "Internal gateway error."), "internal_error");
    } finally {
      // A streaming response releases its concurrency slot when the stream ends.
      if (!streaming) ctx.release();
    }
  }

  /**
   * Serialises provider chunks as SSE, forwarding each one as it arrives rather
   * than buffering the completion. Nothing is retried once bytes are on the
   * wire: a mid-stream failure becomes a final error event.
   */
  private streamResponse(ctx: RequestContext, chunks: ReadableStream<ProviderStreamEvent>): Response {
    const encoder = new TextEncoder();
    const reader = chunks.getReader();
    const logger = this.deps.logger;
    const startedAt = this.now().getTime();
    let ttfbMs: number | null = null;
    let settled = false;

    const settle = (statusCode: number, outcome: RequestOutcome, errorCode: string | null) => {
      if (settled) return;
      settled = true;
      ctx.release();
      this.log(ctx, statusCode, outcome, errorCode, ttfbMs);
    };

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(encoder.encode(SSE_DONE));
            controller.close();
            settle(200, "success", null);
            return;
          }
          ttfbMs ??= Date.now() - startedAt;

          if (value.type === "error") {
            const cancelled = value.error.kind === "cancelled";
            if (!cancelled) {
              // The 200 status line is already sent, so the failure travels in-band.
              controller.enqueue(
                encoder.encode(
                  sseEvent({
                    error: { message: value.error.message, type: "upstream_error", code: value.error.kind, request_id: ctx.publicId },
                  }),
                ),
              );
              controller.enqueue(encoder.encode(SSE_DONE));
            }
            controller.close();
            settle(200, cancelled ? "cancelled" : "upstream_error", value.error.kind);
            return;
          }

          if (value.chunk.usage) {
            ctx.usage = {
              prompt: value.chunk.usage.prompt_tokens,
              completion: value.chunk.usage.completion_tokens,
              reasoning: value.chunk.usage.completion_tokens_details?.reasoning_tokens ?? null,
              total: value.chunk.usage.total_tokens,
            };
          }
          controller.enqueue(encoder.encode(sseEvent(value.chunk)));
        } catch (error) {
          logger.error("stream forwarding failed", { requestId: ctx.publicId, error });
          controller.close();
          settle(200, "upstream_error", "stream_failed");
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
        settle(200, "cancelled", "client_closed_request");
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        ...ctx.headers,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        // Stops nginx-style proxies from buffering the stream.
        "x-accel-buffering": "no",
        "x-juggle-attempts": String(ctx.attempts.length),
      },
    });
  }

  async listModels(request: Request): Promise<Response> {
    const begun = await this.begin(request, "models.list");
    if (begun instanceof Response) return begun;
    const ctx = begun;
    try {
      const data: Array<{ id: string; object: "model"; created: number; owned_by: string }> = [];
      for (const adapter of this.deps.registry.list()) {
        const result = await this.modelsFor(ctx, request, adapter);
        if (result.ok) {
          for (const model of result.models) data.push({ id: model.id, object: "model", created: 0, owned_by: OWNERS[adapter.id] ?? adapter.id });
        } else if (result.error.code !== "no_provider_keys" && result.error.code !== "no_active_provider_keys") {
          return this.finish(ctx, result.error, result.outcome);
        }
      }
      return this.finish(ctx, 200, { object: "list", data });
    } catch (error) {
      this.deps.logger.error("model listing failed", { requestId: ctx.publicId, error });
      return this.finish(ctx, gatewayError(500, "server_error", "internal_error", "Internal gateway error."), "internal_error");
    } finally {
      ctx.release();
    }
  }

  async retrieveModel(request: Request, modelId: string): Promise<Response> {
    const begun = await this.begin(request, "models.retrieve");
    if (begun instanceof Response) return begun;
    const ctx = begun;
    try {
      const resolved = this.deps.registry.resolveModel(modelId);
      if (!resolved.ok) return this.finish(ctx, gatewayError(404, "not_found_error", "model_not_found", resolved.message, { param: "model" }));
      ctx.provider = resolved.adapter.id;
      ctx.model = resolved.model;
      const result = await this.modelsFor(ctx, request, resolved.adapter);
      if (!result.ok) return this.finish(ctx, result.error, result.outcome);
      const wanted = resolved.model.replace(/^models\//, "");
      const model = result.models.find((candidate) => candidate.id === wanted);
      if (!model) return this.finish(ctx, gatewayError(404, "not_found_error", "model_not_found", `Model "${wanted.slice(0, 100)}" was not found.`, { param: "model" }));
      return this.finish(ctx, 200, { id: model.id, object: "model", created: 0, owned_by: OWNERS[resolved.adapter.id] ?? resolved.adapter.id });
    } catch (error) {
      this.deps.logger.error("model lookup failed", { requestId: ctx.publicId, error });
      return this.finish(ctx, gatewayError(500, "server_error", "internal_error", "Internal gateway error."), "internal_error");
    } finally {
      ctx.release();
    }
  }

  notFound(request: Request): Response {
    const path = new URL(request.url).pathname;
    return errorResponse(
      gatewayError(404, "not_found_error", "unknown_endpoint", `Unknown endpoint ${request.method} ${path.slice(0, 100)}. Supported: POST /v1/chat/completions, GET /v1/models, GET /v1/models/{model}.`),
      `req_${randomUUID().replaceAll("-", "")}`,
      this.corsHeaders(request),
    );
  }

  /** CORS preflight. Disabled unless GATEWAY_CORS_ORIGINS lists the origin (gateway keys don't belong in browsers). */
  preflight(request: Request): Response {
    const cors = this.corsHeaders(request);
    if (!cors["access-control-allow-origin"]) return new Response(null, { status: 204 });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": request.headers.get("access-control-request-headers")?.slice(0, 1024) ?? "authorization, content-type",
        "access-control-max-age": "600",
      },
    });
  }

  /* ─── shared request lifecycle ─────────────────────────────────────────── */

  private corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    const allowed = this.deps.config.corsOrigins;
    if (!origin || !(allowed.includes("*") || allowed.includes(origin))) return {};
    return {
      "access-control-allow-origin": allowed.includes("*") ? "*" : origin,
      "access-control-expose-headers": "x-request-id, retry-after, x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests",
      vary: "Origin",
    };
  }

  /** Throttle → authenticate → rate limits → concurrency. Returns a context, or the error response. */
  private async begin(request: Request, endpoint: Endpoint): Promise<RequestContext | Response> {
    const { config, authThrottle } = this.deps;
    const startedAt = this.now();
    const id = randomUUID();
    const publicId = `req_${id.replaceAll("-", "")}`;
    const cors = this.corsHeaders(request);

    const ip = clientIp(request, config.trustProxy);
    if (ip && authThrottle.isBlocked(ip, startedAt)) {
      return errorResponse(
        gatewayError(429, "rate_limit_error", "too_many_auth_failures", "Too many failed authentication attempts. Try again later.", {
          retryAfterMs: authThrottle.retryAfterMs(ip, startedAt),
        }),
        publicId,
        cors,
      );
    }

    const auth = authenticateGatewayRequest(request, this.deps.tokens);
    if (!auth.ok) {
      if (ip) authThrottle.recordFailure(ip, startedAt);
      return errorResponse(auth.error, publicId, cors);
    }
    const principal = auth.principal;

    const ctx: RequestContext = {
      id,
      publicId,
      startedAt,
      principal,
      endpoint,
      headers: { ...cors, "x-request-id": publicId },
      release: () => {},
      provider: null,
      model: null,
      stream: false,
      attempts: [],
      providerKey: null,
      usage: { prompt: null, completion: null, reasoning: null, total: null },
    };

    const rules: RateLimitRule[] = [
      { key: `token:${principal.tokenLabel}:rpm`, kind: "token_rpm", limit: config.tokenRpm, windowMs: 60_000 },
      { key: "all:rpm", kind: "total_rpm", limit: config.totalRpm, windowMs: 60_000 },
      { key: "all:day", kind: "daily_quota", limit: config.dailyRequests, windowMs: 24 * 60 * 60_000 },
    ];
    const decision = decide(await this.deps.rateLimiter.consume(rules, startedAt));
    const keyCount = decision.counts.find((count) => count.rule.kind === "token_rpm");
    if (keyCount) {
      ctx.headers["x-ratelimit-limit-requests"] = String(keyCount.rule.limit);
      ctx.headers["x-ratelimit-remaining-requests"] = String(Math.max(0, keyCount.rule.limit - keyCount.count));
      ctx.headers["x-ratelimit-reset-requests"] = `${Math.max(1, Math.ceil((keyCount.resetAt.getTime() - startedAt.getTime()) / 1000))}s`;
    }
    if (!decision.allowed && decision.violated) {
      const { rule, resetAt } = decision.violated;
      const retryAfterMs = Math.max(1_000, resetAt.getTime() - startedAt.getTime());
      const messages: Record<RateLimitRule["kind"], string> = {
        token_rpm: `This token exceeded ${rule.limit} requests per minute.`,
        total_rpm: `This deployment exceeded ${rule.limit} requests per minute.`,
        daily_quota: `This deployment reached its daily limit of ${rule.limit} requests.`,
      };
      ctx.gatewayLimitEvent = this.gatewayEvent(ctx, rule.kind, retryAfterMs);
      return this.finish(ctx, gatewayError(429, "rate_limit_error", rule.kind === "daily_quota" ? "daily_quota_exceeded" : "rate_limit_exceeded", messages[rule.kind], { retryAfterMs }));
    }

    const release = this.deps.concurrency.tryAcquire("all", config.maxConcurrency);
    if (!release) {
      ctx.gatewayLimitEvent = this.gatewayEvent(ctx, "concurrency", 1_000);
      return this.finish(
        ctx,
        gatewayError(429, "rate_limit_error", "concurrency_limit_exceeded", `Too many concurrent requests (limit ${config.maxConcurrency}).`, { retryAfterMs: 1_000 }),
      );
    }
    ctx.release = release;
    return ctx;
  }

  private gatewayEvent(ctx: RequestContext, kind: string, retryAfterMs: number): RateLimitEventEntry {
    return {
      tokenLabel: ctx.principal.tokenLabel,
      providerKeyFingerprint: null,
      source: "gateway",
      kind,
      provider: null,
      model: null,
      retryAfterMs,
      createdAt: this.now(),
    };
  }

  /** Builds the response and schedules the metadata log write. */
  private finish(ctx: RequestContext, error: GatewayError, outcome?: RequestOutcome): Response;
  private finish(ctx: RequestContext, status: 200, body: unknown): Response;
  private finish(ctx: RequestContext, errorOrStatus: GatewayError | 200, bodyOrOutcome?: unknown): Response {
    const isError = errorOrStatus !== 200;
    const response = isError
      ? errorResponse(errorOrStatus, ctx.publicId, ctx.headers)
      : jsonResponse(bodyOrOutcome, 200, { ...ctx.headers, "x-juggle-attempts": String(ctx.attempts.length) });
    const status = isError ? errorOrStatus.status : 200;
    const outcome = isError ? ((bodyOrOutcome as RequestOutcome | undefined) ?? outcomeForStatus(status)) : "success";
    this.log(ctx, status, outcome, isError ? errorOrStatus.code : null);
    return response;
  }

  private log(ctx: RequestContext, statusCode: number, outcome: RequestOutcome, errorCode: string | null, ttfbMs: number | null = null): void {
    const finishedAt = this.now();
    const entry: RequestLogEntry = {
      id: ctx.id,
      tokenLabel: ctx.principal.tokenLabel,
      providerKeyFingerprint: ctx.providerKey?.fingerprint ?? null,
      providerKeyHint: ctx.providerKey?.hint ?? ctx.attempts.at(-1)?.keyHint ?? null,
      provider: ctx.provider,
      model: ctx.model,
      endpoint: ctx.endpoint,
      stream: ctx.stream,
      statusCode,
      outcome,
      errorCode,
      attempts: ctx.attempts.length,
      latencyMs: finishedAt.getTime() - ctx.startedAt.getTime(),
      ttfbMs,
      promptTokens: ctx.usage.prompt,
      completionTokens: ctx.usage.completion,
      reasoningTokens: ctx.usage.reasoning,
      totalTokens: ctx.usage.total,
      createdAt: ctx.startedAt,
    };
    const events: RateLimitEventEntry[] = ctx.attempts
      .filter((attempt) => attempt.outcome === "rate_limited")
      .map((attempt) => ({
        tokenLabel: ctx.principal.tokenLabel,
        providerKeyFingerprint: attempt.fingerprint,
        source: "upstream",
        kind: "provider_429",
        provider: ctx.provider,
        model: ctx.model,
        retryAfterMs: attempt.cooldownMs ?? attempt.retryAfterMs ?? null,
        createdAt: finishedAt,
      }));
    if (ctx.gatewayLimitEvent) events.push(ctx.gatewayLimitEvent);

    const { requestLog, logger } = this.deps;
    this.defer(async () => {
      await requestLog.write(entry, events).catch((error: unknown) => logger.error("request log write failed", { requestId: ctx.publicId, error }));
    });
  }

  /* ─── models ────────────────────────────────────────────────────────────── */

  private async modelsFor(
    ctx: RequestContext,
    request: Request,
    adapter: ProviderAdapter,
  ): Promise<{ ok: true; models: ModelInfo[] } | { ok: false; error: GatewayError; outcome: RequestOutcome }> {
    const cacheKey = adapter.id;
    const cached = this.modelCache.get(cacheKey);
    if (cached && cached.expires > ctx.startedAt.getTime()) return { ok: true, models: cached.models };

    const result = await this.deps.router.route<ModelInfo[]>({
      adapter,
      model: null,
      signal: request.signal,
      deadline: ctx.startedAt.getTime() + Math.min(this.deps.config.requestDeadlineMs, 30_000),
      attempt: async (key, attempt) => {
        const listed = await adapter.getAvailableModels(key, { signal: attempt.signal, timeoutMs: Math.min(15_000, attempt.remainingMs) });
        return listed.ok ? { ok: true, value: listed.models } : listed;
      },
    });
    ctx.attempts.push(...result.attempts);
    if (!result.ok) return { ok: false, error: result.error, outcome: result.outcome };

    if (this.modelCache.size >= MODEL_CACHE_MAX_ENTRIES) {
      const oldest = this.modelCache.keys().next().value;
      if (oldest !== undefined) this.modelCache.delete(oldest);
    }
    this.modelCache.set(cacheKey, { expires: ctx.startedAt.getTime() + MODEL_CACHE_TTL_MS, models: result.value });
    return { ok: true, models: result.value };
  }
}
