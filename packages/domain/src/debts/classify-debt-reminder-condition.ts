const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Debt Reminder Producer task — computes the user's own local calendar
 * date (returned as midnight UTC of that day, for stable day-difference
 * arithmetic) from a real instant + IANA timezone. The same "compare in
 * the user's own timezone, never server UTC" discipline BR-EXP-002/
 * BR-FIN-009 already establish elsewhere, applied here to due-date
 * reminder eligibility.
 */
export function toLocalCalendarDate(now: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

export type DebtReminderCondition = 'approaching' | 'overdue' | 'none';

/**
 * FR-DBT-007 — "reminder notification when a debt's due_date is
 * approaching (default: 1 day before, and on the due date itself) and for
 * overdue debts." `dueDate` is a calendar-date-only column (§13.6, no time
 * component); `referenceLocalDate` must already be the user's own local
 * calendar date (`toLocalCalendarDate`'s own output), never server UTC
 * "now" directly — this function performs no timezone conversion of its
 * own, only day-difference arithmetic on two already-normalized dates.
 */
export function classifyDebtReminderCondition(
  dueDate: Date,
  referenceLocalDate: Date,
): DebtReminderCondition {
  const dueDateOnly = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const diffDays = Math.round((dueDateOnly - referenceLocalDate.getTime()) / MS_PER_DAY);

  if (diffDays === 0 || diffDays === 1) {
    return 'approaching';
  }
  if (diffDays < 0) {
    return 'overdue';
  }
  return 'none';
}
