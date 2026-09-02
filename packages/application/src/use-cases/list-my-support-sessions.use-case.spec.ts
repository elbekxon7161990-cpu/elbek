import { describe, expect, it, vi } from 'vitest';
import type { SupportSession, SupportSessionRepository } from '@afa/domain';

import { ListMySupportSessionsUseCase } from './list-my-support-sessions.use-case';

const AGENT_ID = 'admin-1';
const NOW = new Date('2026-01-15T12:00:00Z');

function fakeRepo(sessions: SupportSession[]): SupportSessionRepository {
  return {
    create: vi.fn(),
    findActiveById: vi.fn(),
    close: vi.fn(),
    expireDueSessions: vi.fn(),
    findActiveByAgentAdminId: vi.fn().mockResolvedValue(sessions),
  };
}

describe('ListMySupportSessionsUseCase', () => {
  it('returns the active sessions the repository reports for this agent', async () => {
    const session = {
      id: 'sess-1',
      agentAdminId: AGENT_ID,
      targetUserId: 'user-1',
    } as SupportSession;
    const repo = fakeRepo([session]);
    const useCase = new ListMySupportSessionsUseCase(repo);

    const result = await useCase.execute(AGENT_ID, NOW);

    expect(result).toEqual([session]);
    expect(repo.findActiveByAgentAdminId).toHaveBeenCalledWith(AGENT_ID, NOW);
  });

  it('defaults "now" to the current time when not supplied', async () => {
    const repo = fakeRepo([]);
    const useCase = new ListMySupportSessionsUseCase(repo);

    await useCase.execute(AGENT_ID);

    expect(repo.findActiveByAgentAdminId).toHaveBeenCalledWith(AGENT_ID, expect.any(Date));
  });
});
