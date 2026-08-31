import { requireCurrentUserId } from '@afa/shared';
import { Prisma, PrismaClient } from '@prisma/client';

import { RLS_PROTECTED_MODELS } from './rls-protected-models';

/**
 * Deliberately loose/minimal shape (not Prisma's full generic
 * `DynamicQueryExtensionCbArgs`) so this handler's *decision logic* is
 * unit-testable with a plain mock object, independent of Prisma's own
 * extension-registration machinery. `createRlsContextExtension` below is
 * the thin adapter that wires this handler into `Prisma.defineExtension`'s
 * actual typed callback shape.
 */
export interface RlsModelOperationArgs {
  model: string | undefined;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/**
 * TASK-DB-011 — the core decision: for a query against an RLS-protected
 * model, resolve the current async-context user id (throwing
 * `MissingDatabaseUserContextError` if absent — fail before any SQL runs)
 * and execute `SELECT set_config('app.current_user_id', $1, true)` +
 * the original query as one batched, transaction-scoped unit via the
 * *base, unextended* client's array-form `$transaction`. For any other
 * model, pass the call straight through unmodified.
 *
 * `basePrisma` MUST be the original client `.$extends()` was called on, not
 * the extended client this module produces. `query(args)` is itself
 * Prisma's supplied continuation for "run the operation this handler was
 * invoked for" — it is not a fresh top-level call and does not re-enter
 * this handler, so no matter which client instance the caller uses for
 * `query(args)`, no recursion is possible there. The recursion this
 * function actually needs to avoid is `basePrisma.$transaction`/
 * `basePrisma.$executeRaw` being called on the *extended* client instead —
 * `$transaction`/`$executeRaw` are client-level methods, not `$allModels`
 * operations, so they are never intercepted by this extension either way;
 * `basePrisma` is used here regardless, as a second, independent,
 * belt-and-suspenders safeguard against that class of bug (and to keep the
 * set_config/query pair unambiguously scoped to the same known client).
 */
export function createRlsQueryHandler(
  basePrisma: Pick<PrismaClient, '$transaction' | '$executeRaw'>,
): (params: RlsModelOperationArgs) => Promise<unknown> {
  return async ({ model, args, query }) => {
    if (!model || !RLS_PROTECTED_MODELS.has(model)) {
      return query(args);
    }

    const userId = requireCurrentUserId(`Blocked query: model "${model}" is RLS-protected.`);

    // Array-form $transaction — both statements execute sequentially on one
    // connection inside one BEGIN/COMMIT (Prisma's documented batching
    // behavior), which is what makes the `set_config(..., true)` call
    // visible to the query that follows it. `true` (is_local) is mandatory:
    // it scopes the setting to this transaction only, so it is discarded
    // automatically at COMMIT or ROLLBACK and can never survive to the next
    // reuse of a pooled connection — plain `SET`/`set_config(..., false)`
    // would leak across requests under connection pooling and must never be
    // used here.
    const [, result] = await basePrisma.$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`,
      query(args) as Prisma.PrismaPromise<unknown>,
    ]);

    return result;
  };
}

/**
 * Wires `createRlsQueryHandler` into a real Prisma Client Extension, scoped
 * to `$allModels.$allOperations` only — this scope structurally excludes
 * `$queryRaw`/`$executeRaw` (a separate "other operations" branch in
 * Prisma's extension type map) and excludes `$transaction` (a client-level
 * method, not a model/other operation at all), so neither is ever
 * intercepted by this extension, regardless of which client instance calls
 * them.
 */
export function createRlsContextExtension(basePrisma: PrismaClient) {
  const handleModelOperation = createRlsQueryHandler(basePrisma);

  return Prisma.defineExtension({
    name: 'rls-user-context',
    query: {
      $allModels: {
        $allOperations({ model, args, query }) {
          return handleModelOperation({
            model,
            args: args as unknown,
            query: query as (args: unknown) => Promise<unknown>,
          });
        },
      },
    },
  });
}
