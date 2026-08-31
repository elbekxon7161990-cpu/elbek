/**
 * Thrown when `NewFxRateData` (Chapter 8 §8.13, Chapter 13 §13.8 `fx_rates`)
 * fails validation before being recorded. Domain-only — no infrastructure/
 * framework dependency, per @afa/domain's zero-runtime-dependency contract.
 */
export class InvalidFxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFxRateError';
  }
}
