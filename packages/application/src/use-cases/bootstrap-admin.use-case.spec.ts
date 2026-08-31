import type {
  Admin,
  AdminRepository,
  BreachedPasswordCheckerPort,
  PasswordHasherPort,
  SecretStorePort,
  TotpProviderPort,
} from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAlreadyExistsError } from '../errors/admin-already-exists.error';
import { BreachedAdminPasswordError } from '../errors/breached-admin-password.error';
import { WeakAdminPasswordError } from '../errors/weak-admin-password.error';
import { BootstrapAdminUseCase } from './bootstrap-admin.use-case';

describe('BootstrapAdminUseCase', () => {
  let admins: { findByEmail: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let passwordHasher: { hash: ReturnType<typeof vi.fn> };
  let totp: { generateSecret: ReturnType<typeof vi.fn> };
  let secretStore: { protect: ReturnType<typeof vi.fn> };
  let breachedPasswordChecker: { isBreached: ReturnType<typeof vi.fn> };
  let useCase: BootstrapAdminUseCase;

  beforeEach(() => {
    admins = { findByEmail: vi.fn(), create: vi.fn() };
    passwordHasher = { hash: vi.fn().mockResolvedValue('hashed-password') };
    totp = {
      generateSecret: vi
        .fn()
        .mockReturnValue({ secret: 'RAWSECRET', otpauthUrl: 'otpauth://totp/...' }),
    };
    secretStore = { protect: vi.fn().mockResolvedValue('v1.protected.ref') };
    breachedPasswordChecker = { isBreached: vi.fn().mockResolvedValue(false) };
    useCase = new BootstrapAdminUseCase(
      admins as unknown as AdminRepository,
      passwordHasher as unknown as PasswordHasherPort,
      totp as unknown as TotpProviderPort,
      secretStore as unknown as SecretStorePort,
      breachedPasswordChecker as unknown as BreachedPasswordCheckerPort,
    );
  });

  it('provisions a super_admin with a hashed password and a secret-store reference (never the raw TOTP seed)', async () => {
    admins.findByEmail.mockResolvedValue(null);
    const createdAdmin = { id: 'admin-1', role: 'super_admin' } as Admin;
    admins.create.mockResolvedValue(createdAdmin);

    const result = await useCase.execute({
      email: 'root@example.com',
      password: 'a-long-enough-password',
    });

    expect(admins.create).toHaveBeenCalledWith({
      email: 'root@example.com',
      passwordHash: 'hashed-password',
      mfaSecretRef: 'v1.protected.ref',
      role: 'super_admin',
    });
    expect(secretStore.protect).toHaveBeenCalledWith('RAWSECRET');
    expect(result).toEqual({ admin: createdAdmin, otpauthUrl: 'otpauth://totp/...' });
  });

  it('rejects a password shorter than 12 characters before touching the repository', async () => {
    await expect(
      useCase.execute({ email: 'root@example.com', password: 'short' }),
    ).rejects.toBeInstanceOf(WeakAdminPasswordError);
    expect(admins.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects a breached password', async () => {
    breachedPasswordChecker.isBreached.mockResolvedValue(true);
    await expect(
      useCase.execute({ email: 'root@example.com', password: 'a-long-enough-password' }),
    ).rejects.toBeInstanceOf(BreachedAdminPasswordError);
    expect(admins.create).not.toHaveBeenCalled();
  });

  it('fails safe (throws) rather than overwriting an already-existing admin', async () => {
    admins.findByEmail.mockResolvedValue({ id: 'existing' } as Admin);
    await expect(
      useCase.execute({ email: 'root@example.com', password: 'a-long-enough-password' }),
    ).rejects.toBeInstanceOf(AdminAlreadyExistsError);
    expect(admins.create).not.toHaveBeenCalled();
  });
});
