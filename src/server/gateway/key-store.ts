import type { ProviderErrorKind, ProviderId } from "@/server/providers/types";

export type ProviderKeyStatus = "active" | "invalid";

/**
 * One configured key as the router sees it: the secret comes from the
 * environment, everything else from the health table.
 */
export interface KeyCandidate {
  /** Stable identity: HMAC of the configured secret. */
  fingerprint: string;
  label: string;
  keyHint: string;
  /** Plaintext from the environment. Never logged or persisted. */
  secret: string;
  provider: ProviderId;
  status: ProviderKeyStatus;
  quotaGroup: string | null;
  /** Key-wide cooldown (circuit breaker / permission problems). */
  cooldownUntil: Date | null;
  /** Cooldown for the requested model only, if any. */
  modelCooldownUntil: Date | null;
  consecutiveFailures: number;
  lastUsedAt: Date | null;
}

/** Everything the router wants persisted after one attempt. */
export interface KeyOutcome {
  fingerprint: string;
  at: Date;
  success: boolean;
  errorKind?: ProviderErrorKind;
  /** Increment the circuit-breaker counter (successes always reset it). */
  incrementFailures?: boolean;
  countError?: boolean;
  countRateLimit?: boolean;
  keyCooldownUntil?: Date;
  modelCooldown?: {
    model: string;
    until: Date;
    reason: string;
    quotaScope?: string;
    /** Apply the same cooldown to every key in this quota group. */
    quotaGroup: string | null;
  };
  invalidate?: { reason: string };
}

/**
 * Persistence boundary of the routing engine. The production implementation
 * joins the environment's keys with their health rows; tests use an in-memory one.
 */
export interface KeyStore {
  /** Every configured key for the provider, usable or not, so the router can explain failures. */
  listCandidates(provider: ProviderId, model: string | null): Promise<KeyCandidate[]>;
  recordOutcome(provider: ProviderId, outcome: KeyOutcome): Promise<void>;
}
