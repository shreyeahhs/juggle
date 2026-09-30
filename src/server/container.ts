import { getDbHandle, type Database } from "@/server/db/client";
import { getEnv, type Env } from "@/server/env";
import { EnvKeyStore } from "@/server/gateway/env-key-store";
import { Gateway, type GatewayConfig } from "@/server/gateway/handler";
import { AuthFailureThrottle, ConcurrencyLimiter, PostgresRateLimiter } from "@/server/gateway/limits";
import { DEFAULT_ROUTER_CONFIG, type RouterConfig } from "@/server/gateway/policy";
import { DrizzleRequestLogSink } from "@/server/gateway/request-log";
import { KeyRouter } from "@/server/gateway/router";
import { parseGatewayTokens, parseProviderKeys, type ConfiguredGatewayToken, type ConfiguredProviderKey } from "@/server/keys/env-keys";
import { createLogger, logger as defaultLogger, type Logger } from "@/server/logger";
import { GeminiAdapter } from "@/server/providers/gemini/adapter";
import { ProviderRegistry } from "@/server/providers/registry";
import { StatsService } from "@/server/services/stats";

/**
 * Composition root. One place wires the whole server from the environment, so
 * tests can build the same object graph with a test database and a fake upstream.
 */

export interface AppConfig {
  appUrl: string;
  gateway: GatewayConfig;
  router: RouterConfig;
  geminiBaseUrl: string;
  geminiDefaultCooldownMs: number;
  requestLogRetentionDays: number;
  authFailuresPerMinute: number;
  /** Provider keys and gateway tokens, already parsed from the environment. */
  providerKeys: ConfiguredProviderKey[];
  gatewayTokens: ConfiguredGatewayToken[];
}

export function configFromEnv(env: Env = getEnv()): AppConfig {
  return {
    appUrl: env.APP_URL.replace(/\/+$/, ""),
    gateway: {
      maxBodyBytes: env.GATEWAY_MAX_BODY_BYTES,
      upstreamTimeoutMs: env.GATEWAY_UPSTREAM_TIMEOUT_MS,
      streamIdleTimeoutMs: env.GATEWAY_STREAM_IDLE_TIMEOUT_MS,
      requestDeadlineMs: env.GATEWAY_REQUEST_DEADLINE_MS,
      tokenRpm: env.GATEWAY_TOKEN_RPM,
      totalRpm: env.GATEWAY_TOTAL_RPM,
      dailyRequests: env.GATEWAY_DAILY_REQUESTS,
      maxConcurrency: env.GATEWAY_MAX_CONCURRENCY,
      corsOrigins: env.GATEWAY_CORS_ORIGINS,
      trustProxy: env.TRUST_PROXY,
    },
    router: {
      ...DEFAULT_ROUTER_CONFIG,
      selectionStrategy: env.GATEWAY_KEY_STRATEGY,
      maxAttempts: env.GATEWAY_MAX_ATTEMPTS,
      maxTransientRetries: env.GATEWAY_MAX_TRANSIENT_RETRIES,
    },
    geminiBaseUrl: env.GEMINI_BASE_URL,
    geminiDefaultCooldownMs: env.GEMINI_DEFAULT_COOLDOWN_SECONDS * 1000,
    requestLogRetentionDays: env.REQUEST_LOG_RETENTION_DAYS,
    authFailuresPerMinute: env.GATEWAY_AUTH_FAILURES_PER_MINUTE,
    providerKeys: parseProviderKeys(env.GEMINI_API_KEYS, {
      provider: "gemini",
      authSecret: env.AUTH_SECRET,
      quotaGroup: env.GEMINI_QUOTA_GROUP ?? null,
    }),
    gatewayTokens: parseGatewayTokens(env.GATEWAY_API_KEYS, env.AUTH_SECRET),
  };
}

export interface Services {
  db: Database;
  config: AppConfig;
  logger: Logger;
  registry: ProviderRegistry;
  keyStore: EnvKeyStore;
  router: KeyRouter;
  gateway: Gateway;
  stats: StatsService;
}

export interface CreateServicesInput {
  db: Database;
  config: AppConfig;
  logger?: Logger;
  /** Replaces the upstream transport (tests). */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  defer?: (task: () => Promise<unknown>) => void;
}

export function createServices(input: CreateServicesInput): Services {
  const { db, config } = input;
  const logger = input.logger ?? defaultLogger;

  const registry = new ProviderRegistry([
    new GeminiAdapter({
      baseUrl: config.geminiBaseUrl,
      fetch: input.fetchImpl,
      config: { defaultRateLimitCooldownMs: config.geminiDefaultCooldownMs },
    }),
  ]);

  const keyStore = new EnvKeyStore(db, config.providerKeys);
  const router = new KeyRouter({ keyStore, config: config.router, logger, now: input.now, keysUrl: `${config.appUrl}/dashboard/keys` });

  const gateway = new Gateway({
    config: config.gateway,
    registry,
    router,
    tokens: config.gatewayTokens,
    rateLimiter: new PostgresRateLimiter(db),
    concurrency: new ConcurrencyLimiter(),
    authThrottle: new AuthFailureThrottle(config.authFailuresPerMinute),
    requestLog: new DrizzleRequestLogSink(db),
    logger,
    now: input.now,
    defer: input.defer,
  });

  return { db, config, logger, registry, keyStore, router, gateway, stats: new StatsService(db) };
}

const globalForServices = globalThis as unknown as { __juggleServices?: Services };

/**
 * Process-wide singleton used by the app.
 *
 * Only cached in production: a cached graph survives hot reloads, so edits to a
 * service would silently have no effect in development.
 */
export function getServices(): Services {
  const env = getEnv();
  const build = () => createServices({ db: getDbHandle().db, config: configFromEnv(env), logger: createLogger({ level: env.LOG_LEVEL }) });
  if (env.NODE_ENV !== "production") return build();
  globalForServices.__juggleServices ??= build();
  return globalForServices.__juggleServices;
}
