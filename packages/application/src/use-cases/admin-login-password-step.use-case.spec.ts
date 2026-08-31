import type {
  Admin,
  AdminMfaChallengeRepository,
  AdminRepository,
  PasswordHasherPort,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidAdminCredentialsError } from '../errors/invalid-admin-credentials.error';
import { AdminLoginPasswordStepUseCase } from './admin-login-password-step.use-case';

function makeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    passwordHash: 'hashed-correct-password',
    mfaSecretRef: 'v1.ref.for.test',
    role: 'admin',
    status: 'active',
    failedLoginAttempts: 0,
    failedLoginWindowStartedAt: null,
    lockedUntil: null,
    lockoutCycleCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Admin;
}

describe('AdminLoginPasswordStepUseCase', () => {
  let admins: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    applyFailedLoginOutcome: ReturnType<typeof vi.fn>;
    resetLoginFailureState: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let passwordHasher: { hash: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };
  let challenges: {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    consume: ReturnType<typeof vi.fn>;
  };
  let useCase: AdminLoginPasswordStepUseCase;

  beforeEach(() => {
    admins = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      applyFailedLoginOutcome: vi.fn(),
      resetLoginFailureState: vi.fn(),
      create: vi.fn(),
    };
    passwordHasher = { hash: vi.fn().mockResolvedValue('dummy-hash'), verify: vi.fn() };
    challenges = { create: vi.fn(), get: vi.fn(), consume: vi.fn() };
    useCase = new AdminLoginPasswordStepUseCase(
      admins as unknown as AdminRepository,
      passwordHasher as unknown as PasswordHasherPort,
      challenges as unknown as AdminMfaChallengeRepository,
    );
  });

  it('issues an MFA challenge on a correct password for an active, enrolled admin (never a session)', async () => {
    const admin = makeAdmin();
    admins.findByEmail.mockResolvedValue(admin);
    passwordHasher.verify.mockResolvedValue(true);
    challenges.create.mockResolvedValue('challenge-token-abc');

    const result = await useCase.execute({
      email: 'admin@example.com',
      password: 'correct-password',
    });

    expect(result).toEqual({ challengeToken: 'challenge-token-abc', expiresInSeconds: 5 * 60 });
    expect(challenges.create).toHaveBeenCalledWith('admin-1', 5 * 60 * 1000);
    expect(admins.applyFailedLoginOutcome).not.toHaveBeenCalled();
  });

  it('throws the generic error for an unknown email without touching the repository write path (does not reveal existence)', async () => {
    admins.findByEmail.mockResolvedValue(null);
    passwordHasher.verify.mockResolvedValue(false);

    await expect(
      useCase.execute({ email: 'nobody@example.com', password: 'anything' }),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);

    // Still exercises the password hasher (timing-safety dummy verify) even
    // though there is no real admin row.
    expect(passwordHasher.verify).toHaveBeenCalledWith('anything', 'dummy-hash');
    expect(admins.applyFailedLoginOutcome).not.toHaveBeenCalled();
  });

  it('throws the same generic error for a wrong password and increments the failure counter', async () => {
    const admin = makeAdmin();
    admins.findByEmail.mockResolvedValue(admin);
    passwordHasher.verify.mockResolvedValue(false);
    admins.applyFailedLoginOutcome.mockResolvedValue(makeAdmin({ failedLoginAttempts: 1 }));

    await expect(
      useCase.execute({ email: 'admin@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);

    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(1);
    const [adminId, expected, next] = admins.applyFailedLoginOutcome.mock.calls[0];
    expect(adminId).toBe('admin-1');
    expect(expected.failedLoginAttempts).toBe(0);
    expect(next.failedLoginAttempts).toBe(1);
  });

  it('throws the generic error for a locked account WITHOUT calling applyFailedLoginOutcome (no increment while locked)', async () => {
    const admin = makeAdmin({ lockedUntil: new Date(Date.now() + 60_000) });
    admins.findByEmail.mockResolvedValue(admin);

    await expect(
      useCase.execute({ email: 'admin@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);

    expect(admins.applyFailedLoginOutcome).not.toHaveBeenCalled();
    // Correct-password branch never even gets a real verify call while locked;
    // only the dummy-hash timing-safety verify runs.
    expect(passwordHasher.verify).toHaveBeenCalledWith('correct-password', 'dummy-hash');
  });

  it('throws the generic error for a deactivated admin without revealing the distinction', async () => {
    const admin = makeAdmin({ status: 'deactivated' });
    admins.findByEmail.mockResolvedValue(admin);

    await expect(
      useCase.execute({ email: 'admin@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);
    expect(admins.applyFailedLoginOutcome).not.toHaveBeenCalled();
  });

  it('throws the generic error for an admin with no completed MFA enrollment', async () => {
    const admin = makeAdmin({ mfaSecretRef: null });
    admins.findByEmail.mockResolvedValue(admin);

    await expect(
      useCase.execute({ email: 'admin@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);
  });
});
