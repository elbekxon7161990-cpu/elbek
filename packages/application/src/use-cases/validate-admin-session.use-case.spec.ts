import { createHash } from 'node:crypto';
import type { Admin, AdminRepository, AdminSession, AdminSessionRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSessionInvalidError } from '../errors/admin-session-invalid.error';
import { ValidateAdminSessionUseCase } from './validate-admin-session.use-case';

function makeSession(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: 'session-1',
    adminId: 'admin-1',
    tokenHash: createHash('sha256').update('raw-token').digest('hex'),
    parentSessionId: null,
    ipAddress: null,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ...overrides,
  } as AdminSession;
}

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

describe('ValidateAdminSessionUseCase', () => {
  let sessions: {
    findActiveByTokenHash: ReturnType<typeof vi.fn>;
    touchLastActive: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  let admins: { findById: ReturnType<typeof vi.fn> };
  let useCase: ValidateAdminSessionUseCase;

  beforeEach(() => {
    sessions = { findActiveByTokenHash: vi.fn(), touchLastActive: vi.fn(), revoke: vi.fn() };
    admins = { findById: vi.fn() };
    useCase = new ValidateAdminSessionUseCase(
      sessions as unknown as AdminSessionRepository,
      admins as unknown as AdminRepository,
    );
  });

  it('resolves the admin for a live, active session and touches lastActiveAt', async () => {
    sessions.findActiveByTokenHash.mockResolvedValue(makeSession());
    admins.findById.mockResolvedValue(makeAdmin());

    const admin = await useCase.execute('raw-token');

    expect(admin.id).toBe('admin-1');
    expect(sessions.touchLastActive).toHaveBeenCalledWith('session-1', expect.any(Date));
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it('rejects when no active session matches the token hash (missing/revoked/absolute-expired — findActiveByTokenHash already excludes those)', async () => {
    sessions.findActiveByTokenHash.mockResolvedValue(null);

    await expect(useCase.execute('bad-token')).rejects.toBeInstanceOf(AdminSessionInvalidError);
    expect(admins.findById).not.toHaveBeenCalled();
  });

  it('rejects and revokes when the session has been idle past the 12-hour idle timeout', async () => {
    const staleSession = makeSession({
      lastActiveAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
    });
    sessions.findActiveByTokenHash.mockResolvedValue(staleSession);

    await expect(useCase.execute('raw-token')).rejects.toBeInstanceOf(AdminSessionInvalidError);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', expect.any(Date));
    expect(admins.findById).not.toHaveBeenCalled();
  });

  it('rejects and revokes when the owning admin was deactivated mid-session', async () => {
    sessions.findActiveByTokenHash.mockResolvedValue(makeSession());
    admins.findById.mockResolvedValue(makeAdmin({ status: 'deactivated' }));

    await expect(useCase.execute('raw-token')).rejects.toBeInstanceOf(AdminSessionInvalidError);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', expect.any(Date));
  });
});
