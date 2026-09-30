# syntax=docker/dockerfile:1
#
# Multi-stage build producing a small, non-root image that runs the Next.js
# standalone server. Migrations can run at startup with RUN_MIGRATIONS=true.

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder secrets: the build never contacts the database, and every page
# reads configuration at request time. Real values come from the runtime env.
ENV BETTER_AUTH_SECRET="build-time-placeholder-secret-0000000000" \
    ENCRYPTION_KEYS="build:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
RUN pnpm build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs juggle

COPY --from=build /app/public ./public
COPY --from=build --chown=juggle:nodejs /app/.next/standalone ./
COPY --from=build --chown=juggle:nodejs /app/.next/static ./.next/static
# SQL migrations are read at runtime when RUN_MIGRATIONS=true.
COPY --from=build --chown=juggle:nodejs /app/drizzle ./drizzle

USER juggle
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
