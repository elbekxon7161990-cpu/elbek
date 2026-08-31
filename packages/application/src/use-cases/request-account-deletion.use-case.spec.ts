import { describe, expect, it, vi } from 'vitest';
import type { User, UserRepository } from '@afa/domain';

import { RequestAccountDeletionUseCase } from './request-account-deletion.use-case';

const USER_ID = 'user-1';
const NOW = new Date('2026-01-15T12:00:00Z');

function fakeUser(overrides: Partial<User> = {}): User {
  return { id: USER_ID, status: 'active', ...overrides } as User;
}

type FakeUserRepository = UserRepository & {
  requestDeletion: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
};

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn().mockResolvedValue(fakeUser()),
    create: vi.fn(),
    reactivate: vi.fn(),
    requestDeletion: vi.fn().mockResolvedValue(fakeUser({ status: 'pending_deletion' })),
    cancelDeletion: vi.fn(),
    ...overrides,
  } as FakeUserRepository;
}

describe('RequestAccountDeletionUseCase', () => {
  it('returns "requested" and passes the given timestamp through when the atomic write succeeds', async () => {
    const repo = fakeUserRepository();
    const useCase = new RequestAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'requested' });
    expect(repo.requestDeletion).toHaveBeenCalledWith(USER_ID, NOW);
  });

  it('defaults the timestamp to "now" when none is supplied', async () => {
    const repo = fakeUserRepository();
    const useCase = new RequestAccountDeletionUseCase(repo);

    await useCase.execute(USER_ID);

    expect(repo.requestDeletion).toHaveBeenCalledWith(USER_ID, expect.any(Date));
  });

  it('returns "not_eligible" with the real current status when the atomic write finds the user not active (already pending deletion)', async () => {
    const repo = fakeUserRepository({
      requestDeletion: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(fakeUser({ status: 'pending_deletion' })),
    });
    const useCase = new RequestAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'pending_deletion' });
  });

  it('returns "not_eligible" with currentStatus "unknown" rather than throwing if the user vanished entirely (defensive, never crashes)', async () => {
    const repo = fakeUserRepository({
      requestDeletion: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    });
    const useCase = new RequestAccountDeletionUseCase(repo);

    const outcome = await useCase.execute(USER_ID, NOW);

    expect(outcome).toEqual({ kind: 'not_eligible', currentStatus: 'unknown' });
  });
});
