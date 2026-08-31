/**
 * Thrown when `CustomCategory` invariants (Chapter 7 §7.4.5 FR-SET-003,
 * §7.4.6 BR-SET-001, Chapter 8 §8.11.2 FR-FIN-018) are violated at
 * construction time. Domain-only — no infrastructure/framework dependency,
 * per @afa/domain's zero-runtime-dependency contract.
 */
export class InvalidCustomCategoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCustomCategoryError';
  }
}
