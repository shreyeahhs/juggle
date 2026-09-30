import { bigint, boolean, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Juggle is single-tenant and configured from the environment, so the database
 * holds no secrets and no accounts: only the health of the configured keys and
 * the usage metadata behind the dashboard.
 *
 * Keys are identified by `fingerprint` (an HMAC of the secret in the
 * environment), so statistics and cooldowns survive restarts and redeploys as
 * long as the key itself stays configured.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const providerKeyStatus = pgEnum("provider_key_status", ["active", "invalid"]);

export const providerKeys = pgTable(
  "provider_keys",
  {
    /** HMAC of the configured secret. Stable across restarts; reveals nothing. */
    fingerprint: text("fingerprint").primaryKey(),
    provider: text("provider").notNull(),
    /** Label from the environment, for the dashboard. */
    label: text("label").notNull(),
    /** Display-only hint such as `AIza…8F2K`. */
    keyHint: text("key_hint").notNull(),
    status: providerKeyStatus("status").notNull().default("active"),
    /** Normalised reason for the current status, never raw provider text. */
    statusReason: text("status_reason"),
    /** Key-wide cooldown (circuit breaker, permission problems). */
    cooldownUntil: timestamptz("cooldown_until"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    successCount: bigint("success_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
    rateLimitCount: bigint("rate_limit_count", { mode: "number" }).notNull().default(0),
    lastUsedAt: timestamptz("last_used_at"),
    lastSuccessAt: timestamptz("last_success_at"),
    lastErrorAt: timestamptz("last_error_at"),
    lastErrorCode: text("last_error_code"),
    lastValidatedAt: timestamptz("last_validated_at"),
    firstSeenAt: createdAt(),
  },
  (t) => [index("provider_keys_provider_status_idx").on(t.provider, t.status)],
);

/** Per-model cooldowns: providers meter quotas per model, so a key throttled on one still serves another. */
export const providerKeyCooldowns = pgTable(
  "provider_key_cooldowns",
  {
    fingerprint: text("fingerprint")
      .notNull()
      .references(() => providerKeys.fingerprint, { onDelete: "cascade" }),
    model: text("model").notNull(),
    cooldownUntil: timestamptz("cooldown_until").notNull(),
    reason: text("reason").notNull(),
    quotaScope: text("quota_scope"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.fingerprint, t.model] })],
);

/* ────────────────────────────────────────────────────────────────────────────
 * Usage (metadata only, never prompts, responses, headers or keys)
 * ──────────────────────────────────────────────────────────────────────────── */

export const requestOutcome = pgEnum("request_outcome", [
  "success",
  "client_error",
  "rate_limited",
  "no_keys",
  "upstream_error",
  "timeout",
  "cancelled",
  "internal_error",
]);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey(),
    /** Label of the gateway token that made the request. */
    tokenLabel: text("token_label"),
    /** Fingerprint of the provider key that served it, if one was reached. */
    providerKeyFingerprint: text("provider_key_fingerprint"),
    providerKeyHint: text("provider_key_hint"),
    provider: text("provider"),
    model: text("model"),
    endpoint: text("endpoint").notNull(),
    stream: boolean("stream").notNull().default(false),
    statusCode: integer("status_code").notNull(),
    outcome: requestOutcome("outcome").notNull(),
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    ttfbMs: integer("ttfb_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index("requests_created_idx").on(t.createdAt.desc())],
);

export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerKeyFingerprint: text("provider_key_fingerprint"),
    tokenLabel: text("token_label"),
    /** 'upstream' = the provider returned 429; 'gateway' = one of our own limits tripped. */
    source: text("source").notNull(),
    kind: text("kind").notNull(),
    provider: text("provider"),
    model: text("model"),
    retryAfterMs: integer("retry_after_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("rate_limit_events_created_idx").on(t.createdAt.desc())],
);

/** Fixed-window counters for gateway rate limits, shared across instances. */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limit_counters_window_idx").on(t.windowStart)],
);
