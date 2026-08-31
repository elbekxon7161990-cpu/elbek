/**
 * DI token for @afa/infrastructure's implementation (a later part), same
 * Symbol-token pattern as USER_REPOSITORY.
 */
export const CURRENCY_REPOSITORY = Symbol('CURRENCY_REPOSITORY');

/**
 * Port (Chapter 3 §3.3.9 hexagonal boundary). FR-EXP-003 — "unsupported
 * currencies trigger clarification, never silent coercion". `isSupported`
 * collapses `currencies` table existence + `is_active` (§13.8) into the one
 * boolean the use case actually needs; it never exposes the row shape.
 */
export interface CurrencyRepository {
  isSupported(code: string): Promise<boolean>;

  /**
   * TASK-FIN-007 (Stage F, FR-INT-003) — every active currency's code, no
   * particular order. The one caller (`IngestFxRatesUseCase`) needs this to
   * know which currency pairs to refresh daily; no other consumer of this
   * port needs it, so this is additive — every existing caller of
   * `isSupported` is unaffected.
   */
  listActiveCodes(): Promise<string[]>;
}
