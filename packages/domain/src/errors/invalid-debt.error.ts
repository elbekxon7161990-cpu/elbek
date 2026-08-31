/**
 * Thrown when `Debt`/`DebtRepayment`/`Counterparty` invariants (Chapter 8
 * §8.3.6 validation, BR-DBT-001/BR-DBT-002) are violated at construction or
 * state-transition time. Domain-only — no infrastructure/framework
 * dependency, per @afa/domain's zero-runtime-dependency contract.
 */
export class InvalidDebtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDebtError';
  }
}
