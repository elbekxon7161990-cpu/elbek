import type { SupportSessionRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpireSupportSessionsUseCase } from './expire-support-sessions.use-case';

describe('ExpireSupportSessionsUseCase', () => {
  let sessions: { expireDueSessions: ReturnType<typeof vi.fn> };
  let useCase: ExpireSupportSessionsUseCase;

  beforeEach(() => {
    sessions = { expireDueSessions: vi.fn() };
    useCase = new ExpireSupportSessionsUseCase(sessions as unknown as SupportSessionRepository);
  });

  it('reports the count of sessions expired by the repository sweep', async () => {
    sessions.expireDueSessions.mockResolvedValue(3);

    const result = await useCase.execute();

    expect(result.expiredCount).toBe(3);
    expect(sessions.expireDueSessions).toHaveBeenCalledWith(expect.any(Date));
  });
});
