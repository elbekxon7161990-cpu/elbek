import { AsyncLocalStorage } from 'node:async_hooks';

import { MissingDatabaseUserContextError } from './missing-database-user-context.error';

/**
 * TASK-DB-011 — the value propagated from a trusted, already-authenticated
 * entry point (Telegram middleware, a future API guard, a worker job
 * handler) down to wherever a database call actually happens, so Postgres
 * RLS policies (`current_setting('app.current_user_id', true)`) receive the
 * correct value without every call site threading a `userId` parameter
 * through every function signature in between.
 */
export interface UserContext {
  readonly userId: string;
}

/**
 * A single, module-scoped `AsyncLocalStorage` instance — this is *not* the
 * kind of "global mutable variable" this task's security requirements rule
 * out. `AsyncLocalStorage` itself holds no per-request state; it is a
 * stateless dispatcher into Node's internal async-context machinery, which
 * is what actually isolates each call chain's `{ userId }` from every
 * other's, including concurrent ones. Sharing one instance across the
 * process (rather than constructing a new one per request) is the correct,
 * documented way to use this API — creating a fresh `AsyncLocalStorage` per
 * request would not scope anything more tightly and would just leak memory.
 */
const userContextStorage = new AsyncLocalStorage<UserContext>();

/**
 * Runs `fn` (and everything it awaits, transitively, including across
 * Promise chains and further nested async calls) with `userId` established
 * as the current user context. Every trusted entry point (Telegram's
 * `bot.use()` middleware today; a future NestJS guard/interceptor for
 * `apps/api`; a worker job handler reading `job.data.userId`) must call this
 * exactly once, as early as possible, wrapping all downstream processing.
 */
export function runWithUserContext<T>(userId: string, fn: () => T): T {
  if (!userId) {
    throw new Error(
      'runWithUserContext requires a non-empty userId — refusing to establish an empty context.',
    );
  }
  return userContextStorage.run({ userId }, fn);
}

/** Returns the current context's user id, or `undefined` if none is established. Never throws. */
export function getCurrentUserId(): string | undefined {
  return userContextStorage.getStore()?.userId;
}

/**
 * Returns the current context's user id, or throws `MissingDatabaseUserContextError`
 * if none is established. This is the check the Prisma RLS extension uses —
 * fail loud, before any query reaches PostgreSQL, rather than letting RLS
 * silently return zero rows / reject an insert for a NULL session variable.
 */
export function requireCurrentUserId(detail?: string): string {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new MissingDatabaseUserContextError(detail);
  }
  return userId;
}
