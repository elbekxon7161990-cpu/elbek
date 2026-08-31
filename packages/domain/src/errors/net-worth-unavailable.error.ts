export class NetWorthUnavailableError extends Error {
  constructor(userId: string, fromCurrency: string, toCurrency: string) {
    super(
      `Cannot compute net worth for user "${userId}": no exchange rate available for ${fromCurrency} -> ${toCurrency} for at least one account (not even a historical fallback). Failing loudly per FR-FIN-043 rather than silently returning an incomplete net worth.`,
    );
    this.name = 'NetWorthUnavailableError';
  }
}
