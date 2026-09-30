# Juggle: architecture and implementation plan

> Juggle is a self-hosted, open-source **Bring-Your-Own-Key (BYOK) AI gateway**.
> Provider keys go in the deployment's environment; applications call a single
> OpenAI-compatible endpoint with a gateway token. Juggle cycles through the
> keys, forwards each request, and handles rate limits, cooldowns, retries and
> failover, without ever exposing the provider keys.
>
> **Single-tenant by design.** One deployment belongs to one person: no sign-up,
> no accounts, no multi-tenancy. Configuration is entirely environment
> variables, which is what makes a one-click Vercel deploy practical and leaves
> no secret at rest in the database.

This document is the design of record. It was written before the code and is
updated as decisions change. Section numbers match the planning checklist:

1. [Repository state](#1-repository-state)
2. [Provider research findings](#2-provider-research-findings-gemini-september-2026)
3. [Architecture](#3-architecture)
4. [Security risks & mitigations](#4-security-risks--mitigations)
5. [Database schema](#5-database-schema)
6. [API routes](#6-api-routes)
7. [Provider abstraction](#7-provider-abstraction)
8. [Key-routing algorithm](#8-key-routing-algorithm)
9. [Authentication model](#9-authentication-model)
10. [Deployment architecture](#10-deployment-architecture)
11. [Phased implementation plan](#11-phased-implementation-plan)

---

## 1. Repository state

The repository started empty (greenfield). Local toolchain: Node 22, pnpm 10,
PostgreSQL 17/18 available as local services, no Docker. Consequences:

- Tests run against **PGlite** (real Postgres compiled to WASM, in-process), so
  the full test suite needs no database server and no credentials.
- Local development can also run on PGlite (`DATABASE_URL` unset → embedded
  database in `.data/`), so `pnpm install && pnpm dev` works with zero setup.
  Production always uses a real PostgreSQL server.

**PGlite is single-process.** Two processes opening the same data directory do
not error; they diverge silently and lose writes. `createPgliteHandle` therefore
takes an advisory lock (`.data/pglite/juggle.lock`) and fails with an explanation
instead, so running a CLI script against the embedded database while the dev
server is up is a clear error rather than mysterious missing rows. Point
`DATABASE_URL` at a real PostgreSQL server if you need both at once.

## 2. Provider research findings (Gemini, September 2026)

These were verified against the official Gemini API documentation before any
design decision. They materially change the design compared to a naive
"rotate keys on a timer" proxy.

| Finding | Source | Design consequence |
|---|---|---|
| **Rate limits apply per Google Cloud project, not per API key.** | Gemini rate-limits docs | Two keys from the same project share one quota. Rotating between them wastes attempts. Keys get an optional **quota group** (e.g. the GCP project); a 429 on one key cools down its whole group. The UI and docs explain this prominently. |
| Quotas are tracked **per model** (`quotaDimensions.model`) and by window (per-minute, per-day). Daily quotas reset at **midnight Pacific time**. | 429 error bodies (`google.rpc.QuotaFailure`) | Cooldowns are scoped to **(key, model)**, not the whole key. A key exhausted on `gemini-pro-latest` still serves `gemini-3.8-flash`. Per-day quota exhaustion cools down until the next Pacific midnight instead of a blind 30 minutes. |
| 429 responses carry `google.rpc.RetryInfo.retryDelay` (e.g. `"34s"`). | Error bodies | Respected as the cooldown when present (the provider equivalent of `Retry-After`). |
| `generateContent` is labelled "legacy" but Google's docs explicitly say the new Interactions API is **Beta** and recommend `generateContent` for stable production. | Interactions API note | The Gemini adapter uses `v1beta/models/{model}:generateContent` and `:streamGenerateContent?alt=sse`. |
| API keys are sent in the `x-goog-api-key` header. | API-key docs | Keys never go in URLs (query-string keys end up in proxy/access logs). |
| New keys are **authorization keys** bound to a service account; standard keys are rejected from September 2026. Key format is not documented. | API-key docs | No `AIza…` prefix validation. Keys are validated by a live call only. Display hints use first-4/last-4 characters, not a known prefix. |
| Gemini 3 function calls include an `id` and **require the thought signature to be sent back** on function-calling turns. | Function-calling / thinking docs | Tool-call IDs map 1:1. Thought signatures round-trip via `tool_calls[].extra_content.google.thought_signature` (the same convention as Google's own OpenAI-compat layer). |
| `FunctionDeclaration.parametersJsonSchema` accepts full JSON Schema; `GenerationConfig.responseJsonSchema` likewise. | API reference | OpenAI tool/response schemas pass through with light normalisation instead of a lossy OpenAPI-subset converter. |
| Gemini offers its own OpenAI-compatible endpoint (`/v1beta/openai/`), in beta. | OpenAI-compat docs | Not used as the upstream. Native `generateContent` gives structured error details (`RetryInfo`, `QuotaFailure`) that the router depends on. Juggle does the translation itself. |

## 3. Architecture

### 3.1 Shape

One deployable Next.js application with three clearly separated layers:

```text
                         ┌──────────────────────────────────────────────────────┐
  Browser (dashboard) ──►│  UI layer       Next.js App Router, Server            │
   signed cookie         │                 Components, Server Actions            │
                         ├──────────────────────────────────────────────────────┤
  Your app ────────────► │  Gateway layer  /v1/*  (framework-agnostic core:      │
   Bearer <token>        │                 Web Request → Web Response)           │
                         │   auth → limits → validate → ROUTER → respond → log   │
                         ├──────────────────────────────────────────────────────┤
                         │  Domain layer   provider adapters, key store, stats   │
                         └───────┬──────────────────┬───────────────────┬────────┘
                                 │                  │                   │
                          Environment          PostgreSQL         Provider APIs
                        (keys and tokens)  (stats, cooldowns)    (Gemini, later more)
```

- **Gateway core is framework-agnostic.** `src/server/gateway/handler.ts` takes a
  standard `Request` and returns a standard `Response`. Next.js route handlers
  are thin adapters. The gateway can later be served by a standalone Node/Hono
  process without rewriting it, if latency or scaling needs demand it.
- **The router is a pure module** (`src/server/gateway/router.ts`). It depends
  only on interfaces (`KeyStore`, `ProviderAdapter`, `Clock`, `decrypt`). Unit
  tests drive it with an in-memory key store and fake adapters.
- **Stateless app instances.** Everything that must be shared (cooldowns, key
  health, rate-limit counters, sessions) lives in Postgres. Per-instance state
  is limited to the concurrency semaphore and short-lived caches, and is
  documented as such.

### 3.2 Technology choices

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 6 | Single deployable; RSC keeps secrets server-side; runs on Vercel / Docker / VPS. TS 6 rather than 7 because typescript-eslint doesn't support 7 yet. |
| Styling | Tailwind CSS 4 + shadcn/ui-style primitives (Radix) | Accessible primitives; our own design tokens; not a stock admin theme. |
| Validation | Zod 4 | One schema for runtime validation and types; used on every boundary. |
| Database | PostgreSQL + Drizzle ORM | SQL-first, lightweight, no query engine binary, same schema on PGlite for tests. |
| Auth | One password from the environment, signed cookie | A single-owner deployment does not need accounts, a user table or an auth library. Roughly 60 lines instead of a dependency. |
| Tests | Vitest + PGlite + injected fake `fetch` | No real keys and no network in tests. |

### 3.3 Request lifecycle (gateway)

```text
POST /v1/chat/completions
  1  size & content-type guard ........ 413 / 415 (streamed body read with hard cap)
  2  IP auth-failure throttle ......... 429 (brute-force protection on gateway keys)
  3  gateway-key auth ................. 401 (checksum → SHA-256 → indexed lookup;
                                             revoked / expired / suspended user → 401/403)
  4  limits ........................... 429 (per-key RPM, per-user RPM, daily quota,
                                             per-user concurrency)
  5  parse + Zod validate ............. 400 (param path in error)
  6  resolve provider + model ......... 400/404 (strict model-name charset: no path injection)
  7  ROUTER: select key → call → classify → cooldown/rotate/retry (bounded)
  8  respond (JSON, or SSE streamed without buffering)
  9  log metadata only (never prompt/response/headers/keys); release semaphore
```

## 4. Security risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| S1 | **Provider-key disclosure** (database dump, logs, API responses, error messages) | Keys exist only in the deployment's environment, and in memory for one upstream call. The database stores a keyed HMAC fingerprint and a display hint, so a dump, a backup or a leaked connection string contains no key material. The logger redacts credential-shaped strings, and upstream error text is scrubbed before reaching clients or logs. |
| S2 | Gateway-token theft or guessing | Tokens are environment configuration, compared in constant time, never persisted. Generated tokens carry a CRC32 checksum, so typos are rejected without work and secret scanners can spot a leak. Failed authentications are throttled per client address. |
| S3 | **Open proxy / SSRF** | Upstream hosts are hard-coded in adapters. Model names must match a strict pattern before entering a URL path. The gateway never fetches a user-supplied URL. |
| S4 | Abuse and cost amplification | Per-token and deployment-wide requests per minute, a daily cap, a concurrency limit, a body-size cap, per-attempt and overall deadlines, and bounded retries. |
| S5 | Unauthorised dashboard access | One owner password from the environment, compared in constant time, with throttled attempts. The session is a signed, http-only cookie holding only an expiry, so there is no session store to steal from. |
| S6 | CSRF on dashboard actions | Server Actions are POST-only and Next.js checks the Origin header against the Host. `/v1` ignores cookies entirely, so the API has no ambient authority. |
| S7 | XSS and clickjacking | Content Security Policy, `frame-ancestors: none`, nosniff, Referrer-Policy, HSTS in production, and React's own escaping. |
| S8 | Privacy leakage | Prompts and responses are never stored: no column exists for them. Request metadata has a retention window and a prune script. |
| S9 | Retry storms | Bounded attempts, jittered backoff, cooldowns shared through the database, and round-robin selection so load is spread rather than concentrated. |
| S10 | Secret-management mistakes | `.env` is git-ignored and only `.env.example` is tracked. The environment is validated at boot: production refuses to start with a missing secret, a placeholder value, or a non-HTTPS `APP_URL`. |

**Accepted, and documented rather than hidden:** anyone who can read the
deployment's environment can read the provider keys, exactly as with any
environment-configured service. That trade-off is what removes the encrypted
vault, its key-rotation machinery, and the database as a target worth attacking.

## 5. Database schema

The database holds no secrets and no accounts: only key health and usage. Keys
are identified by `fingerprint`, an HMAC of the configured secret, so statistics
survive restarts and redeploys while remaining non-reversible.

```text
provider_keys ──< provider_key_cooldowns     health, and per-model cooldowns
requests                                     usage metadata (never prompts)
rate_limit_events                            why something was throttled
rate_limit_counters                          fixed-window limit counters
```

**provider_keys**: `fingerprint (pk), provider, label, key_hint, status
('active' | 'invalid'), status_reason, cooldown_until, consecutive_failures,
request_count, success_count, error_count, rate_limit_count, last_used_at,
last_success_at, last_error_at, last_error_code, last_validated_at,
first_seen_at`.

**provider_key_cooldowns**: primary key `(fingerprint, model)`, plus
`cooldown_until, reason, quota_scope`. Per-model, because providers meter
quotas per model.

**requests**: `id, token_label, provider_key_fingerprint, provider_key_hint,
provider, model, endpoint, stream, status_code, outcome, error_code, attempts,
latency_ms, ttfb_ms, prompt/completion/reasoning/total token counts,
created_at`. There is deliberately no column that could hold a prompt or a
response.

**rate_limit_events**: upstream 429s and gateway-side limits, for the
dashboard. **rate_limit_counters**: `(key, window_start)` counters, one atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` per check.

Provider health shown in the dashboard is *derived* from `requests` rather than
kept in a hot row that every request would contend on.

## 6. API routes

### Gateway (Bearer `gw_live_…`, no cookies)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/chat/completions` | OpenAI Chat Completions; `stream: true` → SSE |
| GET | `/v1/models` | Models available to the caller's configured providers |
| GET | `/v1/models/{model}` | Single model |
| no | `/v1/responses`, `/v1/embeddings` | Roadmap (section 12, phase 4) |

Errors use OpenAI's envelope so SDKs surface them naturally:
`{ "error": { "message", "type", "code", "param", "request_id" } }`, plus
`x-request-id`, `Retry-After` on 429/503, and `x-ratelimit-*` headers.

### Web app (session cookie)

| Path | Purpose |
|---|---|
| `/`, `/privacy`, `/security` | Public pages |
| `/docs/*` | Documentation |
| `/login` | Owner sign-in (one password) |
| `/dashboard` | Overview: stats, usage chart, key performance, recent requests |
| `/dashboard/keys` | Per-key performance and recent rate limits |
| `/dashboard/requests` | Request log (metadata) |
| `/api/health` | Liveness and readiness (database ping) |

The only dashboard mutations are sign-in and sign-out, as Server Actions in
`src/server/actions/auth.ts`. Everything else is read-only, because keys are
configured through the environment.

## 7. Provider abstraction

The public API format (OpenAI Chat Completions) doubles as the internal
normalised format. Most future providers (OpenAI, Groq, OpenRouter, Mistral,
Cerebras) are OpenAI-compatible, so they become a thin `OpenAICompatibleAdapter`
configured with a base URL. Gemini and Anthropic get translating adapters.

```ts
interface ProviderAdapter {
  readonly id: ProviderId;                 // 'gemini'
  readonly displayName: string;            // 'Google Gemini'
  readonly config: ProviderConfig;         // cooldown defaults, timeouts, reset tz …
  readonly keyInput: KeyInputSpec;         // placeholder / length bounds for the UI

  supportsModel(model: string): boolean;
  validateKey(key: string, ctx: CallContext): Promise<KeyValidationResult>;
  sendRequest(key: string, req: ChatRequest, ctx: CallContext):
    Promise<ProviderResult>;               // { ok: true, kind: 'json' | 'stream', … }
                                           // | { ok: false, error: ProviderError }
  classifyError(input: UpstreamFailure): ProviderError;
  getAvailableModels(key: string, ctx: CallContext): Promise<ModelInfo[]>;
}

type ProviderErrorKind =
  | 'rate_limited' | 'invalid_key' | 'permission_denied'   // key-scoped
  | 'overloaded' | 'upstream_error' | 'timeout' | 'network' // transient
  | 'bad_request' | 'not_found' | 'precondition'            // caller's problem
  | 'cancelled';

interface ProviderError {
  kind: ProviderErrorKind;
  status: number;               // upstream HTTP status (0 for network)
  message: string;              // already scrubbed, safe for clients
  retryAfterMs?: number;        // RetryInfo / Retry-After
  quotaScope?: 'minute' | 'day' | 'unknown';
}
```

Adapters receive `fetch` through their constructor, so tests inject a fake.
The registry resolves `model` → adapter: an explicit `provider/model` prefix
(e.g. `gemini/gemini-3.8-flash`) or the adapter's `supportsModel` match
(`gemini-*`).

## 8. Key-routing algorithm

### 8.1 Error policy (data, not scattered `if`s)

| Kind | Upstream examples | Retry? | Effect on key |
|---|---|---|---|
| `rate_limited` | 429 `RESOURCE_EXHAUSTED` | rotate to another key | cooldown on (key, model), whole quota group; duration: `retryDelay` → per-day ⇒ next Pacific midnight → per-minute ⇒ 60 s → provider default (30 min, configurable) |
| `invalid_key` | 400 `API_KEY_INVALID`, 401, leaked-key 403 | rotate | `status = invalid` until the user re-tests |
| `permission_denied` | 403 `PERMISSION_DENIED` | rotate | key-wide cooldown (15 min), failure counted, flagged in UI |
| `overloaded` / `upstream_error` / `timeout` / `network` | 500, 502, 503, 504, socket errors | limited: prefer another key, jittered backoff | consecutive-failure counter → circuit breaker cooldown (exponential, capped) |
| `bad_request` / `not_found` / `precondition` | 400, 404, `FAILED_PRECONDITION` | **no**, returned to caller | none (not the key's fault) |
| `cancelled` | client disconnected | no | none |

### 8.2 Loop

```text
candidates ← keyStore.listCandidates(user, provider, model, now)   // 1 query
for attempt in 1..maxAttempts (default 5; transient retries ≤ 2):
    stop if client aborted or overall deadline would be exceeded
    key ← select(candidates, tried, now)
            eligible = active ∧ ¬keyCooldown ∧ ¬modelCooldown ∧ ¬groupCooledThisRequest
            prefer untried; only transient errors may reuse a tried key
            tier by consecutive_failures, then cycle within the tier:
              round_robin (default) least-recently-used, so traffic spreads evenly
              power_of_two          sample two, take the older (fewer collisions under load)
    if none → break
    result ← adapter.sendRequest(decrypt(key), request)            // per-attempt timeout
    if ok   → keyStore.recordSuccess(key) ; return
    policy ← POLICY[result.error.kind]
    keyStore.recordFailure(key, model, error, cooldown)             // shared via DB
    apply the same cooldown to local candidate copies (and quota-group siblings)
    if ¬policy.retry → return error to caller (scrubbed)
    backoff with jitter if transient
return summarise(attempts):
    all cooling down  → 429 all_keys_rate_limited  + Retry-After = earliest recovery
    no active keys    → 400 no_provider_keys (dashboard link)
    transient only    → 502/503/504 accordingly
```

**Streaming:** the adapter resolves once upstream headers arrive. A non-200
before the first byte is classified and retried like any other failure. After
the first byte, nothing is retried. Mid-stream failures are sent as a final SSE
`error` event and the stream closes.

**Cooldown expiry** needs no job. Eligibility is `cooldown_until <= now()`, so
keys become eligible again automatically.

## 9. Authentication model

- **Owner to dashboard:** one password (`OWNER_PASSWORD`) and a signed,
  http-only cookie holding only an expiry. No accounts, no session table, no
  sign-up. Attempts are throttled per client address, and changing `AUTH_SECRET`
  or the password invalidates every session.
- **Machines to gateway:** `Authorization: Bearer <token>`, matched in constant
  time against `GATEWAY_API_KEYS`. `x-api-key` is accepted for SDK
  compatibility. Cookies are ignored on `/v1`.
- **Rotation:** edit the environment variable and redeploy. There is nothing to
  revoke at runtime, which is the trade-off for having nothing to steal at rest.

## 10. Interface design

The interface is called "thermal print", and it exists to make the routing
engine legible rather than to decorate it.

**Chroma means activity.** Amber is the single accent and it carries one
meaning: this key is in flight, or it is being throttled. A key at rest has no
chroma. Red is reserved for failure. The consequence is that a served request
renders in plain graphite while a 429 renders amber, so the dashboard can be
scanned for trouble without reading it. The primary button is ink rather than
amber for the same reason: spending the accent on a call to action would turn
the one colour that means something into decoration.

**Structure is printed.** Hairlines and columns group content the way a
technical document does. Bounded panels exist only in the dashboard, where a
reader is comparing tables and needs to know where one dataset ends. One corner
radius (4px) exists in the whole product.

The tokens live in `src/app/globals.css` and are the only source of colour.
Text tiers are solved numerically for 4.5:1 against the surface they sit on,
in both themes, rather than chosen by eye. The two chart series separate by
luminance before hue so they survive every colour vision deficiency.

**One authored moment.** The only animation in the product is the setup
walkthrough on the landing page and the docs index. It is compiled from a
declarative script (`src/components/walkthrough/script.ts`) into Web Animations
tracks: one track per element and property group, each spanning the full run, so
seeking is a single `currentTime` assignment and no track can reset another by
holding its own first frame. Pointer destinations are named, not positioned, and
measured from the live DOM at build time, which is what makes one script correct
at every breakpoint and after any resize.

Every scene renders twice from one component: animated, and as a finished
snapshot. The snapshot is server-rendered and is what a reader with reduced
motion, a crawler, or a browser without JavaScript receives, so the walkthrough
never hides information behind motion. No animation library is used; adding one
would cost every self-hoster bundle size for something the platform expresses
directly.

## 11. Deployment architecture

```text
             HTTPS (platform TLS / Caddy)
                      │
        ┌─────────────┴─────────────┐
        │  N × Juggle app container │  Next.js standalone, stateless
        │  (Dockerfile, non-root)   │  RUN_MIGRATIONS=true on one release step
        └─────────────┬─────────────┘
                      │ TLS
               PostgreSQL 15+
```

- **Docker / VPS / Fly / Render / Railway:** `Dockerfile` (multi-stage,
  standalone output, non-root user, healthcheck). `docker-compose.yml` bundles
  Postgres for self-hosting.
- **Vercel:** works as-is. Set `maxDuration` for streaming routes and use a
  pooled Postgres URL.
- **Per-instance caveat:** the concurrency cap is enforced per instance. RPM,
  quota, cooldown and key-health state are global (Postgres).
- **Migrations:** Drizzle SQL migrations committed in `drizzle/`, applied by
  `pnpm db:migrate` (no drizzle-kit needed at runtime).

## 12. Phased implementation plan

Each phase ends with `pnpm typecheck && pnpm lint && pnpm test` plus a manual
smoke run of the app.

**Phase 0, foundations.** Scaffold, strict TS, lint, Vitest, env validation,
Drizzle + PGlite, repo hygiene (`.gitignore`, `.env.example`, license).

**Phases 1 to 3, complete.** Environment-configured keys and tokens; the
routing engine with round-robin cycling, model-scoped cooldowns, quota groups
and a circuit breaker; the Gemini adapter with streaming; owner sign-in; the
dashboard (overview, usage chart, key performance, request log); in-app docs;
the landing, privacy and security pages; Docker and Vercel deployment.

Still open from the original plan: tools and function calling with
thought-signature round-trip, `response_format`, images via data URIs, and
`reasoning_effort`. Each is rejected today with a `400 unsupported_parameter`
naming the field, rather than being silently ignored.

**Phase 4, roadmap (architecture only for now).** OpenAI-compatible adapter family
(OpenAI, Groq, OpenRouter, Mistral, Cerebras), Anthropic adapter, `/v1/responses`,
embeddings, health-scored routing, model fallbacks, budgets, teams/orgs,
webhooks, CLI and SDKs.
