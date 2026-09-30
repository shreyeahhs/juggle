import type { KeyCandidate, KeyOutcome, KeyStore, ProviderKeyStatus } from "@/server/gateway/key-store";
import type { ProviderId } from "@/server/providers/types";

export interface MemoryKey {
  fingerprint: string;
  label: string;
  keyHint: string;
  /** Plaintext, exactly as the environment would supply it. */
  secret: string;
  provider: ProviderId;
  status: ProviderKeyStatus;
  statusReason: string | null;
  quotaGroup: string | null;
  cooldownUntil: Date | null;
  consecutiveFailures: number;
  lastUsedAt: Date | null;
  requestCount: number;
  successCount: number;
  errorCount: number;
  rateLimitCount: number;
}

/** Reference implementation of KeyStore used by router unit tests. */
export class InMemoryKeyStore implements KeyStore {
  readonly keys = new Map<string, MemoryKey>();
  readonly modelCooldowns = new Map<string, { until: Date; reason: string }>();
  readonly outcomes: KeyOutcome[] = [];

  add(key: Partial<MemoryKey> & { fingerprint: string }): MemoryKey {
    const full: MemoryKey = {
      provider: "gemini",
      label: key.fingerprint,
      keyHint: `…${key.fingerprint.slice(-4)}`,
      secret: `secret-${key.fingerprint}`,
      status: "active",
      statusReason: null,
      quotaGroup: null,
      cooldownUntil: null,
      consecutiveFailures: 0,
      lastUsedAt: null,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      ...key,
    };
    this.keys.set(full.fingerprint, full);
    return full;
  }

  setModelCooldown(fingerprint: string, model: string, until: Date): void {
    this.modelCooldowns.set(`${fingerprint}::${model}`, { until, reason: "rate_limited" });
  }

  modelCooldown(fingerprint: string, model: string): Date | null {
    return this.modelCooldowns.get(`${fingerprint}::${model}`)?.until ?? null;
  }

  async listCandidates(provider: ProviderId, model: string | null): Promise<KeyCandidate[]> {
    return [...this.keys.values()]
      .filter((key) => key.provider === provider)
      .map((key) => ({
        fingerprint: key.fingerprint,
        label: key.label,
        keyHint: key.keyHint,
        secret: key.secret,
        provider,
        status: key.status,
        quotaGroup: key.quotaGroup,
        cooldownUntil: key.cooldownUntil,
        modelCooldownUntil: model ? this.modelCooldown(key.fingerprint, model) : null,
        consecutiveFailures: key.consecutiveFailures,
        lastUsedAt: key.lastUsedAt,
      }));
  }

  async recordOutcome(provider: ProviderId, outcome: KeyOutcome): Promise<void> {
    this.outcomes.push(outcome);
    const key = this.keys.get(outcome.fingerprint);
    if (!key) return;
    key.requestCount += 1;
    key.lastUsedAt = outcome.at;
    if (outcome.success) {
      key.successCount += 1;
      key.consecutiveFailures = 0;
      return;
    }
    if (outcome.countError) key.errorCount += 1;
    if (outcome.countRateLimit) key.rateLimitCount += 1;
    if (outcome.incrementFailures) key.consecutiveFailures += 1;
    if (outcome.keyCooldownUntil && (!key.cooldownUntil || key.cooldownUntil < outcome.keyCooldownUntil)) key.cooldownUntil = outcome.keyCooldownUntil;
    if (outcome.invalidate) {
      key.status = "invalid";
      key.statusReason = outcome.invalidate.reason;
    }
    const cooldown = outcome.modelCooldown;
    if (!cooldown) return;
    for (const other of this.keys.values()) {
      const member = other.fingerprint === key.fingerprint || (cooldown.quotaGroup !== null && other.quotaGroup === cooldown.quotaGroup && other.provider === provider);
      if (!member) continue;
      const existing = this.modelCooldown(other.fingerprint, cooldown.model);
      if (!existing || existing < cooldown.until) this.setModelCooldown(other.fingerprint, cooldown.model, cooldown.until);
    }
  }
}
