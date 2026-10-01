import { and, desc, gte, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { providerKeyCooldowns, providerKeys, rateLimitEvents, requests } from "@/server/db/schema";
import type { ConfiguredProviderKey } from "@/server/keys/env-keys";

/** Dashboard data. Single-tenant, so nothing here is scoped to an account. */

export interface OverviewStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsToday: number;
  tokensToday: number;
  avgLatencyMs: number | null;
  rateLimitEvents24h: number;
}

export interface UsagePoint {
  bucket: Date;
  total: number;
  success: number;
  failed: number;
  rateLimited: number;
  avgLatencyMs: number | null;
  tokens: number;
}

export interface RecentRequest {
  id: string;
  createdAt: Date;
  tokenLabel: string | null;
  provider: string | null;
  model: string | null;
  endpoint: string;
  stream: boolean;
  statusCode: number;
  outcome: string;
  errorCode: string | null;
  latencyMs: number;
  attempts: number;
  providerKeyHint: string | null;
  totalTokens: number | null;
}

export type KeyHealth = "healthy" | "cooling_down" | "rate_limited" | "degraded" | "invalid";

/** A configured key joined with its recorded performance. */
export interface KeyPerformance {
  fingerprint: string;
  label: string;
  keyHint: string;
  provider: string;
  quotaGroup: string | null;
  health: KeyHealth;
  status: string;
  statusReason: string | null;
  cooldownUntil: Date | null;
  modelCooldowns: Array<{ model: string; until: Date; reason: string }>;
  consecutiveFailures: number;
  requestCount: number;
  successCount: number;
  errorCount: number;
  rateLimitCount: number;
  lastUsedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  /** Share of all requests this key served, 0 to 1. */
  share: number;
}

export type UsageRange = "24h" | "7d" | "30d";

const RANGES: Record<UsageRange, { since: number; bucket: "hour" | "day" }> = {
  "24h": { since: 24 * 3600_000, bucket: "hour" },
  "7d": { since: 7 * 86_400_000, bucket: "day" },
  "30d": { since: 30 * 86_400_000, bucket: "day" },
};

const int = (value: unknown): number => Number(value ?? 0);

export class StatsService {
  constructor(private readonly db: Database) {}

  async overview(now = new Date()): Promise<OverviewStats> {
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dayAgo = new Date(now.getTime() - 86_400_000);

    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)`,
        success: sql<number>`count(*) filter (where ${requests.outcome} = 'success')`,
        failed: sql<number>`count(*) filter (where ${requests.outcome} <> 'success')`,
        // The comparisons go through gte() rather than interpolating the Date
        // directly: a bare value in a sql`` template becomes an untyped param
        // that reaches the driver as a Date object, and postgres-js only
        // recognises one via `instanceof Date`. Under a bundler that gives the
        // driver a different realm's Date, that check fails and the query dies
        // on an unserialisable param. gte() attaches the column's encoder,
        // which converts to an ISO string before the driver ever sees it.
        today: sql<number>`count(*) filter (where ${gte(requests.createdAt, startOfDay)})`,
        tokensToday: sql<number>`coalesce(sum(${requests.totalTokens}) filter (where ${gte(requests.createdAt, startOfDay)}), 0)`,
        avgLatency: sql<number | null>`avg(${requests.latencyMs}) filter (where ${gte(requests.createdAt, dayAgo)})`,
      })
      .from(requests);

    const [limits] = await this.db.select({ total: sql<number>`count(*)` }).from(rateLimitEvents).where(gte(rateLimitEvents.createdAt, dayAgo));

    return {
      totalRequests: int(totals?.total),
      successfulRequests: int(totals?.success),
      failedRequests: int(totals?.failed),
      requestsToday: int(totals?.today),
      tokensToday: int(totals?.tokensToday),
      avgLatencyMs: totals?.avgLatency == null ? null : Math.round(Number(totals.avgLatency)),
      rateLimitEvents24h: int(limits?.total),
    };
  }

  async usage(range: UsageRange = "24h", now = new Date()): Promise<UsagePoint[]> {
    const { since, bucket } = RANGES[range];
    const from = new Date(now.getTime() - since);
    const rows = await this.db
      .select({
        bucket: sql<Date>`date_trunc(${bucket}, ${requests.createdAt})`.as("bucket"),
        total: sql<number>`count(*)`,
        success: sql<number>`count(*) filter (where ${requests.outcome} = 'success')`,
        failed: sql<number>`count(*) filter (where ${requests.outcome} <> 'success')`,
        rateLimited: sql<number>`count(*) filter (where ${requests.outcome} = 'rate_limited')`,
        avgLatency: sql<number | null>`avg(${requests.latencyMs})`,
        tokens: sql<number>`coalesce(sum(${requests.totalTokens}), 0)`,
      })
      .from(requests)
      .where(gte(requests.createdAt, from))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const points = rows.map((row) => ({
      bucket: new Date(row.bucket),
      total: int(row.total),
      success: int(row.success),
      failed: int(row.failed),
      rateLimited: int(row.rateLimited),
      avgLatencyMs: row.avgLatency == null ? null : Math.round(Number(row.avgLatency)),
      tokens: int(row.tokens),
    }));
    return fillBuckets(points, from, now, bucket);
  }

  async recent(limit = 25): Promise<RecentRequest[]> {
    return this.db
      .select({
        id: requests.id,
        createdAt: requests.createdAt,
        tokenLabel: requests.tokenLabel,
        provider: requests.provider,
        model: requests.model,
        endpoint: requests.endpoint,
        stream: requests.stream,
        statusCode: requests.statusCode,
        outcome: requests.outcome,
        errorCode: requests.errorCode,
        latencyMs: requests.latencyMs,
        attempts: requests.attempts,
        providerKeyHint: requests.providerKeyHint,
        totalTokens: requests.totalTokens,
      })
      .from(requests)
      .orderBy(desc(requests.createdAt))
      .limit(Math.min(limit, 200));
  }

  /**
   * Performance of every configured key. The environment is the source of truth
   * for which keys exist; the database only supplies their recorded behaviour,
   * so a key added to the environment shows up immediately with zeroed counts.
   */
  async keyPerformance(configured: readonly ConfiguredProviderKey[], now = new Date()): Promise<KeyPerformance[]> {
    if (!configured.length) return [];

    const [health, cooldowns] = await Promise.all([
      this.db.select().from(providerKeys),
      this.db
        .select({
          fingerprint: providerKeyCooldowns.fingerprint,
          model: providerKeyCooldowns.model,
          until: providerKeyCooldowns.cooldownUntil,
          reason: providerKeyCooldowns.reason,
        })
        .from(providerKeyCooldowns)
        .where(gte(providerKeyCooldowns.cooldownUntil, now)),
    ]);

    const totalRequests = health.reduce((sum, row) => sum + Number(row.requestCount ?? 0), 0);

    return configured.map((key) => {
      const row = health.find((item) => item.fingerprint === key.fingerprint);
      const modelCooldowns = cooldowns
        .filter((cooldown) => cooldown.fingerprint === key.fingerprint)
        .map(({ model, until, reason }) => ({ model, until, reason }));
      const keyCooling = row?.cooldownUntil != null && row.cooldownUntil > now;

      let health_: KeyHealth = "healthy";
      if (row?.status === "invalid") health_ = "invalid";
      else if (keyCooling) health_ = "cooling_down";
      else if (modelCooldowns.length) health_ = "rate_limited";
      else if ((row?.consecutiveFailures ?? 0) > 0) health_ = "degraded";

      const requestCount = Number(row?.requestCount ?? 0);
      return {
        fingerprint: key.fingerprint,
        label: key.label,
        keyHint: key.hint,
        provider: key.provider,
        quotaGroup: key.quotaGroup,
        health: health_,
        status: row?.status ?? "active",
        statusReason: row?.statusReason ?? null,
        cooldownUntil: keyCooling ? row!.cooldownUntil : null,
        modelCooldowns,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
        requestCount,
        successCount: Number(row?.successCount ?? 0),
        errorCount: Number(row?.errorCount ?? 0),
        rateLimitCount: Number(row?.rateLimitCount ?? 0),
        lastUsedAt: row?.lastUsedAt ?? null,
        lastSuccessAt: row?.lastSuccessAt ?? null,
        lastErrorAt: row?.lastErrorAt ?? null,
        lastErrorCode: row?.lastErrorCode ?? null,
        share: totalRequests ? requestCount / totalRequests : 0,
      };
    });
  }

  /** Recent rate-limit events, for the dashboard. */
  async recentRateLimits(limit = 10) {
    return this.db
      .select({
        id: rateLimitEvents.id,
        createdAt: rateLimitEvents.createdAt,
        source: rateLimitEvents.source,
        kind: rateLimitEvents.kind,
        model: rateLimitEvents.model,
        retryAfterMs: rateLimitEvents.retryAfterMs,
        tokenLabel: rateLimitEvents.tokenLabel,
      })
      .from(rateLimitEvents)
      .orderBy(desc(rateLimitEvents.createdAt))
      .limit(limit);
  }

  /** Rough health signal for the last hour, derived from request outcomes. */
  async systemHealth(now = new Date()) {
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)`,
        failures: sql<number>`count(*) filter (where ${requests.outcome} in ('upstream_error', 'timeout', 'internal_error'))`,
      })
      .from(requests)
      .where(and(gte(requests.createdAt, hourAgo)));

    const total = int(row?.total);
    const failures = int(row?.failures);
    const failureRate = total ? failures / total : 0;
    return {
      total,
      failures,
      failureRate,
      status: total === 0 ? ("idle" as const) : failureRate > 0.25 ? ("degraded" as const) : failureRate > 0.05 ? ("watch" as const) : ("healthy" as const),
    };
  }
}

/** Inserts empty buckets so charts show gaps as zero rather than skipping time. */
function fillBuckets(points: UsagePoint[], from: Date, to: Date, bucket: "hour" | "day"): UsagePoint[] {
  const step = bucket === "hour" ? 3600_000 : 86_400_000;
  const truncate = (time: number) => Math.floor(time / step) * step;
  const byBucket = new Map(points.map((point) => [truncate(point.bucket.getTime()), point]));
  const filled: UsagePoint[] = [];
  for (let time = truncate(from.getTime()); time <= truncate(to.getTime()); time += step) {
    filled.push(byBucket.get(time) ?? { bucket: new Date(time), total: 0, success: 0, failed: 0, rateLimited: 0, avgLatencyMs: null, tokens: 0 });
  }
  return filled;
}
