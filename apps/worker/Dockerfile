# Build context is the monorepo root: `docker build -f apps/worker/Dockerfile .`

FROM node:22-alpine AS base
RUN npm install -g pnpm@11.20.0 turbo@2.10.9

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @afa/worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @afa/infrastructure run prisma:generate
RUN pnpm turbo run build --filter=@afa/worker...

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 afa && adduser --system --uid 1001 afa
COPY --from=installer --chown=afa:afa /app .
USER afa
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/main.js"]
