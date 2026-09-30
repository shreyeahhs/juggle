import { z } from "zod";

/**
 * Environment configuration, validated once and cached.
 *
 * Juggle is single-tenant: one owner, configured entirely through environment
 * variables. Provider keys and gateway tokens live here rather than in the
 * database, so a deployment has no secret at rest to protect and can be
 * redeployed from nothing but its environment.
 *
 * Nothing is read at import time: `next build` imports route modules without a
 * runtime environment, so validation happens on first use.
 */

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // ── Core ────────────────────────────────────────────────────────────────
    APP_URL: z.url().default("http://localhost:3000"),
    /** Unset in development → embedded PGlite database in ./.data. Required in production. */
    DATABASE_URL: z.string().optional(),
    DATABASE_POOL_MAX: positiveInt(10),
    /** Signs the dashboard session cookie and derives key fingerprints. */
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    /** Password for the dashboard. The only account this deployment has. */
    OWNER_PASSWORD: z.string().min(8, "OWNER_PASSWORD must be at least 8 characters"),
    SESSION_MAX_AGE_DAYS: positiveInt(30),

    // ── Keys ────────────────────────────────────────────────────────────────
    /**
     * Provider keys, comma-separated. Each entry is `key` or `name=key`:
     *   GEMINI_API_KEYS="AIza...1,spare=AIza...2"
     */
    GEMINI_API_KEYS: csv,
    /** Set when every Gemini key belongs to one Google Cloud project, so they share a quota. */
    GEMINI_QUOTA_GROUP: z.string().trim().max(64).optional(),
    /**
     * Tokens your applications authenticate with, comma-separated, `token` or
     * `name=token`. Generate them with `pnpm secrets:generate`.
     */
    GATEWAY_API_KEYS: csv,

    // ── Gateway behaviour ───────────────────────────────────────────────────
    GATEWAY_KEY_STRATEGY: z.enum(["round_robin", "power_of_two"]).default("round_robin"),
    GATEWAY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    GATEWAY_MAX_TRANSIENT_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    GATEWAY_UPSTREAM_TIMEOUT_MS: positiveInt(120_000),
    GATEWAY_STREAM_IDLE_TIMEOUT_MS: positiveInt(60_000),
    GATEWAY_REQUEST_DEADLINE_MS: positiveInt(300_000),
    GATEWAY_MAX_BODY_BYTES: positiveInt(4 * 1024 * 1024),

    // ── Abuse prevention ────────────────────────────────────────────────────
    GATEWAY_TOKEN_RPM: positiveInt(120),
    GATEWAY_TOTAL_RPM: positiveInt(300),
    GATEWAY_DAILY_REQUESTS: positiveInt(20_000),
    GATEWAY_MAX_CONCURRENCY: positiveInt(20),
    GATEWAY_AUTH_FAILURES_PER_MINUTE: positiveInt(30),
    GATEWAY_CORS_ORIGINS: csv,

    // ── Providers ───────────────────────────────────────────────────────────
    GEMINI_BASE_URL: z.url().default("https://generativelanguage.googleapis.com"),
    GEMINI_DEFAULT_COOLDOWN_SECONDS: positiveInt(30 * 60),

    // ── Operations ──────────────────────────────────────────────────────────
    REQUEST_LOG_RETENTION_DAYS: positiveInt(30),
    TRUST_PROXY: z.stringbool().default(false),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "test") return;
    if (!env.GATEWAY_API_KEYS.length) {
      ctx.addIssue({ code: "custom", path: ["GATEWAY_API_KEYS"], message: "At least one gateway token is required (run `pnpm secrets:generate`)" });
    }
    if (env.NODE_ENV !== "production") return;
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "DATABASE_URL is required in production" });
    }
    if (!env.APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "APP_URL must use https:// in production" });
    }
    for (const [name, value] of [
      ["AUTH_SECRET", env.AUTH_SECRET],
      ["OWNER_PASSWORD", env.OWNER_PASSWORD],
    ] as const) {
      if (/change-?me|example|placeholder|password/i.test(value)) {
        ctx.addIssue({ code: "custom", path: [name], message: `${name} still looks like a placeholder` });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validates an environment-shaped record, applying defaults. Throws with a readable summary. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Only variable names and messages are printed, never values.
    const problems = parsed.error.issues.map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: drop the cached value after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
