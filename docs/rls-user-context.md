# Request-Scoped Database User Context for RLS (TASK-DB-011)

## Why this exists

The `transactions` table (and 15 others — see `packages/infrastructure/src/prisma/rls-protected-models.ts` for the full, verified list) has a Row-Level Security policy:

```sql
CREATE POLICY tenant_isolation ON transactions
  USING (user_id = current_setting('app.current_user_id', true)::uuid);
```

That policy only does something useful if `app.current_user_id` is actually set to the requesting user's id for every query. Before this task, nothing in the codebase ever set it — every `app_user`-authenticated query would have silently returned zero rows (`SELECT`) or been rejected outright (`INSERT`), because `current_setting(..., true)` returns `NULL` when unset. This document explains the mechanism that closes that gap.

## How user context enters the system

A single, framework-independent module — `packages/shared/src/context/user-context.ts` — wraps Node's built-in `AsyncLocalStorage`:

- `runWithUserContext(userId, fn)` — establishes `{ userId }` as the current context for `fn` and everything it awaits, transitively.
- `getCurrentUserId()` — reads it back, or `undefined` if none is set.
- `requireCurrentUserId()` — reads it back, or throws `MissingDatabaseUserContextError`.

Every **trusted entry point** — a place in the code that has just verified who the caller is — calls `runWithUserContext` exactly once, as early as possible:

- **Telegram (`apps/telegram-bot`)** — done. `TelegramBotService`'s existing `bot.use()` middleware (TASK-AUTH-001) already resolves the caller to a `User` via `ProvisionTelegramUserUseCase`. This task extended that same middleware (not a second one) to run the rest of the update's processing — `next()` — inside `runWithUserContext(user.id, next)`.
- **API (`apps/api`)** — not yet wired, because there is no authenticated request flow to hook it into yet (no guard, no principal, no controllers beyond health checks). The pattern is ready: once a real auth guard exists, it should resolve the principal and call `runWithUserContext(principal.userId, () => next.handle())` (or the equivalent for whatever HTTP framework glue is chosen) around the rest of the request pipeline.
- **Worker (`apps/worker`)** — not yet wired, for the same reason: zero job processors exist yet. The pattern for a future processor that acts on behalf of one user: read `job.data.userId` (a value the system itself put there when it enqueued the job — never external input) and call `runWithUserContext(job.data.userId, () => handleJob(job))`. A future job with no single owning user (e.g. a cross-tenant maintenance job) must not invent a user id — see "System/admin access" below.

## How Prisma obtains it

`packages/infrastructure/src/prisma/rls-context.extension.ts` defines a Prisma Client Extension scoped to `query.$allModels.$allOperations` — i.e. every CRUD operation against every model, and *only* that (see "Why raw queries and `$transaction` are never intercepted" below).

For each operation:

1. If the model isn't in `RLS_PROTECTED_MODELS`, the call passes straight through unmodified — no overhead, no behavior change, for `User`/`Category`/`Currency`/`TransactionAuditLog`/etc.
2. If it is, the extension calls `requireCurrentUserId()`. Missing context throws immediately — before any SQL is sent.
3. Otherwise, it runs the array form of `$transaction`:
   ```ts
   const [, result] = await basePrisma.$transaction([
     basePrisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
     query(args),
   ]);
   ```
   Both elements execute sequentially inside one `BEGIN`/`COMMIT`, on one connection — Prisma's documented batching behavior — which is what makes the `set_config` call visible to the query beside it.

`packages/infrastructure/src/prisma/prisma.module.ts` wires this in at the DI level: the real, connectable `PrismaService` (`$connect`/`$disconnect` managed by Nest exactly as before this task) is now registered under an internal token, `PRISMA_BASE_CLIENT`; the public `PrismaService` token that every repository already injects is rebound to a factory that returns `base.$extends(createRlsContextExtension(base))`. One physical connection pool, two references to it — one raw, one wrapped.

## Why `set_config(..., true)` is mandatory

The third argument (`is_local`) scopes the setting to the current transaction only. Postgres discards it automatically at `COMMIT` **or** `ROLLBACK` — never manually, never conditionally. Under connection pooling, a plain `SET` (or `set_config(..., false)`) would be session-scoped, meaning it would silently survive past the current logical request and leak into whatever the *next* request happens to reuse that same pooled physical connection for. This is the single most important correctness property of this design, and it is why every call site in this codebase uses the `true` form and nothing else.

## Why the base (unextended) `PrismaClient` is used for the wrapping calls

`createRlsQueryHandler(basePrisma)` always issues `$transaction`/`$executeRaw` through the `basePrisma` reference it was constructed with — the client `.$extends()` was called *on*, not the client it *produced*. Two independent reasons this avoids the "extension re-intercepts itself" recursion risk:

1. `query(args)` — the continuation Prisma hands the extension for "now actually run the operation" — is not a fresh top-level call. It does not re-enter `$allModels.$allOperations`. This is true regardless of which client instance is used to await it.
2. `$transaction`/`$executeRaw` are client-level methods, not model operations — Prisma's extension type map keeps `'model'` operations and raw/`'other'` operations in structurally separate branches, and `$allModels` only ever covers the former. So even calling `$transaction`/`$executeRaw` on the *extended* client would not trigger this extension.

Routing through `basePrisma` regardless is kept as a second, independent, low-cost safeguard against that class of bug — not because it's the only thing preventing it.

## Why repositories don't need manual RLS handling

Every existing repository (`PrismaUserRepository`, `PrismaTransactionRepository`, `PrismaCurrencyRepository`, `PrismaCategoryRepository`, `PrismaTransactionAuditLogRepository`) still does exactly `constructor(private readonly prisma: PrismaService) {}` and calls `this.prisma.transaction.findUnique(...)` etc., completely unchanged. Because the `PrismaService` DI token itself now resolves to the extended client, every one of those calls is transparently wrapped — the repository code has no idea this task exists. This was verified, not just designed: none of the five repository files were touched by this task, and their existing test suites (domain/application/infrastructure) all still pass.

## What happens when context is missing

`MissingDatabaseUserContextError` (`packages/shared/src/context/missing-database-user-context.error.ts`) is thrown *before* any SQL reaches Postgres. This is a deliberate choice over letting RLS's own silent "zero rows" (`SELECT`) / "insert rejected" (`INSERT`) behavior be the only signal — a developer who forgets to wire context at some new entry point gets a loud, specifically-named failure in testing, not a confusing empty result discovered later in production.

## How system/admin operations differ

Postgres already has a separate role for this: `app_admin` (`BYPASSRLS`, created in the same migration as `app_user`). Any operation that is legitimately cross-tenant or system-level (partition maintenance, global reconciliation jobs, a future Admin Panel) must run through a connection authenticated as `app_admin`, never by inventing or spoofing a `userId` to push through this mechanism. **No such connection is wired up by this task** — there is currently exactly one `DATABASE_URL`/one Prisma client in the whole system, connected as `app_user`. Building the `app_admin` code path is explicitly out of scope here (it would mean implementing admin authentication, which this task was explicitly told not to do) and is a prerequisite for whatever future task adds the first genuinely cross-tenant background job or Admin Panel feature.

## Known gaps this task discovered but does not fix

- **`app_user` has no password.** The migration runs `CREATE ROLE app_user LOGIN;` with no `PASSWORD` clause. `.env.example`'s `app_user:CHANGE_ME@...` is a placeholder that will not actually authenticate against a freshly-migrated database. This blocks running `rls-user-context.integration.spec.ts` for real, in addition to Docker not being available in this environment. Provisioning a real password (via the secrets manager, `FR-SCR-M-001`) is a prerequisite for actually exercising this mechanism end-to-end, not something this task's scope covers.
- **`apps/api` and `apps/worker` have no real entry point yet** — the propagation pattern is documented above and ready to use the moment an auth guard or job processor exists, but nothing currently calls `runWithUserContext` from either app.
- **The pre-existing `transaction_date`/composite-FK `ON UPDATE` gap** (flagged in TASK-FIN-001 Part 3's report) is unrelated to this task and remains open.
