import type { Logger } from "@/server/logger";
import type { ProviderAdapter, ProviderError, ProviderErrorKind } from "@/server/providers/types";
import { gatewayError, type GatewayError, type RequestOutcome } from "./errors";
import type { KeyCandidate, KeyOutcome, KeyStore } from "./key-store";
import { breakerCooldownMs, ERROR_POLICY, rateLimitCooldownMs, transientBackoffMs, type RouterConfig } from "./policy";
import { eligibleAgainAt, isEligible, selectKey } from "./selection";

/**
 * The key-routing engine.
 *
 * Given a user, provider and model, it repeatedly selects a healthy key,
 * performs one upstream attempt through a caller-supplied function, classifies
 * the result, persists key health (cooldowns, invalidation, breaker state) and
 * decides whether to rotate, back off or stop. It never retries indefinitely:
 * attempts, transient retries and wall-clock time are all bounded.
 *
 * It knows nothing about HTTP, databases or specific providers.
 */

export type AttemptResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

export interface AttemptContext {
  signal: AbortSignal;
  /** Milliseconds left before the request's overall deadline. */
  remainingMs: number;
}

export interface AttemptRecord {
  fingerprint: string;
  keyLabel: string;
  keyHint: string;
  outcome: "success" | ProviderErrorKind;
  status: number;
  durationMs: number;
  retryAfterMs?: number;
  cooldownMs?: number;
}

export type RouteResult<T> =
  | { ok: true; value: T; key: { fingerprint: string; label: string; hint: string }; attempts: AttemptRecord[] }
  | { ok: false; error: GatewayError; outcome: RequestOutcome; attempts: AttemptRecord[] };

export interface RouteInput<T> {
  adapter: ProviderAdapter;
  /** Upstream model id, used for model-scoped cooldowns. `null` for model-agnostic operations. */
  model: string | null;
  signal: AbortSignal;
  /** Epoch ms after which no new attempt is started. */
  deadline: number;
  attempt: (plaintextKey: string, ctx: AttemptContext) => Promise<AttemptResult<T>>;
}

export interface RouterDeps {
  keyStore: KeyStore;
  config: RouterConfig;
  logger: Logger;
  now?: () => Date;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Link shown in "no keys" errors. */
  keysUrl?: string;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class KeyRouter {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly deps: RouterDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? abortableSleep;
  }

  async route<T>(input: RouteInput<T>): Promise<RouteResult<T>> {
    const { adapter, model, signal } = input;
    const { config, keyStore, logger } = this.deps;
    const attempts: AttemptRecord[] = [];

    // Local copies: outcomes are applied here immediately and persisted for other requests.
    const candidates = (await keyStore.listCandidates(adapter.id, model)).map((candidate) => ({ ...candidate }));
    if (!candidates.length) return this.fail(this.noKeysError(adapter, false), "no_keys", attempts);

    const tried = new Set<string>();
    let transientRetries = 0;
    let lastError: ProviderError | undefined;
    let lastWasTransient = false;
    let deadlineHit = false;

    // Always make at least one attempt, whatever the configuration says.
    const maxAttempts = Math.max(1, Math.floor(config.maxAttempts) || 1);
    for (let attemptNumber = 0; attemptNumber < maxAttempts; attemptNumber++) {
      if (signal.aborted) return this.cancelled(attempts);
      const now = this.now();
      const remainingMs = input.deadline - now.getTime();
      if (remainingMs <= 0) {
        deadlineHit = true;
        break;
      }

      const candidate = selectKey(candidates, { now, tried, allowRetry: lastWasTransient, random: this.random, strategy: config.selectionStrategy });
      if (!candidate) break;
      tried.add(candidate.fingerprint);

      const started = this.now().getTime();
      const result = await input.attempt(candidate.secret, { signal, remainingMs });
      const finished = this.now();
      const durationMs = finished.getTime() - started;

      if (result.ok) {
        attempts.push({ fingerprint: candidate.fingerprint, keyLabel: candidate.label, keyHint: candidate.keyHint, outcome: "success", status: 200, durationMs });
        await this.persist(adapter, { fingerprint: candidate.fingerprint, at: finished, success: true });
        return { ok: true, value: result.value, key: { fingerprint: candidate.fingerprint, label: candidate.label, hint: candidate.keyHint }, attempts };
      }

      const error = result.error;
      lastError = error;
      const record: AttemptRecord = {
        fingerprint: candidate.fingerprint,
        keyLabel: candidate.label,
        keyHint: candidate.keyHint,
        outcome: error.kind,
        status: error.status,
        durationMs,
        retryAfterMs: error.retryAfterMs,
      };
      attempts.push(record);

      if (error.kind === "cancelled" || signal.aborted) return this.cancelled(attempts);

      const policy = ERROR_POLICY[error.kind];
      const outcome = this.outcomeFor(candidate, error, finished, model, adapter);
      if (outcome.modelCooldown) record.cooldownMs = outcome.modelCooldown.until.getTime() - finished.getTime();
      else if (outcome.keyCooldownUntil) record.cooldownMs = outcome.keyCooldownUntil.getTime() - finished.getTime();
      this.applyLocally(candidates, candidate, outcome);
      await this.persist(adapter, outcome);

      logger.info("upstream attempt failed", {
        provider: adapter.id,
        model,
        // Named `keyLabel`, not `key`: a field called `key` is redacted by the logger.
        keyLabel: candidate.label,
        kind: error.kind,
        status: error.status,
        retry: policy.retry,
        cooldownMs: record.cooldownMs,
      });

      if (policy.retry === "none") return this.fail(this.passthroughError(error), this.outcomeOf(error), attempts);

      if (policy.retry === "transient") {
        transientRetries += 1;
        lastWasTransient = true;
        if (transientRetries > config.maxTransientRetries) break;
        const backoff = transientBackoffMs(transientRetries, config, this.random, error.retryAfterMs);
        if (this.now().getTime() + backoff >= input.deadline) {
          deadlineHit = true;
          break;
        }
        await this.sleep(backoff, signal);
      } else {
        lastWasTransient = false;
      }
    }

    if (signal.aborted) return this.cancelled(attempts);
    return this.exhausted(adapter, candidates, model, lastError, deadlineHit, attempts);
  }

  /* ─── outcome bookkeeping ───────────────────────────────────────────────── */

  private outcomeFor(candidate: KeyCandidate, error: ProviderError, at: Date, model: string | null, adapter: ProviderAdapter): KeyOutcome {
    const policy = ERROR_POLICY[error.kind];
    const outcome: KeyOutcome = { fingerprint: candidate.fingerprint, at, success: false, errorKind: error.kind, countError: true };

    switch (policy.keyEffect) {
      case "model_cooldown": {
        outcome.countRateLimit = true;
        outcome.countError = false;
        const until = new Date(at.getTime() + rateLimitCooldownMs(error, adapter.config, at));
        if (model) {
          outcome.modelCooldown = { model, until, reason: error.kind, quotaScope: error.quotaScope, quotaGroup: candidate.quotaGroup };
        } else {
          outcome.keyCooldownUntil = until;
        }
        break;
      }
      case "invalidate":
        outcome.invalidate = { reason: error.kind };
        break;
      case "key_cooldown":
        outcome.incrementFailures = true;
        outcome.keyCooldownUntil = new Date(at.getTime() + adapter.config.permissionDeniedCooldownMs);
        break;
      case "breaker": {
        outcome.incrementFailures = true;
        const cooldown = breakerCooldownMs(candidate.consecutiveFailures + 1, this.deps.config);
        if (cooldown !== undefined) outcome.keyCooldownUntil = new Date(at.getTime() + cooldown);
        break;
      }
      case "none":
        break;
    }
    return outcome;
  }

  private applyLocally(candidates: KeyCandidate[], candidate: KeyCandidate, outcome: KeyOutcome): void {
    if (outcome.incrementFailures) candidate.consecutiveFailures += 1;
    if (outcome.keyCooldownUntil) candidate.cooldownUntil = outcome.keyCooldownUntil;
    if (outcome.invalidate) candidate.status = "invalid";
    const cooldown = outcome.modelCooldown;
    if (cooldown) {
      for (const other of candidates) {
        const sameGroup = cooldown.quotaGroup !== null && other.quotaGroup === cooldown.quotaGroup;
        if (other.fingerprint === candidate.fingerprint || sameGroup) {
          if (!other.modelCooldownUntil || other.modelCooldownUntil < cooldown.until) other.modelCooldownUntil = cooldown.until;
        }
      }
    }
  }

  private async persist(adapter: ProviderAdapter, outcome: KeyOutcome): Promise<void> {
    try {
      await this.deps.keyStore.recordOutcome(adapter.id, outcome);
    } catch (error) {
      // Key-health bookkeeping must never fail the request.
      this.deps.logger.error("failed to persist key outcome", { fingerprint: outcome.fingerprint, error });
    }
  }

  /* ─── error summaries ───────────────────────────────────────────────────── */

  private fail<T>(error: GatewayError, outcome: RequestOutcome, attempts: AttemptRecord[]): RouteResult<T> {
    return { ok: false, error, outcome, attempts };
  }

  private cancelled<T>(attempts: AttemptRecord[]): RouteResult<T> {
    return this.fail(gatewayError(499, "invalid_request_error", "client_closed_request", "The client closed the request."), "cancelled", attempts);
  }

  private noKeysError(adapter: ProviderAdapter, hadKeys: boolean): GatewayError {
    const where = this.deps.keysUrl ? ` Manage keys at ${this.deps.keysUrl}` : "";
    return hadKeys
      ? gatewayError(400, "invalid_request_error", "no_active_provider_keys", `None of your ${adapter.displayName} keys are active (all disabled or rejected as invalid).${where}`)
      : gatewayError(400, "invalid_request_error", "no_provider_keys", `You have not added any ${adapter.displayName} keys yet.${where}`);
  }

  private passthroughError(error: ProviderError): GatewayError {
    switch (error.kind) {
      case "not_found":
        return gatewayError(404, "not_found_error", "model_not_found", error.message, { param: "model" });
      case "precondition":
        return gatewayError(400, "invalid_request_error", "provider_precondition_failed", error.message);
      default:
        return gatewayError(400, "invalid_request_error", "provider_rejected_request", error.message);
    }
  }

  private outcomeOf(error: ProviderError): RequestOutcome {
    return error.kind === "bad_request" || error.kind === "not_found" || error.kind === "precondition" ? "client_error" : "upstream_error";
  }

  private exhausted<T>(
    adapter: ProviderAdapter,
    candidates: KeyCandidate[],
    model: string | null,
    lastError: ProviderError | undefined,
    deadlineHit: boolean,
    attempts: AttemptRecord[],
  ): RouteResult<T> {
    const now = this.now();
    const active = candidates.filter((candidate) => candidate.status === "active");
    const eligibleNow = active.filter((candidate) => isEligible(candidate, now));
    const modelLabel = model ? ` for ${model}` : "";

    if (deadlineHit) {
      return this.fail(gatewayError(504, "upstream_error", "gateway_timeout", "The request exceeded the gateway's time limit."), "timeout", attempts);
    }

    if (!active.length) return this.fail(this.noKeysError(adapter, true), "no_keys", attempts);

    // Transient upstream failures dominate: more keys would not have helped.
    if (lastError && ERROR_POLICY[lastError.kind].retry === "transient") {
      const retryAfterMs = lastError.retryAfterMs;
      if (lastError.kind === "timeout") {
        return this.fail(gatewayError(504, "upstream_error", "upstream_timeout", lastError.message), "timeout", attempts);
      }
      if (lastError.kind === "overloaded") {
        return this.fail(gatewayError(503, "upstream_error", "upstream_overloaded", lastError.message, { retryAfterMs: retryAfterMs ?? 1_000 }), "upstream_error", attempts);
      }
      return this.fail(gatewayError(502, "upstream_error", "upstream_error", lastError.message), "upstream_error", attempts);
    }

    if (!eligibleNow.length) {
      const recoveries = active.map(eligibleAgainAt).filter((time): time is Date => time !== null);
      const earliest = recoveries.length ? Math.min(...recoveries.map((time) => time.getTime())) : now.getTime() + 60_000;
      const retryAfterMs = Math.max(1_000, earliest - now.getTime());
      const seconds = Math.ceil(retryAfterMs / 1000);
      return this.fail(
        gatewayError(
          429,
          "rate_limit_error",
          "all_keys_rate_limited",
          `All ${active.length} active ${adapter.displayName} key${active.length === 1 ? " is" : "s are"} rate-limited or cooling down${modelLabel}. The earliest becomes available in ~${seconds}s.`,
          { retryAfterMs },
        ),
        "rate_limited",
        attempts,
      );
    }

    // Attempt budget ran out while usable keys remained (e.g. several bad keys in a row).
    return this.fail(
      gatewayError(503, "upstream_error", "attempts_exhausted", `Gave up after ${attempts.length} attempts across your ${adapter.displayName} keys. Please retry.`, {
        retryAfterMs: 1_000,
      }),
      "upstream_error",
      attempts,
    );
  }
}
