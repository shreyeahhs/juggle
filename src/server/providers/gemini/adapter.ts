import type { ChatRequest } from "@/server/ai/chat-schema";
import type { ModelInfo } from "@/server/ai/types";
import {
  MODEL_NAME_PATTERN,
  type CallContext,
  type KeyValidationResult,
  type ModelListResult,
  type PreparedRequest,
  type PrepareResult,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderError,
  type ProviderResult,
  type ProviderStreamEvent,
  type UpstreamFailure,
} from "@/server/providers/types";
import { parseSseStream } from "@/server/providers/sse";
import type { GeminiRequestBody, GeminiResponse } from "./api-types";
import { classifyGeminiError, classifyStreamErrorEvent } from "./errors";
import { createChunkTranslator, fromGeminiResponse, toGeminiRequest, TranslationError } from "./translate";

/** Thrown inside a response stream when the upstream fails after headers were sent. */
export class StreamFailure extends Error {
  override name = "StreamFailure";
  constructor(readonly providerError: ProviderError) {
    super(providerError.message);
  }
}

export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const MAX_ERROR_BODY_BYTES = 64 * 1024;

export const GEMINI_DEFAULT_CONFIG: ProviderConfig = {
  defaultRateLimitCooldownMs: 30 * 60_000,
  minuteRateLimitCooldownMs: 60_000,
  permissionDeniedCooldownMs: 15 * 60_000,
  // Gemini per-day quotas reset at midnight Pacific time.
  dailyQuotaResetTimeZone: "America/Los_Angeles",
  maxCooldownMs: 26 * 60 * 60_000,
};

export interface GeminiAdapterOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  config?: Partial<ProviderConfig>;
}

type UpstreamCall =
  | { ok: true; response: Response; finish: () => void; timedOut: () => boolean }
  | { ok: false; failure: UpstreamFailure };

/** Reads at most `limit` bytes of a body as text; never throws. */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    // Partial bodies are fine for classification.
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit));
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini" as const;
  readonly displayName = "Google Gemini";
  readonly config: ProviderConfig;
  readonly keyInput = {
    label: "Gemini API key",
    placeholder: "Paste your Google AI Studio API key",
    minLength: 20,
    maxLength: 512,
    consoleUrl: "https://aistudio.google.com/app/apikey",
    quotaNote:
      "Gemini rate limits apply per Google Cloud project, not per key. Keys from the same project share one quota, so give them the same quota group so a rate limit on one cools down all of them.",
  };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.config = { ...GEMINI_DEFAULT_CONFIG, ...options.config };
  }

  supportsModel(model: string): boolean {
    return /^(models\/)?(gemini|gemma|learnlm)-/i.test(model);
  }

  prepareRequest(request: ChatRequest, model: string): PrepareResult {
    const upstreamModel = model.replace(/^models\//, "");
    if (!MODEL_NAME_PATTERN.test(upstreamModel)) {
      return { ok: false, code: "invalid_request", param: "model", message: `Invalid model name "${model.slice(0, 64)}".` };
    }
    let body: GeminiRequestBody;
    try {
      body = toGeminiRequest(request);
    } catch (error) {
      if (error instanceof TranslationError) return { ok: false, code: error.code, param: error.param, message: error.message };
      throw error;
    }
    return {
      ok: true,
      prepared: {
        provider: this.id,
        model: upstreamModel,
        requestedModel: request.model,
        stream: request.stream,
        includeUsage: request.stream_options?.include_usage ?? false,
        body,
      },
    };
  }

  classifyError(failure: UpstreamFailure, secrets: readonly string[] = []): ProviderError {
    return classifyGeminiError(failure, secrets);
  }

  async validateKey(key: string, ctx: CallContext): Promise<KeyValidationResult> {
    // models.list authenticates the key without spending generation quota.
    const call = await this.call(key, "/v1beta/models?pageSize=1", { method: "GET" }, ctx);
    if (call.ok) {
      call.finish();
      await call.response.body?.cancel().catch(() => {});
      return { ok: true };
    }
    const error = this.classifyError(call.failure, [key]);
    switch (error.kind) {
      case "rate_limited":
        // Authenticated fine, just throttled right now.
        return { ok: true, note: "rate_limited" };
      case "invalid_key":
        return { ok: false, reason: "invalid_key", message: "Invalid API key." };
      case "permission_denied":
        return { ok: false, reason: "permission_denied", message: error.message };
      case "timeout":
      case "network":
      case "overloaded":
      case "upstream_error":
        return { ok: false, reason: "unreachable", message: "Could not reach Google Gemini to validate the key. Try again shortly." };
      default:
        return { ok: false, reason: "unknown", message: "The key could not be validated." };
    }
  }

  async sendRequest(key: string, request: PreparedRequest, ctx: CallContext): Promise<ProviderResult> {
    return request.stream ? this.streamRequest(key, request, ctx) : this.completeRequest(key, request, ctx);
  }

  /**
   * Streaming. The returned promise resolves only once upstream headers have
   * arrived, so a rate limit or rejected key is still classified and retried
   * normally. After the first byte the request is committed to this key.
   */
  private async streamRequest(key: string, request: PreparedRequest, ctx: CallContext): Promise<ProviderResult> {
    const path = `/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    const call = await this.call(key, path, { method: "POST", body: JSON.stringify(request.body), accept: "text/event-stream" }, ctx);
    if (!call.ok) return { ok: false, error: this.classifyError(call.failure, [key]) };

    if (!call.response.body) {
      call.finish();
      return { ok: false, error: { kind: "upstream_error", status: call.response.status, message: "Gemini returned an empty stream." } };
    }

    // Headers are in: stop the attempt timeout and switch to an idle timeout between chunks.
    call.finish();
    const events = parseSseStream(call.response.body);
    const translator = createChunkTranslator(request.requestedModel, { includeUsage: request.includeUsage });
    const idleTimeoutMs = ctx.streamIdleTimeoutMs ?? 60_000;
    const classify = (error: unknown, timedOut: boolean) => this.classifyError(this.exceptionFailure(error, ctx, timedOut), [key]);

    const stream = new ReadableStream<ProviderStreamEvent>({
      async start(controller) {
        const reader = events.getReader();
        const abort = () => reader.cancel("client aborted").catch(() => {});
        ctx.signal.addEventListener("abort", abort, { once: true });
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          for (;;) {
            const next = await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) => {
                idleTimer = setTimeout(() => reject(new StreamFailure({ kind: "timeout", status: 0, message: "Gemini stopped sending data." })), idleTimeoutMs);
                idleTimer.unref?.();
              }),
            ]);
            clearTimeout(idleTimer);
            if (next.done) break;
            if (!next.value.trim()) continue;

            // Gemini reports mid-stream failures as an error object in the event data.
            const asError = next.value.includes('"error"') ? classifyStreamErrorEvent(next.value, [key]) : undefined;
            if (asError) throw new StreamFailure(asError);

            let parsed: GeminiResponse;
            try {
              parsed = JSON.parse(next.value) as GeminiResponse;
            } catch {
              throw new StreamFailure({ kind: "upstream_error", status: 502, message: "Gemini sent a malformed stream event." });
            }
            for (const chunk of translator.push(parsed)) controller.enqueue({ type: "chunk", chunk });
          }
          for (const chunk of translator.finish()) controller.enqueue({ type: "chunk", chunk });
        } catch (error) {
          const providerError =
            error instanceof StreamFailure
              ? error.providerError
              : ctx.signal.aborted
                ? ({ kind: "cancelled", status: 0, message: "The client closed the request." } satisfies ProviderError)
                : classify(error, false);
          controller.enqueue({ type: "error", error: providerError });
        } finally {
          clearTimeout(idleTimer);
          ctx.signal.removeEventListener("abort", abort);
          reader.cancel().catch(() => {});
          controller.close();
        }
      },
    });

    return { ok: true, kind: "stream", stream };
  }

  private async completeRequest(key: string, request: PreparedRequest, ctx: CallContext): Promise<ProviderResult> {
    const path = `/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
    const call = await this.call(key, path, { method: "POST", body: JSON.stringify(request.body) }, ctx);
    if (!call.ok) return { ok: false, error: this.classifyError(call.failure, [key]) };

    try {
      const text = await call.response.text();
      let json: GeminiResponse;
      try {
        json = JSON.parse(text) as GeminiResponse;
      } catch {
        return { ok: false, error: { kind: "upstream_error", status: call.response.status, message: "Gemini returned a malformed response." } };
      }
      return { ok: true, kind: "completion", completion: fromGeminiResponse(json, request.requestedModel) };
    } catch (error) {
      return { ok: false, error: this.classifyError(this.exceptionFailure(error, ctx, call.timedOut()), [key]) };
    } finally {
      call.finish();
    }
  }

  async getAvailableModels(key: string, ctx: CallContext): Promise<ModelListResult> {
    const call = await this.call(key, "/v1beta/models?pageSize=1000", { method: "GET" }, ctx);
    if (!call.ok) return { ok: false, error: this.classifyError(call.failure, [key]) };
    try {
      const json = (await call.response.json()) as {
        models?: Array<{
          name?: string;
          baseModelId?: string;
          displayName?: string;
          inputTokenLimit?: number;
          outputTokenLimit?: number;
          supportedGenerationMethods?: string[];
        }>;
      };
      const models: ModelInfo[] = [];
      for (const model of json.models ?? []) {
        if (!model.supportedGenerationMethods?.includes("generateContent")) continue;
        const id = (model.name ?? "").replace(/^models\//, "");
        if (!MODEL_NAME_PATTERN.test(id)) continue;
        models.push({
          id,
          provider: this.id,
          displayName: model.displayName,
          inputTokenLimit: model.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit,
        });
      }
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: this.classifyError(this.exceptionFailure(error, ctx, call.timedOut()), [key]) };
    } finally {
      call.finish();
    }
  }

  /* ─── transport ─────────────────────────────────────────────────────────── */

  private exceptionFailure(error: unknown, ctx: CallContext, timedOut = false): UpstreamFailure {
    return { type: "exception", error, cancelled: ctx.signal.aborted, timedOut: timedOut && !ctx.signal.aborted };
  }

  /**
   * Performs one upstream call. The timeout covers everything until `finish()`
   * is called, so non-streaming callers keep it running while reading the body.
   * The API key travels only in the `x-goog-api-key` header, never in the URL.
   */
  private async call(key: string, path: string, init: { method: string; body?: string; accept?: string }, ctx: CallContext): Promise<UpstreamCall> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), ctx.timeoutMs);
    const finish = () => clearTimeout(timer);
    const signal = AbortSignal.any([ctx.signal, timeout.signal]);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        body: init.body,
        signal,
        redirect: "error",
        headers: {
          "x-goog-api-key": key,
          accept: init.accept ?? "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch (error) {
      finish();
      return { ok: false, failure: this.exceptionFailure(error, ctx, timeout.signal.aborted) };
    }

    if (!response.ok) {
      const body = await readCapped(response, MAX_ERROR_BODY_BYTES);
      finish();
      if (timeout.signal.aborted || ctx.signal.aborted) {
        return { ok: false, failure: this.exceptionFailure(new Error("aborted"), ctx, timeout.signal.aborted) };
      }
      return { ok: false, failure: { type: "http", status: response.status, body, headers: response.headers } };
    }
    return { ok: true, response, finish, timedOut: () => timeout.signal.aborted };
  }
}
