import { describe, expect, it, vi } from 'vitest';
import type { User, UserRepository } from '@afa/domain';

import { ListUsersUseCase } from './list-users.use-case';

function fakeUser(id: string): User {
  return { id, status: 'active' } as User;
}

type FakeUserRepository = UserRepository & {
  listUsers: ReturnType<typeof vi.fn>;
  countUsers: ReturnType<typeof vi.fn>;
};

function fakeUserRepository(overrides: Partial<FakeUserRepository> = {}): FakeUserRepository {
  return {
    findByTelegramUserId: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    reactivate: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    findExpiredPendingDeletions: vi.fn(),
    updateProfile: vi.fn(),
    block: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([fakeUser('user-1'), fakeUser('user-2')]),
    countUsers: vi.fn().mockResolvedValue(2),
    ...overrides,
  } as FakeUserRepository;
}

describe('ListUsersUseCase', () => {
  it('returns the users and total from the repository, applying the given limit/offset', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    const result = await useCase.execute({ limit: 20, offset: 0 });

    expect(result).toEqual({
      users: [fakeUser('user-1'), fakeUser('user-2')],
      total: 2,
      limit: 20,
      offset: 0,
    });
    expect(repo.listUsers).toHaveBeenCalledWith({ status: undefined, limit: 20, offset: 0 });
    expect(repo.countUsers).toHaveBeenCalledWith({ status: undefined });
  });

  it('defaults limit to 20 and offset to 0 when neither is supplied', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    await useCase.execute({});

    expect(repo.listUsers).toHaveBeenCalledWith({ status: undefined, limit: 20, offset: 0 });
  });

  it('clamps a limit above 100 down to 100', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    await useCase.execute({ limit: 5000 });

    expect(repo.listUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('clamps a limit below 1 up to 1', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    await useCase.execute({ limit: -5 });

    expect(repo.listUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });

  it('clamps a negative offset up to 0', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    await useCase.execute({ offset: -10 });

    expect(repo.listUsers).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('passes a status filter through unchanged', async () => {
    const repo = fakeUserRepository();
    const useCase = new ListUsersUseCase(repo);

    await useCase.execute({ status: 'deactivated' });

    expect(repo.listUsers).toHaveBeenCalledWith(expect.objectContaining({ status: 'deactivated' }));
    expect(repo.countUsers).toHaveBeenCalledWith({ status: 'deactivated' });
  });
});
