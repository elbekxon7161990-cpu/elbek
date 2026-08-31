import { createHash } from 'node:crypto';
import type { AdminSession, AdminSessionRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSessionInvalidError } from '../errors/admin-session-invalid.error';
import { AdminLogoutUseCase } from './admin-logout.use-case';

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

describe('AdminLogoutUseCase', () => {
  let sessions: {
    findActiveByTokenHash: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  let useCase: AdminLogoutUseCase;

  beforeEach(() => {
    sessions = { findActiveByTokenHash: vi.fn(), revoke: vi.fn() };
    useCase = new AdminLogoutUseCase(sessions as unknown as AdminSessionRepository);
  });

  it('revokes the session matching the presented token', async () => {
    sessions.findActiveByTokenHash.mockResolvedValue(makeSession());

    await useCase.execute('raw-token');

    expect(sessions.revoke).toHaveBeenCalledWith('session-1', expect.any(Date));
  });

  it('rejects generically when no active session matches the token (already revoked/expired/unknown)', async () => {
    sessions.findActiveByTokenHash.mockResolvedValue(null);

    await expect(useCase.execute('bad-token')).rejects.toBeInstanceOf(AdminSessionInvalidError);
    expect(sessions.revoke).not.toHaveBeenCalled();
  });
});
