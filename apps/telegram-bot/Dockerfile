# Build context is the monorepo root: `docker build -f apps/telegram-bot/Dockerfile .`

FROM node:22-alpine AS base
RUN npm install -g pnpm@11.20.0 turbo@2.10.9

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @afa/telegram-bot --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# See apps/api/Dockerfile's identical copy for why this is needed:
# `turbo prune --docker` doesn't include root-level files referenced only
# via a TypeScript `extends` chain (tsc -b fails with TS5083 otherwise).
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @afa/infrastructure run prisma:generate
RUN pnpm turbo run build --filter=@afa/telegram-bot...

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 afa && adduser --system --uid 1001 afa
COPY --from=installer --chown=afa:afa /app .
USER afa
ENV NODE_ENV=production
EXPOSE 3000
# No dedicated health route exists (this app's only HTTP surface is the
# Telegram webhook POST /telegram/webhook — see
# apps/telegram-bot/src/webhook/telegram-webhook.controller.ts); a
# GET/spider probe against it would always 404 regardless of process health.
# Checking the TCP port itself, not an HTTP status, confirms the Nest HTTP
# listener is up in both webhook and long-polling mode without adding a new
# endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD nc -z localhost 3000 || exit 1
CMD ["node", "apps/telegram-bot/dist/main.js"]
