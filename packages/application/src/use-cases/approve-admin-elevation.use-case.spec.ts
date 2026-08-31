import type { AdminElevationRepository, AdminElevationRequest } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminElevationRequestInvalidError } from '../errors/admin-elevation-request-invalid.error';
import { ApproveAdminElevationUseCase } from './approve-admin-elevation.use-case';

function makeRequest(overrides: Partial<AdminElevationRequest> = {}): AdminElevationRequest {
  return {
    id: 'req-1',
    targetAdminId: 'target-admin',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    resolvedByAdminId: null,
    ...overrides,
  } as AdminElevationRequest;
}

describe('ApproveAdminElevationUseCase', () => {
  let elevations: { findPendingById: ReturnType<typeof vi.fn>; grant: ReturnType<typeof vi.fn> };
  let useCase: ApproveAdminElevationUseCase;

  beforeEach(() => {
    elevations = { findPendingById: vi.fn(), grant: vi.fn() };
    useCase = new ApproveAdminElevationUseCase(elevations as unknown as AdminElevationRepository);
  });

  it('grants the elevation when a different super_admin approves a valid pending request', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    elevations.grant.mockResolvedValue(true);

    await useCase.execute({
      requestId: 'req-1',
      approverAdminId: 'approver-admin',
      approverRole: 'super_admin',
      ipAddress: '198.51.100.1',
    });

    expect(elevations.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        targetAdminId: 'target-admin',
        approverAdminId: 'approver-admin',
        ipAddress: '198.51.100.1',
      }),
    );
  });

  it('rejects generically when the approver is NOT a super_admin (defense-in-depth re-check)', async () => {
    await expect(
      useCase.execute({
        requestId: 'req-1',
        approverAdminId: 'approver-admin',
        approverRole: 'admin',
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(AdminElevationRequestInvalidError);
    expect(elevations.findPendingById).not.toHaveBeenCalled();
    expect(elevations.grant).not.toHaveBeenCalled();
  });

  it('SELF-ELEVATION REJECTED — the target admin cannot approve their own request, same generic error as any other invalid case', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest({ targetAdminId: 'same-admin' }));

    await expect(
      useCase.execute({
        requestId: 'req-1',
        approverAdminId: 'same-admin',
        approverRole: 'super_admin',
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(AdminElevationRequestInvalidError);
    expect(elevations.grant).not.toHaveBeenCalled();
  });

  it('rejects generically when no pending request matches (unknown/expired/already-resolved — findPendingById already excludes those)', async () => {
    elevations.findPendingById.mockResolvedValue(null);

    await expect(
      useCase.execute({
        requestId: 'bad-id',
        approverAdminId: 'approver-admin',
        approverRole: 'super_admin',
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(AdminElevationRequestInvalidError);
    expect(elevations.grant).not.toHaveBeenCalled();
  });

  it('rejects generically when the atomic grant loses a concurrent race (grant() returns false)', async () => {
    elevations.findPendingById.mockResolvedValue(makeRequest());
    elevations.grant.mockResolvedValue(false);

    await expect(
      useCase.execute({
        requestId: 'req-1',
        approverAdminId: 'approver-admin',
        approverRole: 'super_admin',
        ipAddress: null,
      }),
    ).rejects.toBeInstanceOf(AdminElevationRequestInvalidError);
  });
});
