/**
 * TASK-DB-009 (FR-DB-025, Chapter 13 §13.38.2/§13.38.3) — pure period-key
 * derivation for the `report:{user_id}:{report_type}:{period_key}` cache
 * key schema. No I/O, no Redis/Prisma dependency — this is exactly the kind
 * of pure logic this layer already hosts (`evaluateLargeAmountSanityCheck`,
 * `resolveReplyLanguage`).
 *
 * **Scope decision, explicitly recorded**: §9.1.4's report-type inventory
 * lists 11 report types (Daily/Weekly/Monthly/Quarterly/Yearly/Category/
 * Merchant/Custom Range/Trend Analysis/Cash Flow/Debt Summary), but only
 * five of them — Daily/Weekly/Monthly/Quarterly/Yearly — are literal
 * calendar periods a transaction date can be said to "fall within" in the
 * sense FR-DB-025 uses. §9.1.7's own caching-strategy table only ever talks
 * about "Daily/Weekly/Monthly (current)" vs. "Historical (closed prior
 * periods)" — never Category/Merchant/Custom/Trend/Cash-Flow/Debt reports,
 * which are scoped by an *additional* dimension (a category id, a merchant
 * name, an arbitrary range) that a bare `period_key` string cannot encode
 * uniformly, and which §9.1.7 never says are cached at all. Invalidating
 * only the five calendar-period buckets is therefore the smallest
 * defensible reading of FR-DB-025's "period" wording, not a guess — see
 * this task's final report §6/§14 for the full reasoning and the resulting
 * gap (a Category/Merchant report cache, if one is ever added, would need
 * its own invalidation rule this task does not — and per its own scope,
 * should not — invent).
 *
 * Computed in UTC calendar terms from the stored `transaction_date`, not the
 * owning user's local timezone (unavailable in a domain-event payload
 * without an extra read, which would violate FR-DB-015's "consumer stays
 * fast, no additional retry/backoff/lookup" assumption) — a disclosed,
 * bounded limitation: over-invalidating a neighboring period near a day
 * boundary is harmless (one extra cache miss, recomputed live per FR-REP-002
 * either way); under-invalidating is the failure mode that would matter, and
 * does not occur here since UTC-vs-local-timezone disagreement can only ever
 * shift which side of a boundary a date falls on, never which values get
 * computed for whichever side it lands on.
 */
export type ReportPeriodType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface ReportCachePeriod {
  readonly reportType: ReportPeriodType;
  readonly periodKey: string;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function toDailyPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function toMonthlyPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function toQuarterlyPeriodKey(date: Date): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

function toYearlyPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}`;
}

/** Standard ISO 8601 week-numbering algorithm (Monday-start weeks, week 1 = the week containing the year's first Thursday). */
function toWeeklyPeriodKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDayNumber = (target.getUTCDay() + 6) % 7; // Monday=0 .. Sunday=6
  target.setUTCDate(target.getUTCDate() - isoDayNumber + 3); // shift to this week's Thursday

  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstIsoDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIsoDayNumber + 3);

  const weekNumber =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return `${isoYear}-W${pad2(weekNumber)}`;
}

/** All five calendar periods a given date falls within — the full invalidation set FR-DB-025 requires for one date. */
export function computeReportCachePeriods(date: Date): ReportCachePeriod[] {
  return [
    { reportType: 'daily', periodKey: toDailyPeriodKey(date) },
    { reportType: 'weekly', periodKey: toWeeklyPeriodKey(date) },
    { reportType: 'monthly', periodKey: toMonthlyPeriodKey(date) },
    { reportType: 'quarterly', periodKey: toQuarterlyPeriodKey(date) },
    { reportType: 'yearly', periodKey: toYearlyPeriodKey(date) },
  ];
}

/** Collapses duplicate (reportType, periodKey) pairs — relevant when an edit's previous/new dates fall in the same period, so the same key isn't deleted twice for no reason. */
export function dedupeReportCachePeriods(periods: ReportCachePeriod[]): ReportCachePeriod[] {
  const seen = new Set<string>();
  const result: ReportCachePeriod[] = [];
  for (const period of periods) {
    const key = `${period.reportType}:${period.periodKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(period);
    }
  }
  return result;
}
