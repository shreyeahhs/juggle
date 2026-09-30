import { scrubText } from "@/server/redact";
import type { ProviderError, UpstreamFailure } from "@/server/providers/types";
import type { GoogleRpcError } from "./api-types";

/**
 * Classifies Gemini (Google RPC style) failures into normalised provider errors.
 *
 * Google error bodies look like:
 *   { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED", "message": "...",
 *                "details": [ { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "34s" },
 *                             { "@type": "...google.rpc.QuotaFailure", "violations": [ { "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier" } ] },
 *                             { "@type": "...google.rpc.ErrorInfo", "reason": "API_KEY_INVALID" } ] } }
 */

const INVALID_KEY_REASONS = new Set([
  "API_KEY_INVALID",
  "API_KEY_EXPIRED",
  "API_KEY_SERVICE_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED",
  "API_KEY_IOS_APP_BLOCKED",
  "CONSUMER_SUSPENDED",
  "ACCESS_TOKEN_TYPE_UNSUPPORTED",
]);
const INVALID_KEY_MESSAGE = /api key (not valid|expired|was reported as leaked|is invalid)|leaked|unregistered callers|invalid api key/i;
const MAX_MESSAGE_LENGTH = 600;

interface ParsedGoogleError {
  message?: string;
  status?: string;
  reason?: string;
  retryAfterMs?: number;
  quotaScope?: "minute" | "day" | "unknown";
}

function typeOf(detail: Record<string, unknown>): string {
  return typeof detail["@type"] === "string" ? detail["@type"] : "";
}

/** Parses protobuf Duration JSON ("34s", "1.5s"). */
export function parseDurationMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return undefined;
  const ms = Math.round(Number(match[1]) * 1000);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** Retry-After header: delta-seconds or HTTP-date. */
export function parseRetryAfterHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function parseGoogleError(body: string): ParsedGoogleError {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return {};
  }
  // Streaming endpoints may wrap the error in an array.
  const root = (Array.isArray(json) ? json[0] : json) as GoogleRpcError | undefined;
  const error = root?.error;
  if (!error || typeof error !== "object") return {};

  const result: ParsedGoogleError = {
    message: typeof error.message === "string" ? error.message : undefined,
    status: typeof error.status === "string" ? error.status : undefined,
  };

  for (const detail of Array.isArray(error.details) ? error.details : []) {
    if (!detail || typeof detail !== "object") continue;
    const type = typeOf(detail);
    if (type.endsWith("google.rpc.RetryInfo")) {
      result.retryAfterMs = parseDurationMs(detail.retryDelay);
    } else if (type.endsWith("google.rpc.ErrorInfo") && typeof detail.reason === "string") {
      result.reason = detail.reason;
    } else if (type.endsWith("google.rpc.QuotaFailure") && Array.isArray(detail.violations)) {
      for (const violation of detail.violations as Array<Record<string, unknown>>) {
        const quotaId = `${violation?.quotaId ?? ""} ${violation?.quotaMetric ?? ""}`;
        if (/per\s*day|perday|daily/i.test(quotaId)) result.quotaScope = "day";
        else if (/per\s*(minute|second)|perminute|persecond/i.test(quotaId) && result.quotaScope !== "day") result.quotaScope = "minute";
      }
      result.quotaScope ??= "unknown";
    }
  }
  return result;
}

function safeMessage(message: string | undefined, secrets: readonly string[], fallback: string): string {
  if (!message) return fallback;
  const scrubbed = scrubText(message, secrets).replace(/\s+/g, " ").trim();
  return scrubbed.length > MAX_MESSAGE_LENGTH ? `${scrubbed.slice(0, MAX_MESSAGE_LENGTH)}…` : scrubbed;
}

/**
 * A mid-stream SSE event that is actually an error object rather than a chunk.
 * Returns undefined when the event is a normal chunk.
 */
export function classifyStreamErrorEvent(raw: string, secrets: readonly string[] = []): ProviderError | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const root = (Array.isArray(json) ? json[0] : json) as GoogleRpcError | undefined;
  if (!root || typeof root !== "object" || !root.error) return undefined;
  const status = typeof root.error.code === "number" ? root.error.code : 502;
  return classifyGeminiError({ type: "http", status, body: raw, headers: new Headers() }, secrets);
}

export function classifyGeminiError(failure: UpstreamFailure, secrets: readonly string[] = []): ProviderError {
  if (failure.type === "exception") {
    if (failure.cancelled) return { kind: "cancelled", status: 0, message: "The request was cancelled by the client." };
    if (failure.timedOut) return { kind: "timeout", status: 0, message: "Gemini did not respond before the timeout." };
    return { kind: "network", status: 0, message: "Could not reach Gemini (network error)." };
  }

  const { status } = failure;
  const parsed = parseGoogleError(failure.body);
  const reason = parsed.reason ?? parsed.status;
  const upstream = (fallback: string) => safeMessage(parsed.message, secrets, fallback);

  const looksLikeInvalidKey =
    (parsed.reason !== undefined && INVALID_KEY_REASONS.has(parsed.reason)) || INVALID_KEY_MESSAGE.test(parsed.message ?? "");

  if (status === 401 || ((status === 400 || status === 403) && looksLikeInvalidKey)) {
    // Provider wording is deliberately not forwarded: it can reference projects or key details.
    return { kind: "invalid_key", status, reason, message: "The provider rejected the API key." };
  }
  if (status === 403) {
    return {
      kind: "permission_denied",
      status,
      reason,
      message: "The provider denied access for this key. Check its API restrictions and that the Generative Language API is enabled for its project.",
    };
  }
  if (status === 429) {
    const retryAfterMs = parsed.retryAfterMs ?? parseRetryAfterHeader(failure.headers.get("retry-after"));
    return {
      kind: "rate_limited",
      status,
      reason,
      retryAfterMs,
      quotaScope: parsed.quotaScope ?? "unknown",
      message: "Gemini rate limit or quota reached for this key.",
    };
  }
  if (status === 400 && parsed.status === "FAILED_PRECONDITION") {
    return { kind: "precondition", status, reason, message: upstream("Gemini rejected the request (failed precondition).") };
  }
  if (status === 404) return { kind: "not_found", status, reason, message: upstream("Model or resource not found.") };
  if (status === 408) return { kind: "timeout", status, reason, message: "Gemini timed out." };
  if (status === 499) return { kind: "cancelled", status, reason, message: "The upstream request was cancelled." };
  if (status === 503) {
    return { kind: "overloaded", status, reason, retryAfterMs: parseRetryAfterHeader(failure.headers.get("retry-after")), message: upstream("Gemini is temporarily unavailable.") };
  }
  if (status === 504) return { kind: "timeout", status, reason, message: upstream("Gemini deadline exceeded.") };
  if (status >= 500) return { kind: "upstream_error", status, reason, message: upstream(`Gemini returned an error (${status}).`) };
  return { kind: "bad_request", status, reason, message: upstream(`Gemini rejected the request (${status}).`) };
}
