const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * TASK-REP-001 (remaining scope, §9.1.4 Debt Summary Report — "aging (how
 * overdue)"). PRD gives no numerical aging-bucket scheme (no "0-30/31-60"
 * table anywhere in §9.1 or §8.3) — the simplest representation compatible
 * with the existing codebase is a plain day count, mirroring
 * `classifyDebtReminderCondition`'s own UTC-calendar-date-truncation
 * convention (`dueDate` is a calendar-date-only column, §13.6) rather than
 * that function's own categorical 'approaching'/'overdue'/'none' output,
 * which does not expose a numeric count. A documented judgment call, not an
 * invented aging system.
 *
 * `null` when there is no due date, or the due date has not yet passed
 * (never a negative "overdue by -3 days").
 */
export function computeDebtOverdueDays(dueDate: Date | null, asOf: Date): number | null {
  if (dueDate === null) {
    return null;
  }
  const dueDateOnly = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const asOfOnly = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const diffDays = Math.round((asOfOnly - dueDateOnly) / MS_PER_DAY);
  return diffDays > 0 ? diffDays : null;
}
