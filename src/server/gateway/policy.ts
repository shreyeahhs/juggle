import type { ProviderConfig, ProviderError, ProviderErrorKind } from "@/server/providers/types";
import type { SelectionStrategy } from "./selection";

/**
 * Retry and key-health policy per normalised error kind. Kept as data so the
 * behaviour is reviewable in one place and testable in isolation.
 *
 *  retry
 *    rotate    -> try a different key immediately (the key is the problem)
 *    transient -> retry with backoff, preferring another key (bounded separately)
 *    none      -> return the error to the caller; retrying cannot help
 *  keyEffect
 *    model_cooldown  -> key (and its quota group) cools down for this model only
 *    invalidate      -> key marked invalid until the user re-tests it
 *    key_cooldown    -> whole key cools down (permission problems)
 *    breaker         -> counts toward the consecutive-failure circuit breaker
 *    none            -> key health unaffected (not the key's fault)
 */
export interface ErrorPolicy {
  retry: "rotate" | "transient" | "none";
  keyEffect: "model_cooldown" | "invalidate" | "key_cooldown" | "breaker" | "none";
}

export const ERROR_POLICY: Readonly<Record<ProviderErrorKind, ErrorPolicy>> = {
  rate_limited: { retry: "rotate", keyEffect: "model_cooldown" },
  invalid_key: { retry: "rotate", keyEffect: "invalidate" },
  permission_denied: { retry: "rotate", keyEffect: "key_cooldown" },
  // Provider-wide capacity signal: not held against the key.
  overloaded: { retry: "transient", keyEffect: "none" },
  upstream_error: { retry: "transient", keyEffect: "breaker" },
  timeout: { retry: "transient", keyEffect: "breaker" },
  network: { retry: "transient", keyEffect: "breaker" },
  bad_request: { retry: "none", keyEffect: "none" },
  not_found: { retry: "none", keyEffect: "none" },
  precondition: { retry: "none", keyEffect: "none" },
  cancelled: { retry: "none", keyEffect: "none" },
};

export interface RouterConfig {
  /** How keys are cycled through. See `SelectionStrategy`. */
  selectionStrategy: SelectionStrategy;
  /** Hard cap on upstream attempts per API request, across all keys. */
  maxAttempts: number;
  /** Cap on retries caused by transient errors (5xx, timeouts, network). */
  maxTransientRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Consecutive key-attributable failures before the breaker opens. */
  breakerThreshold: number;
  breakerBaseMs: number;
  breakerMaxMs: number;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  // Spread every request across the pool rather than draining one key first.
  selectionStrategy: "round_robin",
  maxAttempts: 5,
  maxTransientRetries: 2,
  backoffBaseMs: 250,
  backoffMaxMs: 2_000,
  breakerThreshold: 3,
  breakerBaseMs: 30_000,
  breakerMaxMs: 10 * 60_000,
};

const MIN_COOLDOWN_MS = 1_000;

/** Milliseconds until the next local midnight in `timeZone` (plus a small safety margin). */
export function msUntilNextMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + now.getUTCMilliseconds();
  // DST-transition days are off by at most an hour; the margin absorbs clock skew.
  return 24 * 60 * 60_000 - elapsed + 60_000;
}

/**
 * When a rate-limited key may be used again for the model:
 *   per-day quota        → next quota reset (provider's reset time zone)
 *   provider retry hint  → honoured (Retry-After / RetryInfo)
 *   per-minute quota     → provider's per-minute cooldown
 *   unknown              → provider's default cooldown (configurable)
 */
export function rateLimitCooldownMs(error: ProviderError, config: ProviderConfig, now: Date): number {
  let ms: number;
  if (error.quotaScope === "day" && config.dailyQuotaResetTimeZone) {
    ms = Math.max(msUntilNextMidnight(now, config.dailyQuotaResetTimeZone), error.retryAfterMs ?? 0);
  } else if (error.retryAfterMs !== undefined) {
    ms = error.retryAfterMs;
  } else if (error.quotaScope === "minute") {
    ms = config.minuteRateLimitCooldownMs;
  } else {
    ms = config.defaultRateLimitCooldownMs;
  }
  return Math.min(Math.max(ms, MIN_COOLDOWN_MS), config.maxCooldownMs);
}

/** Exponential breaker cooldown once `failures` reaches the threshold; undefined while closed. */
export function breakerCooldownMs(failures: number, config: RouterConfig): number | undefined {
  if (failures < config.breakerThreshold) return undefined;
  const exponent = Math.min(failures - config.breakerThreshold, 16);
  return Math.min(config.breakerMaxMs, config.breakerBaseMs * 2 ** exponent);
}

/** Jittered exponential backoff for transient retries (retry #1, #2, …). */
export function transientBackoffMs(retry: number, config: RouterConfig, random: () => number, hintMs?: number): number {
  const ceiling = Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** Math.max(0, retry - 1));
  const jittered = ceiling / 2 + random() * (ceiling / 2);
  return hintMs !== undefined && hintMs <= config.backoffMaxMs ? Math.max(jittered, hintMs) : jittered;
}
