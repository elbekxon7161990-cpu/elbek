import { Global, Module } from '@nestjs/common';

import { createRlsContextExtension } from './rls-context.extension';
import { PrismaService } from './prisma.service';

/**
 * TASK-DB-011 — DI token for the *base, unextended* `PrismaService`
 * instance. This is the one NestJS actually constructs and manages the
 * `$connect()`/`$disconnect()` lifecycle for (via `PrismaService`'s own
 * `OnModuleInit`/`OnModuleDestroy`, unchanged from before this task).
 *
 * The `PrismaService` token itself (below) resolves to an *extended* client
 * derived from this one, so injecting `PRISMA_BASE_CLIENT` directly is only
 * for code that must deliberately bypass the RLS user-context mechanism —
 * e.g. a future `app_admin`/`BYPASSRLS` code path (not implemented by this
 * task; see docs/rls-user-context.md). No repository should ever inject
 * this token in place of `PrismaService`.
 */
export const PRISMA_BASE_CLIENT = Symbol('PRISMA_BASE_CLIENT');

/**
 * Global so every repository implementation can inject `PrismaService`
 * without each feature module re-importing this one — consistent with "one
 * database, one Prisma client" for the whole process (a single underlying
 * connection pool, shared by both the base and extended providers below —
 * `.$extends()` does not open a second connection).
 *
 * TASK-DB-011: the `PrismaService` token is now bound via a factory that
 * wraps the base client in the RLS user-context extension
 * (./rls-context.extension.ts), so every existing repository
 * (`PrismaUserRepository`, `PrismaTransactionRepository`, etc.) gets RLS
 * context propagation transparently, with no source change of its own —
 * `constructor(private readonly prisma: PrismaService)` keeps resolving to
 * something that supports exactly the same `.model.operation()`/
 * `$transaction`/`$executeRaw` surface as before, just wrapped.
 *
 * The factory's return type is asserted to `PrismaService` rather than
 * inferred: Prisma's `.$extends()` returns a structurally-compatible
 * object (every public member `PrismaService` exposes, including all
 * inherited `PrismaClient` model delegates), but not a nominal instance of
 * the `PrismaService` subclass — TypeScript's structural typing can't see
 * that compatibility through `PrismaService`'s private `logger` field. This
 * is a narrow, deliberate, well-understood cast at exactly one boundary
 * (this factory), not a workaround spread through the codebase; the
 * unmodified repository test suites passing after this change (see the
 * TASK-DB-011 final report) is the actual verification that the runtime
 * shape lines up, independent of the cast.
 */
@Global()
@Module({
  providers: [
    { provide: PRISMA_BASE_CLIENT, useClass: PrismaService },
    {
      provide: PrismaService,
      useFactory: (base: PrismaService) =>
        base.$extends(createRlsContextExtension(base)) as unknown as PrismaService,
      inject: [PRISMA_BASE_CLIENT],
    },
  ],
  exports: [PrismaService, PRISMA_BASE_CLIENT],
})
export class PrismaModule {}
