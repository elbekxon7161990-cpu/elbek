import type { CurrencyRepository, FxRateProvider, FxRateRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IngestFxRatesUseCase } from './ingest-fx-rates.use-case';

describe('IngestFxRatesUseCase', () => {
  let currencyRepository: { listActiveCodes: ReturnType<typeof vi.fn> };
  let fxRateProvider: { fetchRates: ReturnType<typeof vi.fn> };
  let fxRateRepository: { recordRate: ReturnType<typeof vi.fn> };
  let useCase: IngestFxRatesUseCase;

  beforeEach(() => {
    currencyRepository = { listActiveCodes: vi.fn().mockResolvedValue(['UZS', 'USD', 'EUR']) };
    fxRateProvider = {
      fetchRates: vi
        .fn()
        .mockImplementation((_base: string, quotes: string[]) =>
          Promise.resolve(quotes.map((quoteCurrency) => ({ quoteCurrency, rate: '1.5' }))),
        ),
    };
    fxRateRepository = { recordRate: vi.fn().mockResolvedValue(undefined) };

    useCase = new IngestFxRatesUseCase(
      currencyRepository as unknown as CurrencyRepository,
      fxRateProvider as unknown as FxRateProvider,
      fxRateRepository as unknown as FxRateRepository,
    );
  });

  it('fetches rates for every active currency as a base, quoting every OTHER active currency (FR-INT-003)', async () => {
    const summary = await useCase.execute(new Date('2026-08-17T10:00:00Z'));

    expect(fxRateProvider.fetchRates).toHaveBeenCalledWith('UZS', ['USD', 'EUR']);
    expect(fxRateProvider.fetchRates).toHaveBeenCalledWith('USD', ['UZS', 'EUR']);
    expect(fxRateProvider.fetchRates).toHaveBeenCalledWith('EUR', ['UZS', 'USD']);
    expect(summary.basesAttempted).toBe(3);
    expect(summary.basesSucceeded).toBe(3);
    expect(summary.ratesUpserted).toBe(6); // 3 bases * 2 quotes each
    expect(summary.failures).toEqual([]);
  });

  it('persists each quote via FxRateRepository.recordRate with the correct asOfDate (calendar-date-only, FR-FIN-028)', async () => {
    await useCase.execute(new Date('2026-08-17T23:45:00Z'));

    expect(fxRateRepository.recordRate).toHaveBeenCalledWith({
      baseCurrency: 'UZS',
      quoteCurrency: 'USD',
      rate: '1.5',
      asOfDate: new Date('2026-08-17T00:00:00.000Z'),
      source: 'daily-ingestion',
    });
  });

  it('defaults asOfDate to "now" when omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'));
    try {
      const summary = await useCase.execute();
      expect(summary.asOfDate).toEqual(new Date('2026-08-17T00:00:00.000Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent: recordRate is the sole write path, and its own upsert (Stage C) handles repeats — this use case never checks for existing rows itself', async () => {
    await useCase.execute(new Date('2026-08-17'));
    await useCase.execute(new Date('2026-08-17'));

    expect(fxRateRepository.recordRate).toHaveBeenCalledTimes(12); // 6 quotes * 2 runs, both attempted
  });

  it('FR-INT-002 — a provider failure for one base does not block ingestion for the others (partial-success degradation)', async () => {
    fxRateProvider.fetchRates.mockImplementation((base: string, quotes: string[]) => {
      if (base === 'USD') {
        return Promise.reject(new Error('provider unavailable'));
      }
      return Promise.resolve(quotes.map((quoteCurrency) => ({ quoteCurrency, rate: '1.5' })));
    });

    const summary = await useCase.execute(new Date('2026-08-17'));

    expect(summary.basesAttempted).toBe(3);
    expect(summary.basesSucceeded).toBe(2);
    expect(summary.failures).toEqual([{ baseCurrency: 'USD', error: 'provider unavailable' }]);
    // UZS and EUR still each fetched and persisted their 2 quotes.
    expect(summary.ratesUpserted).toBe(4);
  });

  it('never throws out of execute() even when every base fails', async () => {
    fxRateProvider.fetchRates.mockRejectedValue(new Error('total outage'));

    const summary = await useCase.execute(new Date('2026-08-17'));

    expect(summary.basesSucceeded).toBe(0);
    expect(summary.ratesUpserted).toBe(0);
    expect(summary.failures).toHaveLength(3);
  });

  it('skips a base with no other active currencies to quote against, without calling the provider', async () => {
    currencyRepository.listActiveCodes.mockResolvedValue(['UZS']);

    const summary = await useCase.execute(new Date('2026-08-17'));

    expect(fxRateProvider.fetchRates).not.toHaveBeenCalled();
    expect(summary.basesAttempted).toBe(1);
    expect(summary.basesSucceeded).toBe(0);
    expect(summary.ratesUpserted).toBe(0);
  });

  it('handles a non-Error rejection gracefully, stringifying it into the failure record', async () => {
    fxRateProvider.fetchRates.mockImplementation((base: string) => {
      if (base === 'UZS') {
        return Promise.reject('a plain string rejection');
      }
      return Promise.resolve([]);
    });

    const summary = await useCase.execute(new Date('2026-08-17'));

    expect(summary.failures).toContainEqual({
      baseCurrency: 'UZS',
      error: 'a plain string rejection',
    });
  });
});
