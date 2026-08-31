export class CashFlowUnavailableError extends Error {
  constructor(userId: string, fromCurrency: string, toCurrency: string) {
    super(
      `Cannot compute net cash flow for user "${userId}": no exchange rate available for ${fromCurrency} -> ${toCurrency} for at least one transaction in the period (not even a historical fallback). Failing loudly per FR-FIN-043 rather than silently returning an incomplete figure.`,
    );
    this.name = 'CashFlowUnavailableError';
  }
}
