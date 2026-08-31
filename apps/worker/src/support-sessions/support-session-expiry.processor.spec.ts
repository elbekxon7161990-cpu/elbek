import { describe, expect, it, vi } from 'vitest';
import type { ExpireSupportSessionsResult, ExpireSupportSessionsUseCase } from '@afa/application';

import { SupportSessionExpiryProcessor } from './support-session-expiry.processor';

function fakeUseCase(result: ExpireSupportSessionsResult): ExpireSupportSessionsUseCase {
  return { execute: vi.fn().mockResolvedValue(result) } as unknown as ExpireSupportSessionsUseCase;
}

describe('SupportSessionExpiryProcessor', () => {
  it('delegates to ExpireSupportSessionsUseCase.execute() and returns the aggregate count', async () => {
    const useCase = fakeUseCase({ expiredCount: 2 });
    const processor = new SupportSessionExpiryProcessor(useCase);

    const result = await processor.process();

    expect(useCase.execute).toHaveBeenCalled();
    expect(result).toEqual({ expiredCount: 2 });
  });

  it('does not log when nothing expired', async () => {
    const useCase = fakeUseCase({ expiredCount: 0 });
    const processor = new SupportSessionExpiryProcessor(useCase);
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);

    await processor.process();

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('propagates an unexpected error from the use case', async () => {
    const useCase = {
      execute: vi.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as ExpireSupportSessionsUseCase;
    const processor = new SupportSessionExpiryProcessor(useCase);

    await expect(processor.process()).rejects.toThrow('db unavailable');
  });
});
