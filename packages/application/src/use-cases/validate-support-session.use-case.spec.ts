import type { SupportSession, SupportSessionRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionInvalidError } from '../errors/support-session-invalid.error';
import { ValidateSupportSessionUseCase } from './validate-support-session.use-case';

function makeSession(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 'session-1',
    agentAdminId: 'agent-1',
    targetUserId: 'user-1',
    justification: 'reason',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    closedAt: null,
    expiredAt: null,
    ...overrides,
  } as SupportSession;
}

describe('ValidateSupportSessionUseCase', () => {
  let sessions: { findActiveById: ReturnType<typeof vi.fn> };
  let useCase: ValidateSupportSessionUseCase;

  beforeEach(() => {
    sessions = { findActiveById: vi.fn() };
    useCase = new ValidateSupportSessionUseCase(sessions as unknown as SupportSessionRepository);
  });

  it('resolves the session when it is active and owned by the caller', async () => {
    sessions.findActiveById.mockResolvedValue(makeSession());

    const session = await useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-1' });

    expect(session.id).toBe('session-1');
  });

  it('rejects generically when no active session matches the id', async () => {
    sessions.findActiveById.mockResolvedValue(null);

    await expect(
      useCase.execute({ sessionId: 'bad-id', callerAdminId: 'agent-1' }),
    ).rejects.toBeInstanceOf(SupportSessionInvalidError);
  });

  it('CROSS-IDENTITY ISOLATION — rejects generically when a DIFFERENT admin presents a valid session id they do not own', async () => {
    sessions.findActiveById.mockResolvedValue(makeSession({ agentAdminId: 'agent-1' }));

    await expect(
      useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-2' }),
    ).rejects.toBeInstanceOf(SupportSessionInvalidError);
  });
});
