import type { Admin, AdminElevationRepository, AdminRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminElevationNotEligibleError } from '../errors/admin-elevation-not-eligible.error';
import { RequestAdminElevationUseCase } from './request-admin-elevation.use-case';

function makeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    passwordHash: 'hashed',
    mfaSecretRef: 'ref',
    role: 'admin',
    status: 'active',
    failedLoginAttempts: 0,
    failedLoginWindowStartedAt: null,
    lockedUntil: null,
    lockoutCycleCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Admin;
}

describe('RequestAdminElevationUseCase', () => {
  let admins: { findById: ReturnType<typeof vi.fn> };
  let elevations: { createRequest: ReturnType<typeof vi.fn> };
  let useCase: RequestAdminElevationUseCase;

  beforeEach(() => {
    admins = { findById: vi.fn() };
    elevations = { createRequest: vi.fn() };
    useCase = new RequestAdminElevationUseCase(
      admins as unknown as AdminRepository,
      elevations as unknown as AdminElevationRepository,
    );
  });

  it('creates a pending elevation request for an eligible (role="admin") caller', async () => {
    admins.findById.mockResolvedValue(makeAdmin({ role: 'admin' }));
    elevations.createRequest.mockResolvedValue({
      id: 'req-1',
      targetAdminId: 'admin-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resolvedAt: null,
      resolvedByAdminId: null,
    });

    const result = await useCase.execute('admin-1');

    expect(result.requestId).toBe('req-1');
    expect(elevations.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ targetAdminId: 'admin-1' }),
    );
  });

  it('rejects a caller who is already super_admin (the ceiling role)', async () => {
    admins.findById.mockResolvedValue(makeAdmin({ role: 'super_admin' }));

    await expect(useCase.execute('admin-1')).rejects.toBeInstanceOf(AdminElevationNotEligibleError);
    expect(elevations.createRequest).not.toHaveBeenCalled();
  });

  it('rejects a caller with an unrelated role (e.g. support_agent)', async () => {
    admins.findById.mockResolvedValue(makeAdmin({ role: 'support_agent' }));

    await expect(useCase.execute('admin-1')).rejects.toBeInstanceOf(AdminElevationNotEligibleError);
    expect(elevations.createRequest).not.toHaveBeenCalled();
  });

  it('rejects when the caller cannot be resolved at all', async () => {
    admins.findById.mockResolvedValue(null);

    await expect(useCase.execute('admin-1')).rejects.toBeInstanceOf(AdminElevationNotEligibleError);
  });
});
