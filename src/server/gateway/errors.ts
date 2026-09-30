/**
 * Gateway error model. Responses use OpenAI's error envelope so SDK error
 * handling (types, codes, automatic retries on 429/5xx) works unchanged:
 *   { "error": { "message", "type", "code", "param", "request_id" } }
 */

export type GatewayErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "upstream_error"
  | "server_error";

/** Mirrors the `request_outcome` database enum. */
export type RequestOutcome =
  | "success"
  | "client_error"
  | "rate_limited"
  | "no_keys"
  | "upstream_error"
  | "timeout"
  | "cancelled"
  | "internal_error";

export interface GatewayError {
  status: number;
  type: GatewayErrorType;
  code: string;
  message: string;
  param?: string | null;
  /** Sent as `Retry-After` (rounded up to whole seconds). */
  retryAfterMs?: number;
}

export function gatewayError(status: number, type: GatewayErrorType, code: string, message: string, extra: Partial<GatewayError> = {}): GatewayError {
  return { status, type, code, message, ...extra };
}

export function errorResponse(error: GatewayError, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": requestId,
    ...extraHeaders,
  };
  if (error.retryAfterMs !== undefined) headers["retry-after"] = String(Math.max(1, Math.ceil(error.retryAfterMs / 1000)));
  return new Response(
    JSON.stringify({
      error: { message: error.message, type: error.type, code: error.code, param: error.param ?? null, request_id: requestId },
    }),
    { status: error.status, headers },
  );
}

export function outcomeForStatus(status: number): RequestOutcome {
  if (status < 400) return "success";
  if (status === 429) return "rate_limited";
  if (status === 499) return "cancelled";
  if (status === 504) return "timeout";
  if (status >= 500) return "upstream_error";
  return "client_error";
}
