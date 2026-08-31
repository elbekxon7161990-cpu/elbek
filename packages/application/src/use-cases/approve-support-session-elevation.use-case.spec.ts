import type {
  SupportSession,
  SupportSessionElevationRepository,
  SupportSessionElevationRequest,
  SupportSessionRepository,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportSessionElevationInvalidError } from '../errors/support-session-elevation-invalid.error';
import { ApproveSupportSessionElevationUseCase } from './approve-support-session-elevation.use-case';

function makeRequest(
  overrides: Partial<SupportSessionElevationRequest> = {},
): SupportSessionElevationRequest {
  return {
    id: 'elev-1',
    supportSessionId: 'session-1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    resolvedByAdminId: null,
    closedAt: null,
    ...overrides,
  } as SupportSessionElevationRequest;
}

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

describe('ApproveSupportSessionElevationUseCase', () => {
  let elevations: { findPendingById: ReturnType<typeof vi.fn>; grant: ReturnType<typeof vi.fn> };
  let sessionsRepo: { findActiveById: ReturnType<typeof vi.fn> };
  let useCase: ApproveSupportSessionElevationUseCase;

  beforeEach(() => {
    elevations = { findPendingById: vi.fn(), grant: vi.fn() };
    sessionsRepo = { findActiveById: vi.fn() };
    useCase = new ApproveSupportSessionElevationUseCase(
      elevations as unknown as SupportSessionElevationRepository,
      sessionsRepo as unknown as SupportSessionRepository,
    );
  });

  it('grants elevation when a super_admin, different from the session agent, approves', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    sessionsRepo.findActiveById.mockResolvedValue(makeSession({ agentAdminId: 'agent-1' }));
    elevations.grant.mockResolvedValue(true);

    await useCase.execute({
      requestId: 'elev-1',
      approverAdminId: 'super-1',
      approverRole: 'super_admin',
    });

    expect(elevations.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'elev-1',
        supportSessionId: 'session-1',
        targetUserId: 'user-1',
        approverAdminId: 'super-1',
      }),
    );
  });

  it('rejects generically when the approver is not a super_admin (defense-in-depth re-check)', async () => {
    await expect(
      useCase.execute({ requestId: 'elev-1', approverAdminId: 'admin-1', approverRole: 'admin' }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
    expect(elevations.findPendingById).not.toHaveBeenCalled();
  });

  it('SELF-ELEVATION REJECTED — the session’s own agent cannot approve their own elevation request, even as a super_admin', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    sessionsRepo.findActiveById.mockResolvedValue(makeSession({ agentAdminId: 'super-1' }));

    await expect(
      useCase.execute({
        requestId: 'elev-1',
        approverAdminId: 'super-1',
        approverRole: 'super_admin',
      }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
    expect(elevations.grant).not.toHaveBeenCalled();
  });

  it('rejects generically when the underlying support session is no longer active', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    sessionsRepo.findActiveById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        requestId: 'elev-1',
        approverAdminId: 'super-1',
        approverRole: 'super_admin',
      }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
  });

  it('rejects generically when no pending request matches', async () => {
    elevations.findPendingById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        requestId: 'bad-id',
        approverAdminId: 'super-1',
        approverRole: 'super_admin',
      }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
  });

  it('rejects generically when the atomic grant loses a concurrent race', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    sessionsRepo.findActiveById.mockResolvedValue(makeSession());
    elevations.grant.mockResolvedValue(false);

    await expect(
      useCase.execute({
        requestId: 'elev-1',
        approverAdminId: 'super-1',
        approverRole: 'super_admin',
      }),
    ).rejects.toBeInstanceOf(SupportSessionElevationInvalidError);
  });
});
