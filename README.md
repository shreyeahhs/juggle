# Juggle

**One API. Your keys. Automatic failover.**

Juggle is a self-hosted, open-source **bring-your-own-key (BYOK) AI gateway**. You put your provider
API keys in its environment; your applications call one OpenAI-compatible endpoint. Requests cycle
through the keys, and rate limits, cooldowns, retries and failover are handled for you.

```js
// Instead of giving every project a provider key…
const client = new OpenAI({
  apiKey: process.env.JUGGLE_TOKEN,          // your gateway token
  baseURL: "https://your-gateway.vercel.app/v1",
});
```

Each deployment belongs to **one person**: you run your own instance, holding your own keys, with a
single password on the dashboard. There is no sign-up and no multi-tenancy.

Supported today: **Google Gemini**. The provider layer is an interface with pluggable adapters.

> Juggle has no models of its own and does not resell inference. Every request is served by a key you
> supplied and billed to your own provider account.

---

## Contents

- [Why](#why)
- [Features](#features)
- [Deploy](#deploy)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Local development](#local-development)
- [Security model](#security-model)
- [API](#api)
- [Roadmap](#roadmap)
- [License](#license)

## Why

Provider rate limits are per project and per model, and a single key runs out at the worst moment.
The usual workarounds are pasting the same key into every project, or hand-rolling retry logic in
each one. Juggle centralises both: one credential for your apps, a pool of provider keys behind it,
and a router that knows the difference between "this key is throttled for one model", "this key is
dead" and "the provider is having a bad minute".

## Features

- **OpenAI-compatible API.** `POST /v1/chat/completions` (streaming and not), `GET /v1/models`.
  Official OpenAI SDKs work with only the API key and base URL changed.
- **Round-robin key cycling.** Every request goes to the least recently used healthy key, so ten keys
  serve ten consecutive requests. Spreading load is what stops a limit being reached at all.
- **Failover underneath it.** When a key is rate-limited or rejected anyway, the gateway retries on
  another key inside the same request, so your app gets a response instead of a 429.
- **Model-scoped cooldowns.** Quotas are metered per model, so a key exhausted on Pro keeps serving
  Flash. An exhausted daily quota waits for the provider's actual reset, not a guess.
- **Quota groups.** Gemini limits apply per Google Cloud project; keys from one project cool down
  together instead of wasting attempts.
- **No secrets in the database.** Keys live in environment variables. The database holds usage
  statistics and a non-reversible fingerprint, nothing else.
- **Key performance dashboard.** Per-key requests, success rate, share of traffic, rate limits,
  cooldowns and last use, plus a usage chart and a request log.
- **Usage analytics without prompts.** Metadata only, with a retention window. There is no column for
  a prompt or a response.
- **Limits that protect your bill.** Per-token and deployment-wide RPM, a daily cap, a concurrency
  limit, body-size limits, bounded retries and request deadlines.

## Deploy

### Vercel

1. Fork this repository and import it on Vercel.
2. Add a PostgreSQL database (Neon, Vercel Postgres and Supabase all have free tiers) so
   `DATABASE_URL` is set.
3. Set the environment variables below, with `RUN_MIGRATIONS=true` for the first deploy.
4. Open your deployment, sign in with `OWNER_PASSWORD`, and check the dashboard.

```bash
AUTH_SECRET="…"                       # pnpm secrets:generate
OWNER_PASSWORD="…"                    # your dashboard password
GEMINI_API_KEYS="AQ.Ab8…1,AQ.Ab8…2"       # as many as you like
GATEWAY_API_KEYS="gw_live_…"          # what your apps send
DATABASE_URL="postgres://…"
APP_URL="https://your-gateway.vercel.app"
TRUST_PROXY="true"
RUN_MIGRATIONS="true"
```

### Docker

```bash
cp .env.example .env     # fill in the variables above plus POSTGRES_PASSWORD
docker compose up -d
```

The compose file brings its own PostgreSQL and applies migrations at startup.

### Anywhere else

It is a standard Next.js app: `pnpm build && pnpm start`, with `pnpm db:migrate` as a release step.
`/api/health` returns 200 when the database is reachable.

## Configuration

Every variable is documented in [`.env.example`](.env.example). The required ones:

| Variable | Notes |
|---|---|
| `AUTH_SECRET` | Signs the dashboard session and derives key fingerprints. 32+ characters. |
| `OWNER_PASSWORD` | The dashboard password. This deployment has no other account. |
| `GEMINI_API_KEYS` | Comma-separated provider keys, optionally named: `spare=AQ.Ab8…`. Add the project a key belongs to with `spare@project-2=AQ.Ab8…`. |
| `GATEWAY_API_KEYS` | Comma-separated tokens your apps send, optionally named: `prod=gw_live_…`. |
| `DATABASE_URL` | PostgreSQL, for statistics and shared cooldowns. Required in production. |
| `APP_URL` | Public URL. Must be `https://` in production. |

Useful optional ones: `GEMINI_QUOTA_GROUP` (the default project group, when every key shares one Google Cloud project),
`GATEWAY_KEY_STRATEGY`, `GATEWAY_TOKEN_RPM`, `GATEWAY_DAILY_REQUESTS`, `REQUEST_LOG_RETENTION_DAYS`,
`TRUST_PROXY`.

Changing keys means editing an environment variable and redeploying. Statistics follow a key by its
fingerprint, so renaming one keeps its history and re-adding one picks it back up.

## Architecture

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
                        (keys and tokens)  (stats, cooldowns)    (Gemini, more later)
```

One request through the gateway:

```text
POST /v1/chat/completions
  1  size & content-type guard ........ 413 / 415
  2  IP auth-failure throttle ......... 429
  3  token check (constant time) ...... 401
  4  limits ........................... 429   (token RPM, total RPM, daily, concurrency)
  5  parse + validate ................. 400   (names the offending parameter)
  6  resolve provider + model ......... 400 / 404
  7  ROUTER  ─┬─ pick the least recently used healthy key
              ├─ call provider
              ├─ classify: rate limited │ invalid key │ permission │ transient │ caller error
              ├─ persist cooldown / invalidation / breaker state
              └─ rotate, back off, or return, within bounded attempts
  8  respond (JSON, or SSE forwarded without buffering)
  9  log metadata only; release the concurrency slot
```

The routing engine (`src/server/gateway/router.ts`) depends only on interfaces: a `KeyStore`, a
provider adapter, a clock and a random source. It knows nothing about HTTP or SQL, which is what
makes the failover matrix straightforward to test.

Design notes, including the provider research that shaped it: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Local development

Requirements: **Node 22+** and **pnpm 10+**. No database server needed.

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate      # paste the secrets into .env, then add your keys
pnpm db:migrate
pnpm dev
```

With no `DATABASE_URL`, development uses an embedded PostgreSQL (PGlite) in `./.data`. It allows one
process at a time, so stop the dev server before running database scripts; the app says so plainly if
you forget.

### Without a real provider key

```bash
pnpm mock:gemini                                   # terminal 1
GEMINI_BASE_URL=http://localhost:4010 pnpm dev     # terminal 2
```

The mock picks its behaviour from the key name, so you can exercise the router end to end:
`mock-key-ok-1`, `mock-key-429-1`, `mock-key-429day-1`, `mock-key-invalid-1`, `mock-key-403-1`,
`mock-key-500-1`, `mock-key-slow-1`, `mock-key-flaky-1`.

```bash
pnpm check          # typecheck + lint + tests
```

Tests run against an in-process PostgreSQL and a scripted fake provider, so the suite needs no
database server, no network and no API keys.

## Security model

- Provider keys live in the deployment's **environment**, never in the database. A database dump, a
  backup or a leaked connection string contains no key material.
- What is stored per key is a **fingerprint**: an HMAC using this deployment's `AUTH_SECRET`. It
  identifies a key across restarts and cannot be reversed.
- Gateway tokens are compared in constant time and never persisted.
- Upstream hosts are fixed in code and model names are pattern-validated, so the gateway cannot be
  pointed at an arbitrary URL.
- Logs pass through a scrubber that redacts credential-shaped strings; prompts and responses are never
  written anywhere.
- The dashboard is one password and a signed, http-only cookie. Sign-in attempts are rate limited.

Anyone who can read your deployment's environment can read your provider keys, as with any
environment-configured service. Reporting a vulnerability: [SECURITY.md](SECURITY.md).

## API

Full documentation ships with the app at `/docs`.

```bash
curl https://your-gateway.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer $JUGGLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.8-flash",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'
```

Errors use OpenAI's envelope, so SDK error types and automatic retries behave as expected. Responses
carry `x-request-id`, `x-juggle-attempts` and `x-ratelimit-*` headers.

## Roadmap

- Tool calling, structured outputs, vision and reasoning-effort pass-through
- More providers: OpenAI, Anthropic, Groq, OpenRouter, Mistral, Cerebras
- `/v1/responses` and `/v1/embeddings`
- Health-scored routing and model fallbacks

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
