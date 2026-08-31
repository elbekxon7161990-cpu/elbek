import type { BudgetPeriodType } from '../entities/budget.entity';

/**
 * TASK-FIN-003 (§8.4.4 FR-BUD-003 — "reset the 'used' tracking to zero at
 * each period boundary (in the user's timezone)"). Both fields are
 * calendar-date-only (midnight UTC-normalized, the same representation
 * `toLocalCalendarDate` and `Debt.dueDate` already use) — callers are
 * responsible for having already resolved `referenceLocalDate` to the
 * user's own local calendar date (via `toLocalCalendarDate`) before calling
 * this function; it performs no timezone conversion of its own, only
 * calendar arithmetic on an already-normalized date, the same split
 * `classifyDebtReminderCondition` already established.
 *
 * Week start: Monday (ISO 8601) — the PRD does not state a week-start-day
 * default anywhere in §8.4 or elsewhere; ISO 8601 is the disclosed,
 * documented judgment call made here, consistent with this system's
 * UZ/RU/EN locale mix (all three use a Monday-start week convention).
 */
export interface BudgetPeriodBoundaries {
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

function startOfIsoWeek(date: Date): Date {
  const dayOfWeek = date.getUTCDay(); // 0=Sunday..6=Saturday
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = new Date(date.getTime());
  start.setUTCDate(start.getUTCDate() - diffToMonday);
  return start;
}

function lastDayOfUtcMonth(year: number, monthIndex: number): Date {
  // Day 0 of the *next* month is the last day of `monthIndex`.
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

/** Computes the period `(currentPeriodStart, currentPeriodEnd)` — both inclusive — containing `referenceLocalDate`, per `periodType`'s own calendar alignment. */
export function computeBudgetPeriodBoundaries(
  referenceLocalDate: Date,
  periodType: BudgetPeriodType,
): BudgetPeriodBoundaries {
  const year = referenceLocalDate.getUTCFullYear();
  const month = referenceLocalDate.getUTCMonth();

  switch (periodType) {
    case 'weekly': {
      const currentPeriodStart = startOfIsoWeek(referenceLocalDate);
      const currentPeriodEnd = new Date(currentPeriodStart.getTime());
      currentPeriodEnd.setUTCDate(currentPeriodEnd.getUTCDate() + 6);
      return { currentPeriodStart, currentPeriodEnd };
    }
    case 'monthly': {
      return {
        currentPeriodStart: new Date(Date.UTC(year, month, 1)),
        currentPeriodEnd: lastDayOfUtcMonth(year, month),
      };
    }
    case 'quarterly': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        currentPeriodStart: new Date(Date.UTC(year, quarterStartMonth, 1)),
        currentPeriodEnd: lastDayOfUtcMonth(year, quarterStartMonth + 2),
      };
    }
    case 'yearly': {
      return {
        currentPeriodStart: new Date(Date.UTC(year, 0, 1)),
        currentPeriodEnd: new Date(Date.UTC(year, 11, 31)),
      };
    }
  }
}

/**
 * FR-BUD-003 — "automatically recur a budget for the next period upon
 * period rollover... reset the 'used' tracking to zero at each period
 * boundary." The next period always starts the calendar day immediately
 * after `currentPeriodEnd` — never computed independently from "now", so a
 * rollover job that runs late (e.g. a retried batch, §8.4.7's own error
 * handling) still produces the mathematically correct next period rather
 * than one skewed by how late the job happened to run.
 */
export function computeNextBudgetPeriodBoundaries(
  currentPeriodEnd: Date,
  periodType: BudgetPeriodType,
): BudgetPeriodBoundaries {
  const nextPeriodStart = new Date(currentPeriodEnd.getTime());
  nextPeriodStart.setUTCDate(nextPeriodStart.getUTCDate() + 1);
  return computeBudgetPeriodBoundaries(nextPeriodStart, periodType);
}
