import { lt, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";

/* ────────────────────────────────────────────────────────────────────────────
 * Fixed-window rate limits (shared across instances via Postgres)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RateLimitRule {
  /** Counter identity, e.g. `u:<userId>:rpm`. */
  key: string;
  kind: "token_rpm" | "total_rpm" | "daily_quota";
  limit: number;
  windowMs: number;
}

export interface RateLimitCount {
  rule: RateLimitRule;
  count: number;
  resetAt: Date;
}

export interface RateLimiter {
  /** Counts one hit against every rule atomically and returns the new counts. */
  consume(rules: readonly RateLimitRule[], now: Date): Promise<RateLimitCount[]>;
}

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export interface RateLimitDecision {
  allowed: boolean;
  /** The violated rule with the latest reset, when denied. */
  violated?: RateLimitCount;
  counts: RateLimitCount[];
}

export function decide(counts: RateLimitCount[]): RateLimitDecision {
  const violations = counts.filter((count) => count.count > count.rule.limit);
  if (!violations.length) return { allowed: true, counts };
  const violated = violations.reduce((a, b) => (a.resetAt >= b.resetAt ? a : b));
  return { allowed: false, violated, counts };
}

export class PostgresRateLimiter implements RateLimiter {
  private lastPrune = 0;

  constructor(private readonly db: Database) {}

  async consume(rules: readonly RateLimitRule[], now: Date): Promise<RateLimitCount[]> {
    if (!rules.length) return [];
    const values = rules.map((rule) => ({ key: rule.key, windowStart: windowStart(now, rule.windowMs), count: 1 }));
    const rows = await this.db
      .insert(rateLimitCounters)
      .values(values)
      .onConflictDoUpdate({
        target: [rateLimitCounters.key, rateLimitCounters.windowStart],
        set: { count: sql`${rateLimitCounters.count} + 1` },
      })
      .returning({ key: rateLimitCounters.key, count: rateLimitCounters.count });

    this.maybePrune(now);
    return rules.map((rule) => ({
      rule,
      count: rows.find((row) => row.key === rule.key)?.count ?? 1,
      resetAt: new Date(windowStart(now, rule.windowMs).getTime() + rule.windowMs),
    }));
  }

  /** Opportunistic cleanup of old windows, at most once per 10 minutes per instance. */
  private maybePrune(now: Date): void {
    if (now.getTime() - this.lastPrune < 10 * 60_000) return;
    this.lastPrune = now.getTime();
    const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    this.db
      .delete(rateLimitCounters)
      .where(lt(rateLimitCounters.windowStart, cutoff))
      .catch(() => {});
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  async consume(rules: readonly RateLimitRule[], now: Date): Promise<RateLimitCount[]> {
    return rules.map((rule) => {
      const start = windowStart(now, rule.windowMs);
      const id = `${rule.key}@${start.getTime()}`;
      const count = (this.counts.get(id) ?? 0) + 1;
      this.counts.set(id, count);
      return { rule, count, resetAt: new Date(start.getTime() + rule.windowMs) };
    });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-user concurrency (per instance)
 * ──────────────────────────────────────────────────────────────────────────── */

export class ConcurrencyLimiter {
  private readonly inFlight = new Map<string, number>();

  /** Returns a release function, or null when the limit is reached. Release is idempotent. */
  tryAcquire(key: string, max: number): (() => void) | null {
    const current = this.inFlight.get(key) ?? 0;
    if (current >= max) return null;
    this.inFlight.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.inFlight.get(key) ?? 1) - 1;
      if (remaining <= 0) this.inFlight.delete(key);
      else this.inFlight.set(key, remaining);
    };
  }

  current(key: string): number {
    return this.inFlight.get(key) ?? 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Failed-authentication throttle per client IP (per instance, bounded memory)
 * ──────────────────────────────────────────────────────────────────────────── */

export class AuthFailureThrottle {
  private readonly windows = new Map<string, { start: number; failures: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs = 60_000,
    private readonly maxEntries = 50_000,
  ) {}

  isBlocked(ip: string, now: Date): boolean {
    const entry = this.windows.get(ip);
    if (!entry) return false;
    if (now.getTime() - entry.start >= this.windowMs) {
      this.windows.delete(ip);
      return false;
    }
    return entry.failures >= this.maxFailures;
  }

  retryAfterMs(ip: string, now: Date): number {
    const entry = this.windows.get(ip);
    return entry ? Math.max(1_000, entry.start + this.windowMs - now.getTime()) : 1_000;
  }

  recordFailure(ip: string, now: Date): void {
    const entry = this.windows.get(ip);
    if (!entry || now.getTime() - entry.start >= this.windowMs) {
      if (this.windows.size >= this.maxEntries) {
        // Evict the oldest entry (Map preserves insertion order).
        const oldest = this.windows.keys().next().value;
        if (oldest !== undefined) this.windows.delete(oldest);
      }
      this.windows.set(ip, { start: now.getTime(), failures: 1 });
      return;
    }
    entry.failures += 1;
  }
}

/**
 * Client IP. Forwarded headers are only trusted when TRUST_PROXY is set
 * (platform proxies overwrite them). Returns null when the IP can't be known,
 * callers then skip IP-based throttling rather than lumping every client into
 * one shared bucket (which would let one attacker lock everyone out).
 */
export function clientIp(request: Request, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : null;
}
