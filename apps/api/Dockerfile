# Build context is the monorepo root: `docker build -f apps/api/Dockerfile .`
# Standard Turborepo-pruned multi-stage build (FR-DEP-001/002/003, Chapter 17
# §17.2) — each app ships as its own independently versioned, non-root image.

FROM node:22-alpine AS base
RUN npm install -g pnpm@11.20.0 turbo@2.10.9

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @afa/api --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @afa/infrastructure run prisma:generate
RUN pnpm turbo run build --filter=@afa/api...

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 afa && adduser --system --uid 1001 afa
COPY --from=installer --chown=afa:afa /app .
USER afa
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1
CMD ["node", "apps/api/dist/main.js"]
