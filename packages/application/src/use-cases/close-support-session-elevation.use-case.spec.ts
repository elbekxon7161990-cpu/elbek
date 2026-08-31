import type {
  SupportSession,
  SupportSessionElevationRepository,
  SupportSessionElevationRequest,
  SupportSessionRepository,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';
import { CloseSupportSessionElevationUseCase } from './close-support-session-elevation.use-case';
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

function makeElevated(
  overrides: Partial<SupportSessionElevationRequest> = {},
): SupportSessionElevationRequest {
  return {
    id: 'elev-1',
    supportSessionId: 'session-1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: new Date(),
    resolvedByAdminId: 'super-1',
    closedAt: null,
    ...overrides,
  } as SupportSessionElevationRequest;
}

describe('CloseSupportSessionElevationUseCase', () => {
  let sessionsRepo: { findActiveById: ReturnType<typeof vi.fn> };
  let elevations: {
    findCurrentlyElevated: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let useCase: CloseSupportSessionElevationUseCase;

  beforeEach(() => {
    sessionsRepo = { findActiveById: vi.fn() };
    elevations = { findCurrentlyElevated: vi.fn(), close: vi.fn() };
    const validate = new ValidateSupportSessionUseCase(
      sessionsRepo as unknown as SupportSessionRepository,
    );
    useCase = new CloseSupportSessionElevationUseCase(
      elevations as unknown as SupportSessionElevationRepository,
      validate,
    );
  });

  it('closes the currently-elevated grant for the caller’s own session', async () => {
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());
    elevations.findCurrentlyElevated.mockResolvedValue(makeElevated());
    elevations.close.mockResolvedValue(true);

    await useCase.execute({
      sessionId: 'session-1',
      elevationRequestId: 'elev-1',
      callerAdminId: 'agent-1',
    });

    expect(elevations.close).toHaveBeenCalledWith('elev-1', expect.any(Date));
  });

  it('rejects generically when the given elevationRequestId does not match the currently-elevated grant', async () => {
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());
    elevations.findCurrentlyElevated.mockResolvedValue(makeElevated({ id: 'elev-other' }));

    await expect(
      useCase.execute({
        sessionId: 'session-1',
        elevationRequestId: 'elev-1',
        callerAdminId: 'agent-1',
      }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
    expect(elevations.close).not.toHaveBeenCalled();
  });

  it('rejects generically when the caller does not own the session', async () => {
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());

    await expect(
      useCase.execute({
        sessionId: 'session-1',
        elevationRequestId: 'elev-1',
        callerAdminId: 'someone-else',
      }),
    ).rejects.toThrow();
  });
});
