import { describe, expect, it, vi } from 'vitest';
import type { PurgeExpiredAccountsSummary, PurgeExpiredAccountsUseCase } from '@afa/application';

import { AccountPurgeProcessor } from './account-purge.processor';

function fakeUseCase(summary: PurgeExpiredAccountsSummary): PurgeExpiredAccountsUseCase {
  return {
    execute: vi.fn().mockResolvedValue(summary),
  } as unknown as PurgeExpiredAccountsUseCase;
}

describe('AccountPurgeProcessor', () => {
  it('delegates to PurgeExpiredAccountsUseCase.execute() and returns the aggregate counts', async () => {
    const useCase = fakeUseCase({ candidateCount: 3, purgedCount: 2, storageFailureCount: 1 });
    const processor = new AccountPurgeProcessor(useCase);

    const result = await processor.process();

    expect(useCase.execute).toHaveBeenCalled();
    expect(result).toEqual({ candidateCount: 3, purgedCount: 2, storageFailureCount: 1 });
  });

  it('never includes per-user detail (user id, telegram id) in its log line (Chapter 16 §16.3 data minimization)', async () => {
    const useCase = fakeUseCase({ candidateCount: 1, purgedCount: 1, storageFailureCount: 0 });
    const processor = new AccountPurgeProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).toHaveBeenCalled();
    const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('does not log when there are no candidates', async () => {
    const useCase = fakeUseCase({ candidateCount: 0, purgedCount: 0, storageFailureCount: 0 });
    const processor = new AccountPurgeProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('propagates an unexpected error from the use case (letting BullMQ apply its own outer handling)', async () => {
    const useCase = {
      execute: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as PurgeExpiredAccountsUseCase;
    const processor = new AccountPurgeProcessor(useCase);

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});
