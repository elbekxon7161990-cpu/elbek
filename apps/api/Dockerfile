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
# `turbo prune --docker`'s output (both out/json/ and out/full/) only
# contains each pruned package's own directory contents plus a trimmed root
# package.json/lockfile — it does not trace or include arbitrary root-level
# files referenced only via a TypeScript `extends` chain. Every package.json
# here extends "../../tsconfig.base.json" (see e.g.
# packages/shared/tsconfig.json), so without this explicit copy `tsc -b`
# fails immediately with TS5083 "Cannot read file '/app/tsconfig.base.json'"
# — confirmed by an actual `docker build` on the target deployment host.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @afa/infrastructure run prisma:generate
RUN pnpm turbo run build --filter=@afa/api...

FROM node:22-alpine AS runner
WORKDIR /app
# Alpine's base image ships no `openssl` binary at all — without it, Prisma
# Client's runtime platform detection can't determine the actual OpenSSL
# version present and falls back to assuming OpenSSL 1.1 (the plain
# "linux-musl" engine target), even though the "linux-musl-openssl-3.0.x"
# engine (see schema.prisma's binaryTargets) was already generated and
# present. Confirmed by an actual runtime crash on the deployment target:
# PrismaClientInitializationError / "Error loading shared library
# libssl.so.1.1: No such file or directory" — installing openssl here is
# what lets the correct engine actually get selected at startup.
RUN apk add --no-cache openssl
RUN addgroup --system --gid 1001 afa && adduser --system --uid 1001 afa
COPY --from=installer --chown=afa:afa /app .
USER afa
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1
CMD ["node", "apps/api/dist/main.js"]
