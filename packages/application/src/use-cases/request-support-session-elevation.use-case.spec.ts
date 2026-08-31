import type {
  SupportSession,
  SupportSessionElevationRepository,
  SupportSessionRepository,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionInvalidError } from '../errors/support-session-invalid.error';
import { RequestSupportSessionElevationUseCase } from './request-support-session-elevation.use-case';
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

describe('RequestSupportSessionElevationUseCase', () => {
  let sessionsRepo: { findActiveById: ReturnType<typeof vi.fn> };
  let elevations: { createRequest: ReturnType<typeof vi.fn> };
  let useCase: RequestSupportSessionElevationUseCase;

  beforeEach(() => {
    sessionsRepo = { findActiveById: vi.fn() };
    elevations = { createRequest: vi.fn() };
    const validate = new ValidateSupportSessionUseCase(
      sessionsRepo as unknown as SupportSessionRepository,
    );
    useCase = new RequestSupportSessionElevationUseCase(
      elevations as unknown as SupportSessionElevationRepository,
      validate,
    );
  });

  it('creates a pending elevation request for an active, caller-owned session', async () => {
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());
    elevations.createRequest.mockResolvedValue({
      id: 'elev-1',
      supportSessionId: 'session-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resolvedAt: null,
      resolvedByAdminId: null,
      closedAt: null,
    });

    const result = await useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-1' });

    expect(result.requestId).toBe('elev-1');
    expect(elevations.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ supportSessionId: 'session-1' }),
    );
  });

  it('caps the elevation window at the parent session’s own remaining lifetime (FR-SEC-013)', async () => {
    const nearlyExpiredSession = makeSession({ expiresAt: new Date(Date.now() + 5_000) });
    sessionsRepo.findActiveById.mockResolvedValue(nearlyExpiredSession);
    elevations.createRequest.mockImplementation((data: { expiresAt: Date }) =>
      Promise.resolve({
        id: 'elev-1',
        supportSessionId: 'session-1',
        createdAt: new Date(),
        expiresAt: data.expiresAt,
        resolvedAt: null,
        resolvedByAdminId: null,
        closedAt: null,
      }),
    );

    await useCase.execute({ sessionId: 'session-1', callerAdminId: 'agent-1' });

    const [[calledWith]] = elevations.createRequest.mock.calls;
    expect((calledWith.expiresAt as Date).getTime()).toBe(nearlyExpiredSession.expiresAt.getTime());
  });

  it('rejects generically when the caller does not own the session', async () => {
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());

    await expect(
      useCase.execute({ sessionId: 'session-1', callerAdminId: 'someone-else' }),
    ).rejects.toBeInstanceOf(SupportSessionInvalidError);
    expect(elevations.createRequest).not.toHaveBeenCalled();
  });
});
