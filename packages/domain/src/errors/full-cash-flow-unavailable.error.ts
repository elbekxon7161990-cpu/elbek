export class FullCashFlowUnavailableError extends Error {
  constructor(userId: string, fromCurrency: string, toCurrency: string) {
    super(
      `Cannot compute full cash flow for user "${userId}": no exchange rate available for ${fromCurrency} -> ${toCurrency} for at least one transaction, debt, or repayment in the period (not even a historical fallback). Failing loudly per FR-FIN-043 rather than silently returning an incomplete figure.`,
    );
    this.name = 'FullCashFlowUnavailableError';
  }
}
