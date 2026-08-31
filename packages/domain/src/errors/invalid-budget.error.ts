/**
 * Thrown when `Budget` invariants (Chapter 8 §8.4.6 validation, FR-BUD-001)
 * are violated at construction time. Domain-only — no infrastructure/
 * framework dependency, per @afa/domain's zero-runtime-dependency contract.
 */
export class InvalidBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBudgetError';
  }
}
