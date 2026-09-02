/** DI token for @afa/infrastructure's Prisma-backed implementation, same Symbol-token pattern as USER_REPOSITORY. */
export const ADMIN_DASHBOARD_STATS_REPOSITORY = Symbol('ADMIN_DASHBOARD_STATS_REPOSITORY');

/**
 * Admin panel's dashboard summary — user-status counts only. `Transaction`/
 * `Notification` (and every other per-user table) are RLS-protected
 * (`RLS_PROTECTED_MODELS`) with no admin/BYPASSRLS role configured yet — a
 * cross-user aggregate query against them via the app's normal DB role
 * would silently return zero rows (the `tenant_isolation` policy matches
 * `user_id = current_setting('app.current_user_id', true)::uuid`, which is
 * `NULL` — matching nothing — when no per-user context is set), not an
 * error, so a "total transactions" stat could ship silently broken.
 * `User` itself is deliberately NOT RLS-protected (see
 * `rls-protected-models.ts`'s own exclusion list), so status counts are
 * safe today. Extending this to cross-user transaction/notification
 * aggregates needs a real RLS-bypass mechanism first — a separate,
 * deliberate follow-up, not bundled into this pass.
 */
export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  deactivatedUsers: number;
  pendingDeletionUsers: number;
}

/**
 * Its own bounded reporting concern — deliberately not folded into
 * `UserRepository`/`TransactionRepository`/`NotificationRepository`, same
 * "one repository per reporting concern" precedent as
 * `ReportQueryRepository`.
 */
export interface AdminDashboardStatsRepository {
  getStats(): Promise<AdminDashboardStats>;
}
