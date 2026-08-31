/**
 * Thrown when `SavingsGoal` invariants (Chapter 8 §8.9.4 validation) are
 * violated at construction or state-transition time. Domain-only — no
 * infrastructure/framework dependency, per @afa/domain's zero-runtime-
 * dependency contract.
 */
export class InvalidSavingsGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSavingsGoalError';
  }
}
