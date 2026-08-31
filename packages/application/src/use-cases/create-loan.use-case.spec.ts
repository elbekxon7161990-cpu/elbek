import type { CurrencyRepository, Loan, LoanRepository, User, UserRepository } from '@afa/domain';
import { InvalidLoanError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateLoanInput, CreateLoanUseCase } from './create-loan.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeInput(overrides: Partial<CreateLoanInput> = {}): CreateLoanInput {
  return {
    userId: 'user-1',
    lender: 'Ipoteka Bank',
    principalAmount: '1000000.00',
    currency: 'UZS',
    interestRate: '0.1200',
    installmentAmount: '90000.00',
    installmentFrequency: 'monthly',
    startDate: new Date('2026-08-01'),
    ...overrides,
  };
}

describe('CreateLoanUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let loanRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateLoanUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    loanRepository = {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'loan-1',
          outstandingBalance: data.principalAmount,
          status: 'open',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Loan),
      ),
    };

    useCase = new CreateLoanUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      loanRepository as unknown as LoanRepository,
    );
  });

  it('A — creates a loan (FR-FIN-007)', async () => {
    const result = await useCase.execute(makeInput());

    expect(loanRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ lender: 'Ipoteka Bank', principalAmount: '1000000.00' }),
    );
    expect(result.id).toBe('loan-1');
  });

  it('B — creates an interest-free loan (null interestRate, FR-FIN-007)', async () => {
    await useCase.execute(makeInput({ interestRate: undefined }));

    expect(loanRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ interestRate: null }),
    );
  });

  it('C — throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(loanRepository.create).not.toHaveBeenCalled();
  });

  it('D — throws InvalidCurrencyError for an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput({ currency: 'XXX' }))).rejects.toThrow(
      InvalidCurrencyError,
    );
    expect(loanRepository.create).not.toHaveBeenCalled();
  });

  it('E — throws InvalidLoanError for a non-positive principalAmount, before ever calling the repository', async () => {
    await expect(useCase.execute(makeInput({ principalAmount: '0' }))).rejects.toThrow(
      InvalidLoanError,
    );
    expect(loanRepository.create).not.toHaveBeenCalled();
  });

  it('F — throws InvalidLoanError for an invalid installmentFrequency, before ever calling the repository', async () => {
    await expect(
      useCase.execute(makeInput({ installmentFrequency: 'daily' as never })),
    ).rejects.toThrow(InvalidLoanError);
    expect(loanRepository.create).not.toHaveBeenCalled();
  });
});
