/**
 * TASK-FIN-007 (Stage G, FR-FIN-043) — "A calculation in §8.14 that cannot
 * complete (e.g., a missing exchange rate with no fallback per FR-FIN-029)
 * must fail loudly... rather than silently returning a zero or null figure
 * that could be mistaken for an accurate 'no activity' result."
 *
 * Thrown by `computeAccountBalance` when a transaction attributed to the
 * account is in a currency other than the account's own, and no exchange
 * rate (not even a historical fallback per FR-FIN-029) exists for that
 * pair as of the transaction's date. The already-computed partial sum is
 * discarded, never returned — an incomplete balance is worse than no
 * balance, since it looks valid.
 */
export class AccountBalanceUnavailableError extends Error {
  constructor(accountId: string, fromCurrency: string, toCurrency: string) {
    super(
      `Cannot compute balance for account "${accountId}": no exchange rate available for ${fromCurrency} -> ${toCurrency} for at least one attributed transaction (not even a historical fallback). Failing loudly per FR-FIN-043 rather than silently returning an incomplete balance.`,
    );
    this.name = 'AccountBalanceUnavailableError';
  }
}
