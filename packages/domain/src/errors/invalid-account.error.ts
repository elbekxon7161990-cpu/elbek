/**
 * Thrown when `Account` invariants (Chapter 8 §8.12.3 validation) are
 * violated at construction time. Domain-only — no infrastructure/framework
 * dependency, per @afa/domain's zero-runtime-dependency contract.
 */
export class InvalidAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccountError';
  }
}
