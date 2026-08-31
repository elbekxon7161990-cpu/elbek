/**
 * Thrown when `Loan` invariants (Chapter 8 §8.8.3 validation) are violated
 * at construction or state-transition time. Domain-only — no
 * infrastructure/framework dependency, per @afa/domain's zero-runtime-
 * dependency contract.
 */
export class InvalidLoanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLoanError';
  }
}
