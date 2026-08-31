import { describe, expect, it, vi } from 'vitest';
import type { IngestFxRatesSummary, IngestFxRatesUseCase } from '@afa/application';

import { FxRateIngestionProcessor } from './fx-rate-ingestion.processor';

function fakeUseCase(summary: IngestFxRatesSummary): IngestFxRatesUseCase {
  return {
    execute: vi.fn().mockResolvedValue(summary),
  } as unknown as IngestFxRatesUseCase;
}

describe('FxRateIngestionProcessor', () => {
  it('delegates to IngestFxRatesUseCase.execute() and returns the aggregate counts', async () => {
    const useCase = fakeUseCase({
      asOfDate: new Date('2026-08-17'),
      basesAttempted: 5,
      basesSucceeded: 5,
      ratesUpserted: 20,
      failures: [],
    });
    const processor = new FxRateIngestionProcessor(useCase);

    const result = await processor.process();

    expect(useCase.execute).toHaveBeenCalled();
    expect(result).toEqual({ basesAttempted: 5, basesSucceeded: 5, ratesUpserted: 20 });
  });

  it('logs a warning (not an error) when some bases failed — a partial success is not itself a processor failure', async () => {
    const useCase = fakeUseCase({
      asOfDate: new Date('2026-08-17'),
      basesAttempted: 5,
      basesSucceeded: 4,
      ratesUpserted: 16,
      failures: [{ baseCurrency: 'EUR', error: 'timeout' }],
    });
    const processor = new FxRateIngestionProcessor(useCase);
    const warnSpy = vi.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);

    const result = await processor.process();

    expect(warnSpy).toHaveBeenCalled();
    expect(result.basesSucceeded).toBe(4);
  });

  it('never includes individual rate values in its log line', async () => {
    const useCase = fakeUseCase({
      asOfDate: new Date('2026-08-17'),
      basesAttempted: 1,
      basesSucceeded: 1,
      ratesUpserted: 1,
      failures: [],
    });
    const processor = new FxRateIngestionProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toMatch(/\d+\.\d{2,}/); // no decimal rate value shape
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own outer handling)', async () => {
    const useCase = {
      execute: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as IngestFxRatesUseCase;
    const processor = new FxRateIngestionProcessor(useCase);

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});
