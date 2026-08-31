import type {
  Counterparty,
  CounterpartyRepository,
  CurrencyRepository,
  Debt,
  DebtRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { InvalidDebtError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type CreateDebtInput, CreateDebtUseCase } from './create-debt.use-case';

const FIXED_NOW = new Date('2026-08-13T12:00:00Z');

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

function makeCounterparty(overrides: Partial<Counterparty> = {}): Counterparty {
  return {
    id: 'counterparty-1',
    userId: 'user-1',
    name: 'Aziz',
    aliases: [],
    createdAt: FIXED_NOW,
    ...overrides,
  } as Counterparty;
}

function makeInput(overrides: Partial<CreateDebtInput> = {}): CreateDebtInput {
  return {
    userId: 'user-1',
    direction: 'given',
    counterpartyName: 'Aziz',
    amount: '100000',
    currency: 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: new Date('2026-09-01'),
    originalText: 'lent 100000 to Aziz',
    language: 'en',
    ...overrides,
  };
}

describe('CreateDebtUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let counterpartyRepository: {
    findAllByUserId: ReturnType<typeof vi.fn>;
    findOrCreateByName: ReturnType<typeof vi.fn>;
  };
  let debtRepository: { create: ReturnType<typeof vi.fn> };
  let useCase: CreateDebtUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    counterpartyRepository = {
      findAllByUserId: vi.fn().mockResolvedValue([]),
      findOrCreateByName: vi
        .fn()
        .mockImplementation((userId: string, name: string) =>
          Promise.resolve(makeCounterparty({ userId, name })),
        ),
    };
    debtRepository = {
      create: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'debt-1',
          outstandingBalance: data.originalAmount,
          status: 'open',
          ...data,
        } as Debt),
      ),
    };

    useCase = new CreateDebtUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      counterpartyRepository as unknown as CounterpartyRepository,
      debtRepository as unknown as DebtRepository,
    );
  });

  it('creates a DEBT_GIVEN debt for a brand-new counterparty (FR-DBT-001)', async () => {
    const result = await useCase.execute(makeInput({ direction: 'given' }));

    expect(result.kind).toBe('created');
    expect(counterpartyRepository.findOrCreateByName).toHaveBeenCalledWith('user-1', 'Aziz');
    expect(debtRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'given', counterpartyRefId: 'counterparty-1' }),
    );
  });

  it('creates a DEBT_RECEIVED debt (FR-DBT-001)', async () => {
    const result = await useCase.execute(makeInput({ direction: 'received' }));

    expect(result.kind).toBe('created');
    expect(debtRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'received' }),
    );
  });

  it('resolves an existing exact-match counterparty without creating a new one', async () => {
    const existing = makeCounterparty({ id: 'counterparty-existing', name: 'Aziz' });
    counterpartyRepository.findAllByUserId.mockResolvedValue([existing]);

    await useCase.execute(makeInput());

    expect(counterpartyRepository.findOrCreateByName).not.toHaveBeenCalled();
    expect(debtRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ counterpartyRefId: 'counterparty-existing' }),
    );
  });

  it('returns "counterparty_ambiguous" without creating any debt, when multiple plausible counterparties exist (FR-DBT-008)', async () => {
    const candidate1 = makeCounterparty({ id: 'c-1', name: 'Aziz Karimov' });
    const candidate2 = makeCounterparty({ id: 'c-2', name: 'Aziz Yusupov' });
    counterpartyRepository.findAllByUserId.mockResolvedValue([candidate1, candidate2]);

    const result = await useCase.execute(makeInput({ counterpartyName: 'Aziz' }));

    expect(result.kind).toBe('counterparty_ambiguous');
    if (result.kind === 'counterparty_ambiguous') {
      expect(result.candidates).toHaveLength(2);
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(debtRepository.create).not.toHaveBeenCalled();
    expect(counterpartyRepository.findOrCreateByName).not.toHaveBeenCalled();
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(debtRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidCurrencyError for an unsupported currency', async () => {
    currencyRepository.isSupported.mockResolvedValue(false);

    await expect(useCase.execute(makeInput())).rejects.toThrow(InvalidCurrencyError);
    expect(debtRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidDebtError for a due date already in the past, BEFORE touching counterparty state at all', async () => {
    await expect(useCase.execute(makeInput({ dueDate: new Date('2020-01-01') }))).rejects.toThrow(
      InvalidDebtError,
    );

    expect(counterpartyRepository.findAllByUserId).not.toHaveBeenCalled();
    expect(counterpartyRepository.findOrCreateByName).not.toHaveBeenCalled();
    expect(debtRepository.create).not.toHaveBeenCalled();
  });

  it('throws InvalidDebtError for an invalid amount', async () => {
    await expect(useCase.execute(makeInput({ amount: '0' }))).rejects.toThrow(InvalidDebtError);
    expect(debtRepository.create).not.toHaveBeenCalled();
  });
});
