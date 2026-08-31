/**
 * TASK-DB-011 — thrown when RLS-protected database access is attempted with
 * no authenticated user id present in the current async context. This must
 * fail *before* any SQL reaches PostgreSQL — never silently proceed with a
 * NULL `app.current_user_id` (which RLS would otherwise turn into a
 * confusing "zero rows"/"insert rejected" result instead of a clear error).
 */
export class MissingDatabaseUserContextError extends Error {
  constructor(detail?: string) {
    super(
      `No authenticated user context is present for this database operation.${detail ? ` ${detail}` : ''}`,
    );
    this.name = 'MissingDatabaseUserContextError';
  }
}
