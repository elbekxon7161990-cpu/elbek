export const NOTIFICATION_DEDUP_REPOSITORY = Symbol('NOTIFICATION_DEDUP_REPOSITORY');

/**
 * TASK-BOT-009 (FR-NOT-009) — cadence-based dedup for recurring reminder
 * types (debt due/overdue), distinct from FR-NOT-008's threshold-crossing
 * model (Budget-specific, backed by the existing `budget_notification_log`
 * table — not implemented by this task; see this task's final report for
 * why Budget notifications are out of this pass's scope). Backed by
 * querying existing `notifications` rows rather than a new dedicated dedup
 * table, since the information (was this `(userId, type, dedupKey)`
 * notified recently) is already fully reconstructable from that table
 * alone.
 */
export interface NotificationDedupRepository {
  wasRecentlyNotified(
    userId: string,
    type: string,
    dedupKey: string,
    asOf: Date,
    withinMs: number,
  ): Promise<boolean>;
}
