import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { providerKeyCooldowns, providerKeys } from "@/server/db/schema";
import type { ConfiguredProviderKey } from "@/server/keys/env-keys";
import type { ProviderId } from "@/server/providers/types";
import type { KeyCandidate, KeyOutcome, KeyStore } from "./key-store";

/**
 * Key store for environment-configured keys.
 *
 * The environment decides which keys exist; the database only remembers how
 * they have been behaving. A key added to the environment starts healthy, and
 * one removed from it simply stops appearing (its history stays until pruned).
 */
export class EnvKeyStore implements KeyStore {
  /** Fingerprints whose health row has been created in this process. */
  private readonly ensured = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly keys: readonly ConfiguredProviderKey[],
  ) {}

  configuredFor(provider: ProviderId): ConfiguredProviderKey[] {
    return this.keys.filter((key) => key.provider === provider);
  }

  async listCandidates(provider: ProviderId, model: string | null): Promise<KeyCandidate[]> {
    const configured = this.configuredFor(provider);
    if (!configured.length) return [];

    await this.ensureRows(configured);
    const fingerprints = configured.map((key) => key.fingerprint);

    const health = await this.db
      .select({
        fingerprint: providerKeys.fingerprint,
        status: providerKeys.status,
        cooldownUntil: providerKeys.cooldownUntil,
        consecutiveFailures: providerKeys.consecutiveFailures,
        lastUsedAt: providerKeys.lastUsedAt,
      })
      .from(providerKeys)
      .where(inArray(providerKeys.fingerprint, fingerprints));

    const modelCooldowns = model
      ? await this.db
          .select({ fingerprint: providerKeyCooldowns.fingerprint, until: providerKeyCooldowns.cooldownUntil })
          .from(providerKeyCooldowns)
          .where(and(inArray(providerKeyCooldowns.fingerprint, fingerprints), eq(providerKeyCooldowns.model, model)))
      : [];

    return configured.map((key) => {
      const row = health.find((item) => item.fingerprint === key.fingerprint);
      return {
        fingerprint: key.fingerprint,
        label: key.label,
        keyHint: key.hint,
        secret: key.secret,
        provider,
        quotaGroup: key.quotaGroup,
        status: row?.status ?? "active",
        cooldownUntil: row?.cooldownUntil ?? null,
        modelCooldownUntil: modelCooldowns.find((item) => item.fingerprint === key.fingerprint)?.until ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        lastUsedAt: row?.lastUsedAt ?? null,
      };
    });
  }

  async recordOutcome(provider: ProviderId, outcome: KeyOutcome): Promise<void> {
    const target = eq(providerKeys.fingerprint, outcome.fingerprint);

    if (outcome.success) {
      await this.db
        .update(providerKeys)
        .set({
          requestCount: sql`${providerKeys.requestCount} + 1`,
          successCount: sql`${providerKeys.successCount} + 1`,
          consecutiveFailures: 0,
          cooldownUntil: null,
          status: "active",
          statusReason: null,
          lastUsedAt: outcome.at,
          lastSuccessAt: outcome.at,
        })
        .where(target);
      return;
    }

    const set: Record<string, unknown> = {
      requestCount: sql`${providerKeys.requestCount} + 1`,
      lastUsedAt: outcome.at,
      lastErrorAt: outcome.at,
      lastErrorCode: outcome.errorKind ?? "unknown",
    };
    if (outcome.countError) set.errorCount = sql`${providerKeys.errorCount} + 1`;
    if (outcome.countRateLimit) set.rateLimitCount = sql`${providerKeys.rateLimitCount} + 1`;
    if (outcome.incrementFailures) set.consecutiveFailures = sql`${providerKeys.consecutiveFailures} + 1`;
    if (outcome.keyCooldownUntil) {
      set.cooldownUntil = sql`GREATEST(COALESCE(${providerKeys.cooldownUntil}, ${outcome.keyCooldownUntil}), ${outcome.keyCooldownUntil})`;
    }
    if (outcome.invalidate) {
      set.status = "invalid";
      set.statusReason = outcome.invalidate.reason;
    }
    await this.db.update(providerKeys).set(set).where(target);

    const cooldown = outcome.modelCooldown;
    if (!cooldown) return;

    // Keys that share a quota group are exhausted together, so cool them together.
    const group = cooldown.quotaGroup
      ? this.configuredFor(provider)
          .filter((key) => key.quotaGroup === cooldown.quotaGroup)
          .map((key) => key.fingerprint)
      : [];
    const affected = [...new Set([outcome.fingerprint, ...group])];

    await this.db
      .insert(providerKeyCooldowns)
      .values(
        affected.map((fingerprint) => ({
          fingerprint,
          model: cooldown.model,
          cooldownUntil: cooldown.until,
          reason: cooldown.reason,
          quotaScope: cooldown.quotaScope ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [providerKeyCooldowns.fingerprint, providerKeyCooldowns.model],
        set: {
          cooldownUntil: sql`GREATEST(${providerKeyCooldowns.cooldownUntil}, excluded.cooldown_until)`,
          reason: sql`excluded.reason`,
          quotaScope: sql`excluded.quota_scope`,
        },
      });
  }

  /** Creates the health row for a newly configured key, once per process. */
  private async ensureRows(configured: readonly ConfiguredProviderKey[]): Promise<void> {
    const missing = configured.filter((key) => !this.ensured.has(key.fingerprint));
    if (!missing.length) return;

    await this.db
      .insert(providerKeys)
      .values(missing.map((key) => ({ fingerprint: key.fingerprint, provider: key.provider, label: key.label, keyHint: key.hint })))
      // The label can change in the environment; the health columns must not be reset.
      .onConflictDoUpdate({ target: providerKeys.fingerprint, set: { label: sql`excluded.label`, keyHint: sql`excluded.key_hint` } });

    for (const key of missing) this.ensured.add(key.fingerprint);
  }

  /** Clears an invalid marking and cooldowns after the owner re-tests a key. */
  async markHealthy(fingerprint: string, at: Date): Promise<void> {
    await this.db
      .update(providerKeys)
      .set({ status: "active", statusReason: null, consecutiveFailures: 0, cooldownUntil: null, lastValidatedAt: at })
      .where(eq(providerKeys.fingerprint, fingerprint));
  }

  async markInvalid(fingerprint: string, reason: string, at: Date): Promise<void> {
    await this.db.update(providerKeys).set({ status: "invalid", statusReason: reason, lastValidatedAt: at }).where(eq(providerKeys.fingerprint, fingerprint));
  }

  /** Active per-model cooldowns, for the dashboard. */
  async activeCooldowns(now: Date) {
    return this.db
      .select({ fingerprint: providerKeyCooldowns.fingerprint, model: providerKeyCooldowns.model, until: providerKeyCooldowns.cooldownUntil, reason: providerKeyCooldowns.reason })
      .from(providerKeyCooldowns)
      .where(gt(providerKeyCooldowns.cooldownUntil, now));
  }
}
