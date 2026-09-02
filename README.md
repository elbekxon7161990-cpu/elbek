# AI Personal Finance Assistant

Modular-monolith implementation of the frozen PRD (Architecture Freeze v1.0). See the PRD repository's `IMPLEMENTATION-BLUEPRINT.md` and `ENGINEERING-TASK-BREAKDOWN.md` for the governing architecture and backlog — this repository does not restate them.

**Status:** project skeleton only. No business module is implemented yet (per this turn's explicit instruction) — `packages/domain` and `packages/application` are structurally present but empty; `packages/infrastructure` provides only the underlying Prisma/Redis/BullMQ connections, no repository implementations yet.

## Layout

```
apps/
  api/            REST endpoints only (Chapter 14)
  telegram-bot/   Telegram transport only, no business logic (Chapter 7 §7.2)
  worker/         Executes queues only (Chapter 3 §3.3.3)
packages/
  domain/         Entities, value objects, repository interfaces — zero external dependencies
  application/    Use-case orchestration — depends only on domain
  infrastructure/ Prisma/Redis/BullMQ, repository implementations — depends on domain + shared
  shared/         Config, logging, exception filters, validation — cross-cutting, no business logic
```

Dependency direction (enforced by each package's own `package.json` dependency list, not by convention alone): `apps/* → application, infrastructure, shared → domain`. Infrastructure implements domain's interfaces (imports domain); domain imports nothing in this repository.

## Setup

```bash
corepack enable
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/telegram-bot/.env.example apps/telegram-bot/.env
cp apps/worker/.env.example apps/worker/.env
# fill in real values — never commit .env (FR-SCR-M-001)

pnpm --filter @afa/infrastructure run prisma:generate
pnpm --filter @afa/infrastructure run prisma:migrate:deploy
pnpm --filter @afa/infrastructure run prisma:seed

pnpm build
pnpm --filter @afa/api run dev
```

## Docker Compose

```bash
docker compose up --build
```

`docker-compose.yml` reads each app's real `.env` file (not `.env.example`) via `env_file` — create those first. Inside the compose network, `DATABASE_URL`/`REDIS_URL` must point at the service names (`postgres`, `redis`), not `localhost` — the `.env.example` files default to `localhost` for running apps directly on the host during development.

`docker-compose.yml` itself publishes no host ports; `docker compose up` (no `-f` flag) auto-loads `docker-compose.override.yml` alongside it, which restores the `postgres`/`redis`/`api` host ports this local-dev flow relies on — no command changes needed.

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

`docker-compose.production.yml` (never auto-loaded — must be named explicitly) closes Postgres/Redis to the internet, adds a restart policy/bounded logging/resource limits to every service, and binds `api`'s port to `127.0.0.1` only (never `0.0.0.0`) — `telegram-bot` publishes no host port at all, since it receives Telegram traffic via long-polling, not a webhook. A reverse proxy terminating HTTPS in front of `api`'s loopback-only port (for the web admin panel) is expected to be provided by the host itself — e.g. a native nginx + Certbot setup — rather than by this compose file, since a deployment host may already have its own web server occupying 80/443 for unrelated sites.

## Commands

- `pnpm build` — `turbo run build` across the whole dependency graph
- `pnpm dev` — `turbo run dev`
- `pnpm lint` / `pnpm lint:fix`
- `pnpm test` — `turbo run test` (Vitest; no test files exist yet — `passWithNoTests` keeps this green until Phase 4 adds the first ones)
- `pnpm typecheck`
