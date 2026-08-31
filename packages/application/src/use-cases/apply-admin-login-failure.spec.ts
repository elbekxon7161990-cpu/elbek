import type { Admin, AdminRepository } from '@afa/domain';
import { describe, expect, it, vi } from 'vitest';

import { applyAdminLoginFailure } from './apply-admin-login-failure';

const NOW = new Date('2026-08-23T10:00:00.000Z');

function makeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    id: 'admin-1',
    failedLoginAttempts: 2,
    failedLoginWindowStartedAt: new Date(NOW.getTime() - 60_000),
    lockedUntil: null,
    lockoutCycleCount: 0,
    ...overrides,
  } as Admin;
}

describe('applyAdminLoginFailure', () => {
  it('writes on the first attempt when nothing raced it', async () => {
    const admins = {
      applyFailedLoginOutcome: vi.fn().mockResolvedValue(makeAdmin({ failedLoginAttempts: 3 })),
      findById: vi.fn(),
    };
    const expected = {
      failedLoginAttempts: 2,
      failedLoginWindowStartedAt: new Date(NOW.getTime() - 60_000),
      lockedUntil: null,
      lockoutCycleCount: 0,
    };

    await applyAdminLoginFailure(admins as unknown as AdminRepository, 'admin-1', expected, NOW);

    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(1);
    expect(admins.findById).not.toHaveBeenCalled();
  });

  it('re-reads and retries once when the first optimistic write loses a race', async () => {
    const staleExpected = {
      failedLoginAttempts: 2,
      failedLoginWindowStartedAt: new Date(NOW.getTime() - 60_000),
      lockedUntil: null,
      lockoutCycleCount: 0,
    };
    const freshFromDb = makeAdmin({ failedLoginAttempts: 3 });

    const admins = {
      applyFailedLoginOutcome: vi
        .fn()
        .mockResolvedValueOnce(null) // lost the race against stale `expected`
        .mockResolvedValueOnce(makeAdmin({ failedLoginAttempts: 4 })),
      findById: vi.fn().mockResolvedValue(freshFromDb),
    };

    await applyAdminLoginFailure(
      admins as unknown as AdminRepository,
      'admin-1',
      staleExpected,
      NOW,
    );

    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(2);
    expect(admins.findById).toHaveBeenCalledTimes(1);
    // Second attempt recomputed against the freshly-read state, not the stale one.
    const secondCallExpected = admins.applyFailedLoginOutcome.mock.calls[1][1];
    expect(secondCallExpected.failedLoginAttempts).toBe(3);
  });

  it('gives up quietly (no throw) after exhausting retries under sustained contention', async () => {
    const admins = {
      applyFailedLoginOutcome: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(makeAdmin()),
    };
    const expected = {
      failedLoginAttempts: 2,
      failedLoginWindowStartedAt: new Date(NOW.getTime() - 60_000),
      lockedUntil: null,
      lockoutCycleCount: 0,
    };

    await expect(
      applyAdminLoginFailure(admins as unknown as AdminRepository, 'admin-1', expected, NOW),
    ).resolves.toBeUndefined();
    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(3);
  });

  it('stops without throwing if the admin row disappears between retries', async () => {
    const admins = {
      applyFailedLoginOutcome: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    };
    const expected = {
      failedLoginAttempts: 2,
      failedLoginWindowStartedAt: new Date(NOW.getTime() - 60_000),
      lockedUntil: null,
      lockoutCycleCount: 0,
    };

    await expect(
      applyAdminLoginFailure(admins as unknown as AdminRepository, 'admin-1', expected, NOW),
    ).resolves.toBeUndefined();
    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(1);
  });
});
