import type { NewUserData, User, UserRepository } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProvisionTelegramUserUseCase } from './provision-telegram-user.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    telegramUserId: 42n,
    telegramUsername: 'existing',
    displayName: 'Existing User',
    preferredLanguage: 'en',
    defaultCurrency: 'UZS',
    timezone: 'Asia/Tashkent',
    status: 'active',
    onboardingCompletedAt: null,
    deletionRequestedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as User;
}

describe('ProvisionTelegramUserUseCase', () => {
  let repository: {
    findByTelegramUserId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    reactivate: ReturnType<typeof vi.fn>;
  };
  let useCase: ProvisionTelegramUserUseCase;

  beforeEach(() => {
    repository = {
      findByTelegramUserId: vi.fn(),
      create: vi.fn(),
      reactivate: vi.fn(),
    };
    useCase = new ProvisionTelegramUserUseCase(repository as unknown as UserRepository);
  });

  it('creates a new user with derived display name and language when none exists (FR-AUTH-001/003)', async () => {
    repository.findByTelegramUserId.mockResolvedValue(null);
    const created = makeUser({ id: 'new-user' });
    repository.create.mockResolvedValue(created);

    const result = await useCase.execute({
      telegramUserId: 42n,
      telegramUsername: 'newbie',
      firstName: 'Ada',
      lastName: 'Lovelace',
      languageCode: 'ru-RU',
    });

    expect(repository.create).toHaveBeenCalledWith({
      telegramUserId: 42n,
      telegramUsername: 'newbie',
      displayName: 'Ada Lovelace',
      preferredLanguage: 'ru',
    } satisfies NewUserData);
    expect(result).toEqual({ user: created, isNewUser: true });
  });

  it('returns an existing active user unchanged, without writing (US-AUTH-002 idempotency)', async () => {
    const existing = makeUser({ status: 'active' });
    repository.findByTelegramUserId.mockResolvedValue(existing);

    const result = await useCase.execute({ telegramUserId: 42n });

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.reactivate).not.toHaveBeenCalled();
    expect(result).toEqual({ user: existing, isNewUser: false });
  });

  it('reactivates a deactivated user instead of creating a duplicate (BR-AUTH-002)', async () => {
    const deactivated = makeUser({ status: 'deactivated' });
    const reactivated = makeUser({ status: 'active' });
    repository.findByTelegramUserId.mockResolvedValue(deactivated);
    repository.reactivate.mockResolvedValue(reactivated);

    const result = await useCase.execute({ telegramUserId: 42n });

    expect(repository.reactivate).toHaveBeenCalledWith(deactivated.id);
    expect(repository.create).not.toHaveBeenCalled();
    expect(result).toEqual({ user: reactivated, isNewUser: false });
  });
});
