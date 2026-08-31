/**
 * BR-DBT-001 — "outstanding_balance must never go negative; overpayment
 * requires explicit confirmation." Thrown by `Debt.applyRepayment` instead
 * of `InvalidDebtError` so the application layer can distinguish "this
 * repayment amount is genuinely invalid" from "this amount is valid but
 * exceeds the outstanding balance, and needs the user's explicit
 * confirmation before being applied" — the caller catches this one
 * specifically to drive that confirmation flow, never to reject outright.
 */
export class DebtOverpaymentError extends Error {
  constructor(
    readonly debtId: string,
    readonly attemptedAmount: string,
    readonly outstandingBalance: string,
  ) {
    super(
      `Repayment amount "${attemptedAmount}" exceeds outstanding balance "${outstandingBalance}" for debt "${debtId}".`,
    );
    this.name = 'DebtOverpaymentError';
  }
}
