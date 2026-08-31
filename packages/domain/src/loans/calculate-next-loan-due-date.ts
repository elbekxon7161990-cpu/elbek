import type { LoanInstallmentFrequency } from '../entities/loan.entity';

/**
 * TASK-FIN-004 (Stage I, FR-FIN-009) — `installments_per_year`'s sibling
 * concept but for calendar arithmetic rather than a divisor: advances `date`
 * by exactly one installment period. UTC calendar arithmetic throughout
 * (mirrors `toCalendarDateOnly`'s own convention in `savings-goal.entity.ts`)
 * so this never drifts with the server's local timezone.
 *
 * DISCLOSED ENGINEERING DECISION: `monthly`/`quarterly` use JS `Date`'s own
 * `setUTCMonth` semantics for month-length overflow (e.g. Jan 31 + 1 month
 * lands on Mar 3 in a non-leap year, since February has no 31st) — the PRD
 * (§8.8.3) names the three frequencies but gives no due-date formula at all,
 * so there is no requirement to contradict here; this is standard `Date`
 * behavior, not an invented rule, and is covered explicitly by this file's
 * own tests so the behavior is visible, not silently assumed.
 */
function addOneInstallmentPeriod(date: Date, frequency: LoanInstallmentFrequency): Date {
  const next = new Date(date.getTime());
  switch (frequency) {
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      return next;
  }
}

/**
 * TASK-FIN-004 (Stage I, FR-FIN-009) — derived, never-persisted "next due
 * date" for a `/loans` list entry. No DB column, no migration: purely a
 * live calculation over `startDate`/`installmentFrequency`, mirroring the
 * "derived, never a stale cached figure" principle `SavingsGoal.evaluateCompletion`'s
 * own doc comment already states for a different aggregate.
 *
 * CONVENTION (PRD-silent, disclosed): the FIRST installment is due exactly
 * one period AFTER `startDate` — not on `startDate` itself. `startDate` is
 * the loan's origination/disbursement date (§13.20.2), and standard
 * amortization convention is that a payment period elapses before the
 * first payment is owed. Every subsequent due date is one period after the
 * previous one — elapsed installments (due dates strictly before `asOfDate`)
 * are silently skipped, and the first due date on or after `asOfDate` is
 * returned. This function has no opinion on whether any of those skipped
 * installments were ever actually paid — it is a pure calendar calculation,
 * not a payment-history lookup (payment history, if ever needed, is
 * `LoanPayment` rows via `LoanRepository`, not this function's concern).
 */
export function calculateNextLoanDueDate(
  startDate: Date,
  installmentFrequency: LoanInstallmentFrequency,
  asOfDate: Date,
): Date {
  let dueDate = addOneInstallmentPeriod(startDate, installmentFrequency);
  while (dueDate.getTime() < asOfDate.getTime()) {
    dueDate = addOneInstallmentPeriod(dueDate, installmentFrequency);
  }
  return dueDate;
}
