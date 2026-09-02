import { describe, expect, it, vi } from 'vitest';
import type { User, UserRepository } from '@afa/domain';

import { GetUserByIdUseCase } from './get-user-by-id.use-case';

function fakeUserRepository(findById: ReturnType<typeof vi.fn>): UserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById,
    create: vi.fn(),
    reactivate: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    findExpiredPendingDeletions: vi.fn(),
    updateProfile: vi.fn(),
    block: vi.fn(),
    listUsers: vi.fn(),
    countUsers: vi.fn(),
  };
}

describe('GetUserByIdUseCase', () => {
  it('returns the user found by the repository', async () => {
    const user = { id: 'user-1' } as User;
    const repo = fakeUserRepository(vi.fn().mockResolvedValue(user));
    const useCase = new GetUserByIdUseCase(repo);

    const result = await useCase.execute('user-1');

    expect(result).toBe(user);
    expect(repo.findById).toHaveBeenCalledWith('user-1');
  });

  it('returns null when no user is found, never throwing', async () => {
    const repo = fakeUserRepository(vi.fn().mockResolvedValue(null));
    const useCase = new GetUserByIdUseCase(repo);

    const result = await useCase.execute('missing-id');

    expect(result).toBeNull();
  });
});
