import { describe, expect, it, vi } from 'vitest';
import type {
  RecordDebtReminderEventsSummary,
  RecordDebtReminderEventsUseCase,
} from '@afa/application';

import { DebtReminderScanProcessor } from './debt-reminder-scan.processor';

function fakeUseCase(summary: RecordDebtReminderEventsSummary): RecordDebtReminderEventsUseCase {
  return {
    execute: vi.fn().mockResolvedValue(summary),
  } as unknown as RecordDebtReminderEventsUseCase;
}

describe('DebtReminderScanProcessor', () => {
  it('delegates to RecordDebtReminderEventsUseCase.execute() and returns the aggregate counts', async () => {
    const useCase = fakeUseCase({
      candidatesScanned: 5,
      approachingEmitted: 2,
      overdueEmitted: 1,
      skippedAsDuplicate: 2,
    });
    const processor = new DebtReminderScanProcessor(useCase);

    const result = await processor.process();

    expect(useCase.execute).toHaveBeenCalled();
    expect(result).toEqual({ candidatesScanned: 5, approachingEmitted: 2, overdueEmitted: 1 });
  });

  it('never includes counterparty names or amounts in its log line (Chapter 16 §16.3 data minimization)', async () => {
    const useCase = fakeUseCase({
      candidatesScanned: 1,
      approachingEmitted: 1,
      overdueEmitted: 0,
      skippedAsDuplicate: 0,
    });
    const processor = new DebtReminderScanProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).toHaveBeenCalled();
    const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toMatch(/counterparty|amount|balance/i);
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own outer handling)', async () => {
    const useCase = {
      execute: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as RecordDebtReminderEventsUseCase;
    const processor = new DebtReminderScanProcessor(useCase);

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});
