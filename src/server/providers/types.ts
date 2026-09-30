import type { ChatRequest } from "@/server/ai/chat-schema";
import type { ChatCompletion, ChatCompletionChunk, ModelInfo } from "@/server/ai/types";

export const PROVIDER_IDS = ["gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Normalised upstream failure categories. The router's retry/cooldown policy
 * is keyed on these, so adapters never make routing decisions themselves.
 */
export type ProviderErrorKind =
  // key-scoped: another key may succeed
  | "rate_limited"
  | "invalid_key"
  | "permission_denied"
  // transient: the same or another key may succeed shortly
  | "overloaded"
  | "upstream_error"
  | "timeout"
  | "network"
  // caller's problem: retrying cannot help
  | "bad_request"
  | "not_found"
  | "precondition"
  // the client went away
  | "cancelled";

export interface ProviderError {
  kind: ProviderErrorKind;
  /** Upstream HTTP status, 0 when no response was received. */
  status: number;
  /** Already scrubbed of secrets; safe to return to the API caller. */
  message: string;
  /** Upstream-requested wait (Retry-After / google.rpc.RetryInfo), in ms. */
  retryAfterMs?: number;
  /** For rate limits: which quota window was exhausted, when the provider says. */
  quotaScope?: "minute" | "day" | "unknown";
  /** Normalised upstream reason code for diagnostics (e.g. `API_KEY_INVALID`). Never free text. */
  reason?: string;
}

export type UpstreamFailure =
  | { type: "http"; status: number; body: string; headers: Headers }
  | { type: "exception"; error: unknown; timedOut: boolean; cancelled: boolean };

export interface CallContext {
  /** Aborted when the API client disconnects or the overall deadline passes. */
  signal: AbortSignal;
  /** Budget for this attempt until upstream response headers arrive. */
  timeoutMs: number;
  /** Streaming only: maximum silence between upstream chunks. */
  streamIdleTimeoutMs?: number;
}

/** A request already translated for the provider, produced once per API call. */
export interface PreparedRequest {
  provider: ProviderId;
  /** Upstream model id, e.g. `gemini-3.8-flash`. */
  model: string;
  /** Model name as the caller wrote it, echoed back in responses. */
  requestedModel: string;
  stream: boolean;
  includeUsage: boolean;
  /** Provider-specific payload; opaque to the gateway. */
  body: unknown;
}

export type PrepareResult =
  | { ok: true; prepared: PreparedRequest }
  | { ok: false; message: string; param?: string; code: "unsupported_parameter" | "invalid_request" };

/**
 * Streams carry failures as an event rather than erroring the stream: erroring
 * a ReadableStream discards everything already queued, which would throw away
 * content the caller had already been sent.
 */
export type ProviderStreamEvent = { type: "chunk"; chunk: ChatCompletionChunk } | { type: "error"; error: ProviderError };

export type ProviderResult =
  | { ok: true; kind: "completion"; completion: ChatCompletion }
  | { ok: true; kind: "stream"; stream: ReadableStream<ProviderStreamEvent> }
  | { ok: false; error: ProviderError };

export type KeyValidationResult =
  | { ok: true; note?: "rate_limited" }
  | { ok: false; reason: "invalid_key" | "permission_denied" | "unreachable" | "unknown"; message: string };

export type ModelListResult = { ok: true; models: ModelInfo[] } | { ok: false; error: ProviderError };

export interface ProviderConfig {
  /** Cooldown for a 429 with no provider hint about when to retry. */
  defaultRateLimitCooldownMs: number;
  /** Cooldown for a 429 known to be a per-minute (or per-second) limit without an explicit delay. */
  minuteRateLimitCooldownMs: number;
  /** Key-wide cooldown after a permission error (403). */
  permissionDeniedCooldownMs: number;
  /** IANA time zone in which per-day quotas reset at midnight, when known. */
  dailyQuotaResetTimeZone?: string;
  /** Upper bound applied to any provider-supplied retry delay. */
  maxCooldownMs: number;
}

export interface KeyInputSpec {
  label: string;
  placeholder: string;
  minLength: number;
  maxLength: number;
  /** Where users create keys for this provider. */
  consoleUrl: string;
  /** Short note shown next to the key-pool UI (e.g. quota-sharing caveats). */
  quotaNote?: string;
}

/**
 * Contract every provider implements. Adapters are stateless apart from
 * configuration and receive `fetch` through their constructor so tests can
 * substitute a fake upstream.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly config: ProviderConfig;
  readonly keyInput: KeyInputSpec;

  /** True if an un-prefixed model name belongs to this provider (e.g. `gemini-*`). */
  supportsModel(model: string): boolean;

  /** Translate + validate once, before any key is chosen. */
  prepareRequest(request: ChatRequest, model: string): PrepareResult;

  validateKey(key: string, ctx: CallContext): Promise<KeyValidationResult>;

  sendRequest(key: string, request: PreparedRequest, ctx: CallContext): Promise<ProviderResult>;

  classifyError(failure: UpstreamFailure, secrets?: readonly string[]): ProviderError;

  getAvailableModels(key: string, ctx: CallContext): Promise<ModelListResult>;
}

/** Model names end up in upstream URL paths: allow a conservative charset only. */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
