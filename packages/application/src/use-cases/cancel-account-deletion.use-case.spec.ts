import { describe, expect, it, vi } from 'vitest';
import type { User, UserRepository } from '@afa/domain';

import { CancelAccountDeletionUseCase } from './cancel-account-deletion.use-case';

const USER_ID = 'user-1';
const NOW = new Date('2026-02-01T00:00:00.000Z');

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: USER_ID, status: 'pending_deletion', ...overrides } as User;
}

type FakeUserRepository = UserRepository & {
  cancelDeletion: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findExpiredPendingDeletions: ReturnType<typeof vi.fn>;
};

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeUser()),
    create: vi.fn(),
    reactivate: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn().mockResolvedValue(fakeUser({ status: 'active' })),
    findExpiredPendingDeletions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as FakeUserRepository;
}

describe('CancelAccountDeletionUseCase', () => {
  it('returns "cancelled" when the atomic write succeeds', async () => {
    const repo = fakeUserRepository();
    const useCase = new CancelAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(repo.cancelDeletion).toHaveBeenCalledWith(USER_ID, NOW);
  });

  it('returns "not_pending" with the real current status when the user was not pending deletion', async () => {
    const repo = fakeUserRepository({
      cancelDeletion: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(fakeUser({ status: 'active' })),
    });
    const useCase = new CancelAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'not_pending', currentStatus: 'active' });
  });

  it('returns "grace_period_expired" when the atomic write fails but the user is still pending_deletion', async () => {
    const repo = fakeUserRepository({
      cancelDeletion: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(fakeUser({ status: 'pending_deletion' })),
    });
    const useCase = new CancelAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'grace_period_expired' });
  });

  it('returns currentStatus "unknown" rather than throwing if the user vanished entirely', async () => {
    const repo = fakeUserRepository({
      cancelDeletion: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    });
    const useCase = new CancelAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'not_pending', currentStatus: 'unknown' });
  });

  it('defaults `now` to the current time when omitted', async () => {
    const repo = fakeUserRepository();
    const useCase = new CancelAccountDeletionUseCase(repo);

    await useCase.execute(USER_ID);

    expect(repo.cancelDeletion).toHaveBeenCalledWith(USER_ID, expect.any(Date));
  });
});
