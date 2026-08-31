import type { SupportSessionRepository, User, UserRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionTargetUserNotFoundError } from '../errors/support-session-target-user-not-found.error';
import { OpenSupportSessionUseCase } from './open-support-session.use-case';

function makeUser(): User {
  return {
    id: 'user-1',
    telegramUserId: 123n,
    telegramUsername: null,
    displayName: null,
    preferredLanguage: 'en',
    defaultCurrency: 'UZS',
    timezone: 'Asia/Tashkent',
    status: 'active',
    onboardingCompletedAt: null,
    deletionRequestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

describe('OpenSupportSessionUseCase', () => {
  let sessions: { create: ReturnType<typeof vi.fn> };
  let users: { findById: ReturnType<typeof vi.fn> };
  let useCase: OpenSupportSessionUseCase;

  beforeEach(() => {
    sessions = { create: vi.fn() };
    users = { findById: vi.fn() };
    useCase = new OpenSupportSessionUseCase(
      sessions as unknown as SupportSessionRepository,
      users as unknown as UserRepository,
    );
  });

  it('opens a session for an existing target user, carrying the justification through', async () => {
    users.findById.mockResolvedValue(makeUser());
    sessions.create.mockResolvedValue({
      id: 'session-1',
      agentAdminId: 'agent-1',
      targetUserId: 'user-1',
      justification: 'user reported a discrepancy',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      closedAt: null,
      expiredAt: null,
    });

    const result = await useCase.execute({
      agentAdminId: 'agent-1',
      targetUserId: 'user-1',
      justification: 'user reported a discrepancy',
    });

    expect(result.sessionId).toBe('session-1');
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentAdminId: 'agent-1',
        targetUserId: 'user-1',
        justification: 'user reported a discrepancy',
      }),
    );
  });

  it('rejects when the target user does not exist, without ever creating a session', async () => {
    users.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ agentAdminId: 'agent-1', targetUserId: 'nobody', justification: 'x' }),
    ).rejects.toBeInstanceOf(SupportSessionTargetUserNotFoundError);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
