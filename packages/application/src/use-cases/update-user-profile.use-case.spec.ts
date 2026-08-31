import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateUserProfileUseCase } from './update-user-profile.use-case';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    telegramUserId: 1n,
    telegramUsername: null,
    displayName: null,
    preferredLanguage: 'en',
    defaultCurrency: 'UZS',
    timezone: 'Asia/Tashkent',
    status: 'active',
    onboardingCompletedAt: null,
    deletionRequestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UpdateUserProfileUseCase (FR-PROF-002)', () => {
  let userRepository: { updateProfile: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let useCase: UpdateUserProfileUseCase;

  beforeEach(() => {
    userRepository = { updateProfile: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    useCase = new UpdateUserProfileUseCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userRepository as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currencyRepository as any,
    );
  });

  it('happy path: updates language to a real supported value', async () => {
    const outcome = await useCase.execute('user-1', 'language', 'ru');
    expect(outcome.kind).toBe('updated');
    expect(userRepository.updateProfile).toHaveBeenCalledWith('user-1', {
      preferredLanguage: 'ru',
    });
  });

  it('rejects an invalid language value, never calls the repository', async () => {
    const outcome = await useCase.execute('user-1', 'language', 'de');
    expect(outcome).toEqual({ kind: 'invalid_value' });
    expect(userRepository.updateProfile).not.toHaveBeenCalled();
  });

  it('happy path: updates currency after checking CurrencyRepository.isSupported', async () => {
    const outcome = await useCase.execute('user-1', 'currency', 'USD');
    expect(outcome.kind).toBe('updated');
    expect(currencyRepository.isSupported).toHaveBeenCalledWith('USD');
    expect(userRepository.updateProfile).toHaveBeenCalledWith('user-1', { defaultCurrency: 'USD' });
  });

  it('rejects an unsupported currency, never calls the repository', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);
    const outcome = await useCase.execute('user-1', 'currency', 'XXX');
    expect(outcome).toEqual({ kind: 'invalid_value' });
    expect(userRepository.updateProfile).not.toHaveBeenCalled();
  });

  it('happy path: updates timezone for a real IANA identifier', async () => {
    const outcome = await useCase.execute('user-1', 'timezone', 'Europe/London');
    expect(outcome.kind).toBe('updated');
    expect(userRepository.updateProfile).toHaveBeenCalledWith('user-1', {
      timezone: 'Europe/London',
    });
  });

  it('rejects an invalid timezone value, never calls the repository', async () => {
    const outcome = await useCase.execute('user-1', 'timezone', 'Not/A_Real_Zone');
    expect(outcome).toEqual({ kind: 'invalid_value' });
    expect(userRepository.updateProfile).not.toHaveBeenCalled();
  });

  it('user isolation: the exact userId given is passed straight through, never substituted', async () => {
    await useCase.execute('user-abc-123', 'language', 'uz');
    expect(userRepository.updateProfile).toHaveBeenCalledWith('user-abc-123', {
      preferredLanguage: 'uz',
    });
  });
});
