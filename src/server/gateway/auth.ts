import { type ConfiguredGatewayToken, matchGatewayToken } from "@/server/keys/env-keys";
import { gatewayError, type GatewayError } from "./errors";

/**
 * Gateway authentication.
 *
 * Tokens come from the environment, so there is no database lookup on the hot
 * path and nothing to revoke at runtime: rotating a token means changing
 * GATEWAY_API_KEYS and redeploying.
 */

export interface GatewayPrincipal {
  /** Label of the matched token, recorded with the request. */
  tokenLabel: string;
}

export type AuthResult = { ok: true; principal: GatewayPrincipal } | { ok: false; error: GatewayError };

const HOW_TO = "Send your gateway token as 'Authorization: Bearer <token>'.";

/** Accepts `Authorization: Bearer <token>` (OpenAI SDKs) or `x-api-key`. Cookies are never consulted. */
export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
    return match?.[1] ?? null;
  }
  const apiKey = request.headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

export function authenticateGatewayRequest(request: Request, tokens: readonly ConfiguredGatewayToken[]): AuthResult {
  const supplied = extractBearerToken(request);
  if (!supplied) {
    return { ok: false, error: gatewayError(401, "authentication_error", "missing_api_key", `Missing API key. ${HOW_TO}`) };
  }
  if (!tokens.length) {
    return {
      ok: false,
      error: gatewayError(503, "server_error", "no_tokens_configured", "This deployment has no gateway tokens configured. Set GATEWAY_API_KEYS."),
    };
  }

  const matched = matchGatewayToken(tokens, supplied);
  if (!matched) {
    // A provider key sent here by mistake is a common slip; say so without echoing it.
    const hint = supplied.startsWith("AIza") || supplied.startsWith("AQ.") ? " That looks like a provider key, not a gateway token." : "";
    return { ok: false, error: gatewayError(401, "authentication_error", "invalid_api_key", `Invalid API key.${hint} ${HOW_TO}`) };
  }
  return { ok: true, principal: { tokenLabel: matched.label } };
}
