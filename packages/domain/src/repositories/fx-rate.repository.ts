export const FX_RATE_REPOSITORY = Symbol('FX_RATE_REPOSITORY');

export interface NewFxRateData {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  asOfDate: Date;
  source?: string | null;
}

/**
 * FR-FIN-029's own fallback outcome — `asOfDate` here is the rate's REAL
 * date, which may be earlier than the date requested; `isApproximate` is
 * `true` exactly when it is, so the caller can "flag the figure as
 * approximate in any downstream display, never silently substituting a
 * rate for a different date without disclosure."
 */
export interface FxRateLookupResult {
  rate: string;
  asOfDate: Date;
  isApproximate: boolean;
}

/**
 * TASK-FIN-007 (Stage C, Chapter 8 §8.13, Chapter 13 §13.8 `fx_rates`,
 * FR-INT-001/003) — port for the `fx_rates` reference table. Deliberately
 * NOT a domain entity/aggregate the way `Debt`/`Budget`/`Account` are —
 * `fx_rates` is pure reference data with no user-facing lifecycle (no
 * "CreateFxRateUseCase" exists anywhere in this task's own scope; Stage F's
 * ingestion job is this port's only writer) — mirroring `CurrencyRepository`'s
 * own minimal-port style rather than the full Entity+Repository pattern.
 * Write-time validation lives in the pure `validateNewFxRateData` function
 * instead of an entity's own `validate()`, for the same reason.
 *
 * Only ever consulted for a genuinely cross-currency pair
 * (`baseCurrency !== quoteCurrency`) — a same-currency snapshot is always
 * exactly `'1'`, computed by the caller (`CreateExpenseUseCase`/
 * `CreateIncomeUseCase`, Stage E) without ever calling this port.
 */
export interface FxRateRepository {
  /**
   * FR-FIN-028/029 — "source exchange rates from a maintained daily-
   * updated reference table... If no exchange rate exists for a requested
   * currency pair on the requested date, use the most recent available
   * rate PRIOR to that date." Returns `null` only when NO rate exists for
   * this pair on or before `asOfDate` at all — never fabricates one.
   */
  findRate(
    baseCurrency: string,
    quoteCurrency: string,
    asOfDate: Date,
  ): Promise<FxRateLookupResult | null>;

  /**
   * FR-INT-003 — the daily-ingestion write path (Stage F's own caller).
   * Idempotent: re-recording the same `(baseCurrency, quoteCurrency,
   * asOfDate)` triple (e.g. a retried job) updates the rate value rather
   * than erroring or duplicating, per the `fx_rates` table's own real,
   * Prisma-declared `@@unique([baseCurrency, quoteCurrency, asOfDate])` —
   * unlike `Budget`'s/`Account`'s own partial-index constraints, this one
   * IS expressible as a Prisma `@@unique`, so the adapter can use a plain
   * `upsert()`, no P2002-catch-and-reread needed.
   */
  recordRate(data: NewFxRateData): Promise<void>;
}
