/**
 * TASK-FIN-004 Stage F product decision (OVERPAYMENT = REJECT) — unlike
 * `DebtOverpaymentError` (which drives Debt's confirm-to-cap UX flow), this
 * is a hard rejection: a `LOAN_PAYMENT` whose computed `principal_portion`
 * would exceed the loan's `outstandingBalance` is rejected outright. No
 * clamping, no confirmation flow — the caller must resubmit with a smaller
 * amount.
 */
export class LoanOverpaymentError extends Error {
  constructor(
    readonly loanId: string,
    readonly attemptedAmount: string,
    readonly computedPrincipalPortion: string,
    readonly outstandingBalance: string,
  ) {
    super(
      `Payment "${attemptedAmount}" for loan "${loanId}" would reduce the principal by "${computedPrincipalPortion}", exceeding the outstanding balance "${outstandingBalance}". Rejected per the approved OVERPAYMENT = REJECT decision — never clamped, never silently applied.`,
    );
    this.name = 'LoanOverpaymentError';
  }
}
