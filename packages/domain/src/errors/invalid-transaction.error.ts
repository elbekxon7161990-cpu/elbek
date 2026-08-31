/**
 * Thrown when `Transaction` invariants (Chapter 8 §8.1.6/§8.2.6 validation,
 * BR-EXP-002) are violated at construction or state-transition time.
 * Domain-only — no infrastructure/framework dependency, per @afa/domain's
 * zero-runtime-dependency contract.
 */
export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionError';
  }
}
