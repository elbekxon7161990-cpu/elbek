import type { ReportCachePeriod, ReportPeriodType } from '../events/report-cache-period';

export const REPORT_CACHE_REPOSITORY = Symbol('REPORT_CACHE_REPOSITORY');

/**
 * TASK-DB-009 (FR-DB-025, Chapter 13 §13.38.2) — port for the
 * `report:{user_id}:{report_type}:{period_key}` cache key schema.
 * Originally a single, narrow `invalidate` method — TASK-DB-009's own doc
 * comment explained why `get`/`set` were deliberately deferred: "Adding a
 * `set`/`get` method here without a real writer/reader to use them would be
 * speculative CRUD this task's own instructions explicitly forbid." TASK-REP-007
 * is that real writer/reader — `get`/`set` below are the population half of
 * the same cache `invalidate` already targets; `invalidate` itself is
 * UNCHANGED (same signature, same behavior).
 *
 * `invalidate` must be safe to call twice for the same keys (idempotent
 * consumption, `FR-FIN-048`) — a plain Redis `DEL` on an already-deleted key
 * is a no-op by construction, so no additional guard is needed here.
 *
 * `get`/`set` take `(reportType, periodKey)` rather than a serialized key
 * string, so every caller builds keys through the exact same `{user_id}:
 * {report_type}:{period_key}` assembly `invalidate`'s own adapter already
 * uses — no second, independently-typed key-construction path to drift out
 * of sync with it. The stored value is an opaque, already-serialized
 * string — this port has no opinion on report *shape*, only on cache
 * *mechanics*, consistent with `packages/domain` never depending on a
 * specific report's DTO shape.
 */
export interface ReportCacheRepository {
  invalidate(userId: string, periods: ReportCachePeriod[]): Promise<void>;

  get(userId: string, reportType: ReportPeriodType, periodKey: string): Promise<string | null>;

  set(
    userId: string,
    reportType: ReportPeriodType,
    periodKey: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void>;
}
