import { describe, expect, it, vi } from 'vitest';
import type { AuditLogRepository, User, UserRepository } from '@afa/domain';

import { UnblockUserUseCase } from './unblock-user.use-case';

const USER_ID = 'user-1';
const ADMIN_ID = 'admin-1';

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: USER_ID, status: 'deactivated', ...overrides } as User;
}

type FakeUserRepository = UserRepository & {
  reactivate: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
};

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeUser()),
    create: vi.fn(),
    reactivate: vi.fn().mockResolvedValue(fakeUser({ status: 'active' })),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    findExpiredPendingDeletions: vi.fn(),
    updateProfile: vi.fn(),
    block: vi.fn(),
    listUsers: vi.fn(),
    countUsers: vi.fn(),
    ...overrides,
  } as FakeUserRepository;
}

type FakeAuditLogRepository = AuditLogRepository & { create: ReturnType<typeof vi.fn> };

function fakeAuditLogRepository(): FakeAuditLogRepository {
  return { create: vi.fn().mockResolvedValue({}) };
}

describe('UnblockUserUseCase', () => {
  it('unblocks a deactivated user and writes an audit-log entry', async () => {
    const userRepo = fakeUserRepository();
    const auditRepo = fakeAuditLogRepository();
    const useCase = new UnblockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, ADMIN_ID);

    expect(outcome).toEqual({ kind: 'unblocked' });
    expect(userRepo.reactivate).toHaveBeenCalledWith(USER_ID);
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: ADMIN_ID,
        action: 'user.unblock',
        targetUserId: USER_ID,
      }),
    );
  });

  it('returns "not_eligible" and never calls reactivate() when the user is not currently deactivated', async () => {
    const userRepo = fakeUserRepository({
      findById: vi.fn().mockResolvedValue(fakeUser({ status: 'active' })),
    });
    const auditRepo = fakeAuditLogRepository();
    const useCase = new UnblockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, ADMIN_ID);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'active' });
    expect(userRepo.reactivate).not.toHaveBeenCalled();
    expect(auditRepo.create).not.toHaveBeenCalled();
  });

  it('returns "not_eligible" with currentStatus "unknown" rather than throwing if the user vanished entirely', async () => {
    const userRepo = fakeUserRepository({ findById: vi.fn().mockResolvedValue(null) });
    const auditRepo = fakeAuditLogRepository();
    const useCase = new UnblockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, ADMIN_ID);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'unknown' });
  });
});
