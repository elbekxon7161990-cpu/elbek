import type { FxRateRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangeRateUnavailableError } from '../errors/exchange-rate-unavailable.error';
import { resolveTransactionExchangeRate } from './resolve-transaction-exchange-rate';

describe('resolveTransactionExchangeRate', () => {
  let fxRateRepository: { findRate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fxRateRepository = { findRate: vi.fn() };
  });

  it('returns "1" for a same-currency transaction, never calling FxRateRepository', async () => {
    const result = await resolveTransactionExchangeRate(
      fxRateRepository as unknown as FxRateRepository,
      'UZS',
      'UZS',
      new Date('2026-08-01'),
    );

    expect(result).toBe('1');
    expect(fxRateRepository.findRate).not.toHaveBeenCalled();
  });

  it('returns the exact-date rate for a cross-currency transaction (FR-FIN-027)', async () => {
    fxRateRepository.findRate.mockResolvedValue({
      rate: '12500.75',
      asOfDate: new Date('2026-08-01'),
      isApproximate: false,
    });

    const result = await resolveTransactionExchangeRate(
      fxRateRepository as unknown as FxRateRepository,
      'USD',
      'UZS',
      new Date('2026-08-01'),
    );

    expect(fxRateRepository.findRate).toHaveBeenCalledWith('USD', 'UZS', new Date('2026-08-01'));
    expect(result).toBe('12500.75');
  });

  it('accepts an approximate (prior-date-fallback) rate, storing it exactly as returned (FR-FIN-029)', async () => {
    fxRateRepository.findRate.mockResolvedValue({
      rate: '12000.00',
      asOfDate: new Date('2026-07-28'),
      isApproximate: true,
    });

    const result = await resolveTransactionExchangeRate(
      fxRateRepository as unknown as FxRateRepository,
      'USD',
      'UZS',
      new Date('2026-08-01'),
    );

    expect(result).toBe('12000.00');
  });

  it('looks up the rate as of the transaction date, not "now" (BR-FIN-006)', async () => {
    fxRateRepository.findRate.mockResolvedValue({
      rate: '11000.00',
      asOfDate: new Date('2026-01-10'),
      isApproximate: false,
    });

    await resolveTransactionExchangeRate(
      fxRateRepository as unknown as FxRateRepository,
      'USD',
      'UZS',
      new Date('2026-01-10'),
    );

    expect(fxRateRepository.findRate).toHaveBeenCalledWith('USD', 'UZS', new Date('2026-01-10'));
  });

  it('throws ExchangeRateUnavailableError when no rate exists at all for the pair', async () => {
    fxRateRepository.findRate.mockResolvedValue(null);

    await expect(
      resolveTransactionExchangeRate(
        fxRateRepository as unknown as FxRateRepository,
        'USD',
        'UZS',
        new Date('2026-08-01'),
      ),
    ).rejects.toThrow(ExchangeRateUnavailableError);
  });
});
