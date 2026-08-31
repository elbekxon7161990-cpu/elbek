import type {
  Admin,
  AdminMfaChallengeRepository,
  AdminRepository,
  AdminSessionRepository,
  SecretStorePort,
  TotpProviderPort,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidAdminMfaCodeError } from '../errors/invalid-admin-mfa-code.error';
import { AdminMfaVerificationUseCase } from './admin-mfa-verification.use-case';

function makeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    passwordHash: 'hashed',
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

describe('AdminMfaVerificationUseCase', () => {
  let admins: {
    findById: ReturnType<typeof vi.fn>;
    applyFailedLoginOutcome: ReturnType<typeof vi.fn>;
    resetLoginFailureState: ReturnType<typeof vi.fn>;
  };
  let sessions: { create: ReturnType<typeof vi.fn> };
  let challenges: { get: ReturnType<typeof vi.fn>; consume: ReturnType<typeof vi.fn> };
  let totp: { verify: ReturnType<typeof vi.fn> };
  let secretStore: { reveal: ReturnType<typeof vi.fn> };
  let useCase: AdminMfaVerificationUseCase;

  beforeEach(() => {
    admins = {
      findById: vi.fn(),
      applyFailedLoginOutcome: vi.fn(),
      resetLoginFailureState: vi.fn(),
    };
    sessions = { create: vi.fn() };
    challenges = { get: vi.fn(), consume: vi.fn() };
    totp = { verify: vi.fn() };
    secretStore = { reveal: vi.fn() };
    useCase = new AdminMfaVerificationUseCase(
      admins as unknown as AdminRepository,
      sessions as unknown as AdminSessionRepository,
      challenges as unknown as AdminMfaChallengeRepository,
      totp as unknown as TotpProviderPort,
      secretStore as unknown as SecretStorePort,
    );
  });

  it('issues a session on a valid code, resets lockout state, and consumes the challenge (single-use)', async () => {
    challenges.get.mockResolvedValue({ adminId: 'admin-1', createdAt: new Date() });
    admins.findById.mockResolvedValue(makeAdmin());
    secretStore.reveal.mockResolvedValue('RAWSECRET');
    totp.verify.mockResolvedValue(true);
    sessions.create.mockResolvedValue({});

    const result = await useCase.execute({
      challengeToken: 'ct-1',
      code: '123456',
      ipAddress: '1.2.3.4',
    });

    expect(result.sessionToken).toBeTypeOf('string');
    expect(result.sessionToken.length).toBeGreaterThan(0);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(challenges.consume).toHaveBeenCalledWith('ct-1');
    expect(admins.resetLoginFailureState).toHaveBeenCalledWith('admin-1');
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: 'admin-1', ipAddress: '1.2.3.4' }),
    );
  });

  it('rejects a missing/expired challenge generically, without touching any admin repository state', async () => {
    challenges.get.mockResolvedValue(null);

    await expect(
      useCase.execute({ challengeToken: 'gone', code: '123456', ipAddress: null }),
    ).rejects.toBeInstanceOf(InvalidAdminMfaCodeError);
    expect(admins.findById).not.toHaveBeenCalled();
  });

  it('rejects an invalid code generically and increments the SAME failure counter as the password step', async () => {
    challenges.get.mockResolvedValue({ adminId: 'admin-1', createdAt: new Date() });
    admins.findById.mockResolvedValue(makeAdmin());
    secretStore.reveal.mockResolvedValue('RAWSECRET');
    totp.verify.mockResolvedValue(false);
    admins.applyFailedLoginOutcome.mockResolvedValue(makeAdmin({ failedLoginAttempts: 1 }));

    await expect(
      useCase.execute({ challengeToken: 'ct-1', code: '000000', ipAddress: null }),
    ).rejects.toBeInstanceOf(InvalidAdminMfaCodeError);

    expect(admins.applyFailedLoginOutcome).toHaveBeenCalledTimes(1);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(challenges.consume).not.toHaveBeenCalled();
  });

  it('rejects generically (no session) if the account became locked between the password step and this step', async () => {
    challenges.get.mockResolvedValue({ adminId: 'admin-1', createdAt: new Date() });
    admins.findById.mockResolvedValue(makeAdmin({ lockedUntil: new Date(Date.now() + 60_000) }));

    await expect(
      useCase.execute({ challengeToken: 'ct-1', code: '123456', ipAddress: null }),
    ).rejects.toBeInstanceOf(InvalidAdminMfaCodeError);
    expect(secretStore.reveal).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });
});
