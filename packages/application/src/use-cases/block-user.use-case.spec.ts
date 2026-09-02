import { describe, expect, it, vi } from 'vitest';
import type { AuditLogRepository, User, UserRepository } from '@afa/domain';

import { BlockUserUseCase } from './block-user.use-case';

const USER_ID = 'user-1';
const ADMIN_ID = 'admin-1';

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: USER_ID, status: 'active', ...overrides } as User;
}

type FakeUserRepository = UserRepository & {
  block: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
};

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeUser()),
    create: vi.fn(),
    reactivate: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    findExpiredPendingDeletions: vi.fn(),
    updateProfile: vi.fn(),
    block: vi.fn().mockResolvedValue(fakeUser({ status: 'deactivated' })),
    listUsers: vi.fn(),
    countUsers: vi.fn(),
    ...overrides,
  } as FakeUserRepository;
}

type FakeAuditLogRepository = AuditLogRepository & { create: ReturnType<typeof vi.fn> };

function fakeAuditLogRepository(): FakeAuditLogRepository {
  return { create: vi.fn().mockResolvedValue({}) };
}

describe('BlockUserUseCase', () => {
  it('blocks an active user and writes an audit-log entry', async () => {
    const userRepo = fakeUserRepository();
    const auditRepo = fakeAuditLogRepository();
    const useCase = new BlockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, 'reported for abuse', ADMIN_ID);

    expect(outcome).toEqual({ kind: 'blocked' });
    expect(userRepo.block).toHaveBeenCalledWith(USER_ID);
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: ADMIN_ID,
        action: 'user.block',
        targetUserId: USER_ID,
        justification: 'reported for abuse',
      }),
    );
  });

  it('returns "not_eligible" with the real current status when the atomic write finds the user not active, and never writes an audit entry', async () => {
    const userRepo = fakeUserRepository({
      block: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(fakeUser({ status: 'deactivated' })),
    });
    const auditRepo = fakeAuditLogRepository();
    const useCase = new BlockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, 'reason', ADMIN_ID);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'deactivated' });
    expect(auditRepo.create).not.toHaveBeenCalled();
  });

  it('returns "not_eligible" with currentStatus "unknown" rather than throwing if the user vanished entirely', async () => {
    const userRepo = fakeUserRepository({
      block: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    });
    const auditRepo = fakeAuditLogRepository();
    const useCase = new BlockUserUseCase(userRepo, auditRepo);

    const outcome = await useCase.execute(USER_ID, 'reason', ADMIN_ID);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'unknown' });
  });
});
