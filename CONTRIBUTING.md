# Contributing to Juggle

Thanks for considering a contribution. This guide covers the setup, the conventions, and the parts of
the codebase where care matters most.

## Getting set up

Requirements: Node 22+, pnpm 10+. No database server needed.

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate    # paste the secrets into .env, then add your keys
pnpm db:migrate
pnpm dev
```

Without `DATABASE_URL`, development runs on an embedded PostgreSQL (PGlite) in `./.data`. Delete that
directory to start from a clean database. PGlite allows one process at a time, so stop the dev server
before running database scripts; the app fails with an explanation if you forget.

To exercise the gateway without a real provider key, run the mock upstream:

```bash
pnpm mock:gemini
GEMINI_BASE_URL=http://localhost:4010 pnpm dev
```

## Before opening a pull request

```bash
pnpm check    # typecheck + lint + tests
```

Green `pnpm check` is the bar. Tests use PGlite and a scripted fake provider, so they need no network,
no database server and no API keys.

**Never put a real API key in a test, a fixture, a comment or a commit.** Tests use obviously fake
values such as `AIzaSyTESTKEY…`.

## Conventions

- **TypeScript, strict.** No `any`; prefer a precise type or `unknown` with narrowing.
- **Zod at every boundary.** Request bodies, form data and environment variables are parsed, not cast.
- **Comments explain why.** The code already says what it does. A comment earns its place by
  explaining a constraint, a trade-off or a non-obvious provider behaviour.
- **Formatting** follows the existing files; lint with `pnpm lint`.

## Where to be careful

Some areas have invariants that are easy to break by accident:

- **`src/server/keys/env-keys.ts`**: parsing keys and tokens out of the environment. Fingerprints
  identify a key across restarts, so changing how they are derived resets everyone's statistics.
  Token comparison must stay constant-time.
- **`src/server/gateway/router.ts` and `policy.ts`**: the routing engine. Every behaviour change
  should come with a test in `tests/gateway/router.test.ts`. Retries must stay bounded.
- **Anything that touches a provider key**: it must never reach a response body, a log, an error
  message or the database. `tests/gateway/gateway.integration.test.ts` asserts this; keep it that way.
- **`src/server/env.ts`**: the single source of configuration. Everything is parsed and validated
  here, never read from `process.env` elsewhere.
- **Request logging**: metadata only. There is deliberately no column for prompts or responses.

## Design

The interface has two rules, and almost everything else follows from them.

**Chroma means activity.** Amber is the only accent, and it means a provider key is working or being
throttled. A key at rest has no colour at all, and red is reserved for failure. That is why a served
request in the request log is grey while a 429 is amber: a long table can then be scanned for trouble
without reading a row. Do not reach for amber to make something look important, and do not add a
second accent.

**Structure is printed, not boxed.** Hairlines and columns do the grouping. `Panel` exists for the
dashboard, where a person is scanning tables and needs to know where one dataset ends, and it never
nests. Marketing and docs pages group with rules and spacing instead, because a grid of identical
cards is the lazy container.

Working rules:

- **One radius.** `rounded-sharp` (4px) and nothing else. The only exception is the walkthrough's
  range thumb, which is round because a slider thumb is a native affordance.
- **Colour comes from tokens** in `src/app/globals.css`, never from a raw Tailwind palette class.
  `text-ink-subtle` and friends are solved for 4.5:1 against `--color-surface`; if you change a
  lightness, re-check the contrast rather than judging it by eye.
- **Monospace is for code, data and measurement**, never as decoration to make prose look technical.
  Numbers are tabular so columns of them line up.
- **No eyebrow labels.** The small uppercase line above a heading is banned; the heading carries its
  own weight.
- **One moving thing.** The walkthrough is the page's only authored animation. Resist adding scroll
  reveals to sections; they dilute it and cost nothing but load time.
- **Both themes, every time.** Light and dark are equal citizens, and neither ships untested.

### The walkthrough

`src/components/walkthrough/` holds the animated setup guide on the landing page and the docs index.

- `script.ts` is the timeline as plain data. Edit the sequence here, not in the player.
- `player.tsx` compiles that script into Web Animations tracks, one per element and property group,
  each spanning the whole run so seeking is a single `currentTime` assignment. Pointer paths are
  measured from the live DOM, so the same script is correct at every breakpoint.
- `stages.tsx` renders each scene twice: animated, and as a finished `snapshot`. The snapshot is what
  reduced-motion readers, crawlers and anyone without JavaScript get, so it must always carry the
  same information as the animation.
- `tests/walkthrough/script.test.ts` guards the invariants (cues inside the run, no overlapping cues
  on one property, bars that only grow). Run it after editing the script.

Adding a dependency to animate something is almost always the wrong answer here: the platform has
covered every case so far, and this project should stay cheap for people self-hosting it.

## Adding a provider

The provider interface is `src/server/providers/types.ts`, and `gemini/` is the reference
implementation. A new adapter needs to:

1. implement `ProviderAdapter`: `supportsModel`, `prepareRequest`, `validateKey`, `sendRequest`,
   `classifyError`, `getAvailableModels`;
2. map upstream failures onto the normalised `ProviderErrorKind` values, since the router's retry and
   cooldown policy keys off them. Getting `rate_limited` versus `invalid_key` versus transient right
   matters more than anything else in the adapter;
3. surface a retry hint (`retryAfterMs`) and a quota scope when the provider gives one;
4. register in `src/server/container.ts`;
5. come with tests for translation and error classification, driven by a fake upstream like
   `tests/support/fake-gemini.ts`.

Providers that speak the OpenAI format need very little translation: the internal request format is
already OpenAI-shaped.

## Documentation

User-facing behaviour changes should update the in-app docs under `src/app/docs/`. Architectural
decisions belong in `docs/ARCHITECTURE.md`, with the reasoning, not just the outcome.

## Reporting bugs

Include the version or commit, what you expected, what happened, and the `x-request-id` header if a
gateway request was involved. Redact keys and tokens.

Security issues follow a different path: see [SECURITY.md](SECURITY.md). Please don't file them as
public issues.
