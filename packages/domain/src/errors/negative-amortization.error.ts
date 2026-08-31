/**
 * TASK-FIN-004 Stage F product decision (NEGATIVE AMORTIZATION = REJECT) —
 * for an interest-bearing loan, §8.14.6's own formula
 * (`principal_portion = payment.amount − interest_due`) can go negative
 * when the payment doesn't even cover the interest portion due. Per the
 * approved decision, this is rejected outright rather than allowed to
 * increase `outstandingBalance` or silently clamped to zero.
 */
export class NegativeAmortizationError extends Error {
  constructor(
    readonly loanId: string,
    readonly attemptedAmount: string,
    readonly computedPrincipalPortion: string,
  ) {
    super(
      `Payment "${attemptedAmount}" for loan "${loanId}" does not cover the interest portion due — computed principal_portion "${computedPrincipalPortion}" is negative. Rejected per the approved NEGATIVE AMORTIZATION = REJECT decision — outstanding_balance is never allowed to increase, principal_portion is never clamped to zero.`,
    );
    this.name = 'NegativeAmortizationError';
  }
}
