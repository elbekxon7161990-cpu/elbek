/**
 * DI token for @afa/infrastructure's implementation. No real vendor is
 * named anywhere in the PRD (Chapter 18 §18.1 lists "Foreign Exchange (FX)
 * Rate Provider" with no vendor, unlike the LLM row's "e.g., Claude/
 * Anthropic") — this port and its fake test double are all TASK-FIN-007
 * Stage F builds; the first real binding is a future task's job, exactly
 * mirroring how `LLM_PROVIDER` (TASK-INFRA-010) predated its own first real
 * binding (TASK-INFRA-AI-REAL-001).
 */
export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

export interface FxRateQuote {
  quoteCurrency: string;
  /** Canonical decimal string — "1 baseCurrency = rate quoteCurrency", the same convention `FxRateRepository.findRate`'s own result already uses. */
  rate: string;
}

/**
 * Port (Chapter 3 §3.16.1 Shared Adapter Pattern, FR-INT-001) — one base
 * currency, many quote currencies per call, matching how real FX batch-
 * quote APIs are actually shaped (a single request returns a full rate
 * table for one base). Implemented by packages/infrastructure;
 * `IngestFxRatesUseCase` (`@afa/application`) depends only on this
 * interface, never on a vendor SDK.
 *
 * Deliberately no error-subclass hierarchy like `LlmProvider`'s own — that
 * richness exists there for TASK-AI-003's retry-differentiation needs; FX
 * ingestion is an infrequent (daily) batch call with no `Retrying`/
 * `CircuitBreaker` decorator wrapping it (nothing to protect yet — see this
 * stage's own report), so a plain thrown `Error` is all a caller needs to
 * distinguish "this base's rates are unavailable right now."
 */
export interface FxRateProvider {
  fetchRates(baseCurrency: string, quoteCurrencies: string[]): Promise<FxRateQuote[]>;
}
