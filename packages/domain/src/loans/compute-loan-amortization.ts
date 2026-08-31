import {
  divideDecimalAmountByInteger,
  multiplyDecimalAmounts,
  subtractDecimalAmounts,
} from '../entities/decimal-amount';
import type { LoanInstallmentFrequency } from '../entities/loan.entity';

/**
 * TASK-FIN-004 (Stage F, §8.8.3) — standard installments-per-year mapping
 * for the three PRD-permitted frequencies. Not a business-rule invention:
 * this is the only sane numeric meaning "installments_per_year" can have
 * for weekly/monthly/quarterly cadences, the same category of inference
 * `Loan`'s own `LoanInstallmentFrequency` type already relies on (the PRD
 * names the three frequencies but never spells out "52/12/4" — this is
 * standard financial convention, not an invented rule).
 */
export function installmentsPerYearFor(frequency: LoanInstallmentFrequency): number {
  switch (frequency) {
    case 'weekly':
      return 52;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
  }
}

export interface LoanAmortizationInput {
  /** The loan's CURRENT `outstandingBalance` — by construction, this already equals `loan_outstanding_balance(loan, previous_payment_date)`, §8.14.6's own term, since it is kept up to date by every prior payment (or equals `principalAmount` if this is the first payment). No separate historical lookup is needed. */
  outstandingBalance: string;
  /**
   * `null` means interest-free (FR-FIN-007). When provided, a non-negative
   * DECIMAL FRACTION (e.g. `"0.1200"` for 12% annual, `"0.1235"` for
   * 12.35%) — per §13.20.3's explicit column documentation for
   * `loans.interest_rate NUMERIC(6,4)`: "Annual rate as a decimal
   * fraction". See this file's own doc comment below for the correction
   * history.
   */
  interestRate: string | null;
  installmentsPerYear: number;
  paymentAmount: string;
}

/**
 * TASK-FIN-004 (Stage F, §8.14.6) — the ONE shared implementation
 * (FR-FIN-031) of the Debt & Loan Calculation Engine's loan formula:
 *
 * Interest-free: `principal_portion = payment.amount` (full amount reduces
 * principal — §8.14.6's own explicit statement).
 *
 * Interest-bearing: `principal_portion = payment.amount −
 * (outstanding_balance × interest_rate / installments_per_year)` —
 * standard reducing-balance amortization, quoted verbatim from §8.14.6,
 * applied with NO further scaling of `interest_rate` — see below.
 *
 * PURE CALCULATION ONLY — this function has no opinion on whether the
 * result is valid (it can return a negative or an out-of-range value); the
 * three approved Stage F product decisions (overpayment/negative-
 * amortization rejection) are applied by the caller (`Loan.applyPayment`),
 * never here — mirroring the same "pure formula, business rules live in
 * the entity" split `detectNewlyCrossedGoalMilestones` vs.
 * `SavingsGoal.evaluateCompletion` already established in this task.
 *
 * INTEREST-RATE CONVENTION — CORRECTED (TASK-FIN-004 Stage F review
 * checkpoint): the original Stage F implementation read `interest_rate` as
 * a whole-number PERCENTAGE (e.g. `"12.00"` meaning 12%) and divided by
 * 100. That was wrong: §13.20.3 explicitly documents
 * `loans.interest_rate NUMERIC(6,4)` as "Annual rate as a **decimal
 * fraction**" — i.e. `"0.1200"` for 12%, already the value the formula
 * needs, with NO `/100` step. The percentage convention has been fully
 * removed from this function, `Loan.entity.ts`'s validation, and
 * `PrismaLoanRepository.logPayment`'s SQL. (Chapter 8 §8.8.3's own
 * validation-table wording — "a non-negative percentage" — is in tension
 * with §13.20.3's schema-table wording; per explicit product direction,
 * §13.20.3's schema documentation is authoritative for this stored/
 * computed value, since it is the field's literal on-disk representation
 * and the one every consumer (including this formula) must agree with.)
 *
 * `principal_portion` is rounded HALF-UP to 2 decimal places (the
 * `loan_payments.principal_portion` column's own `NUMERIC(18,2)` scale,
 * §13.20.3) — the interest term is computed at intermediate precision and
 * only the final subtraction result is money-scale.
 */
export function computeLoanAmortization(input: LoanAmortizationInput): string {
  if (input.interestRate === null) {
    return input.paymentAmount;
  }
  const balanceTimesRate = multiplyDecimalAmounts(input.outstandingBalance, input.interestRate);
  const interestDue = divideDecimalAmountByInteger(balanceTimesRate, input.installmentsPerYear, 2);
  return subtractDecimalAmounts(input.paymentAmount, interestDue);
}
