import type { SupportSession, SupportSessionRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionInvalidError } from '../errors/support-session-invalid.error';
import { CloseSupportSessionUseCase } from './close-support-session.use-case';
import { ValidateSupportSessionUseCase } from './validate-support-session.use-case';

function makeSession(): SupportSession {
  return {
    id: 'session-1',
    agentAdminId: 'agent-1',
    targetUserId: 'user-1',
    justification: 'reason',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    closedAt: null,
    expiredAt: null,
  } as SupportSession;
}

describe('CloseSupportSessionUseCase', () => {
  let sessions: { findActiveById: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let useCase: CloseSupportSessionUseCase;

  beforeEach(() => {
    sessions = { findActiveById: vi.fn(), close: vi.fn() };
    const validate = new ValidateSupportSessionUseCase(
      sessions as unknown as SupportSessionRepository,
    );
    useCase = new CloseSupportSessionUseCase(
      sessions as unknown as SupportSessionRepository,
      validate,
    );
  });

  it('closes an active, caller-owned session', async () => {
    sessions.findActiveById.mockResolvedValue(makeSession());
    sessions.close.mockResolvedValue(true);

    await useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-1' });

    expect(sessions.close).toHaveBeenCalledWith('session-1', expect.any(Date));
  });

  it('rejects generically when the caller does not own the session', async () => {
    sessions.findActiveById.mockResolvedValue(makeSession());

    await expect(
      useCase.execute({ sessionId: 'session-1', callerAdminId: 'someone-else' }),
    ).rejects.toBeInstanceOf(SupportSessionInvalidError);
    expect(sessions.close).not.toHaveBeenCalled();
  });

  it('rejects generically when close() loses a race (already closed/expired)', async () => {
    sessions.findActiveById.mockResolvedValue(makeSession());
    sessions.close.mockResolvedValue(false);

    await expect(
      useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-1' }),
    ).rejects.toBeInstanceOf(SupportSessionInvalidError);
  });
});
