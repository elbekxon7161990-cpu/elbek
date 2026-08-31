import type {
  CurrencyRepository,
  SavingsGoal,
  SavingsGoalRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidSavingsGoalError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import {
  type CreateSavingsGoalInput,
  CreateSavingsGoalUseCase,
} from './create-savings-goal.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeInput(overrides: Partial<CreateSavingsGoalInput> = {}): CreateSavingsGoalInput {
  return {
    userId: 'user-1',
    name: 'Vacation fund',
    targetAmount: '5000000.00',
    currency: 'UZS',
    ...overrides,
  };
}

describe('CreateSavingsGoalUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let savingsGoalRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateSavingsGoalUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    savingsGoalRepository = {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'goal-1',
          status: 'active',
          lastMilestoneFired: null,
          deletedAt: null,
          createdAt: new Date(),
          ...data,
        } as SavingsGoal),
      ),
    };

    useCase = new CreateSavingsGoalUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      savingsGoalRepository as unknown as SavingsGoalRepository,
    );
  });

  it('A — creates a savings goal (FR-FIN-011)', async () => {
    const result = await useCase.execute(makeInput());

    expect(savingsGoalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Vacation fund',
        targetAmount: '5000000.00',
        currency: 'UZS',
      }),
    );
    expect(result.id).toBe('goal-1');
  });

  it('B — accepts an omitted targetDate (FR-FIN-011 — optional)', async () => {
    await useCase.execute(makeInput());

    expect(savingsGoalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetDate: null }),
    );
  });

  it('C — throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(savingsGoalRepository.create).not.toHaveBeenCalled();
  });

  it('D — throws InvalidCurrencyError for an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ currency: 'XXX' }))).rejects.toThrow(
      InvalidCurrencyError,
    );
    expect(savingsGoalRepository.create).not.toHaveBeenCalled();
  });

  it('E — throws InvalidSavingsGoalError for a non-positive targetAmount, before ever calling the repository', async () => {
    await expect(useCase.execute(makeInput({ targetAmount: '0' }))).rejects.toThrow(
      InvalidSavingsGoalError,
    );
    expect(savingsGoalRepository.create).not.toHaveBeenCalled();
  });

  it('F — throws InvalidSavingsGoalError for a targetDate already in the past (§8.9.4)', async () => {
    await expect(
      useCase.execute(makeInput({ targetDate: new Date('2000-01-01') })),
    ).rejects.toThrow(InvalidSavingsGoalError);
    expect(savingsGoalRepository.create).not.toHaveBeenCalled();
  });
});
