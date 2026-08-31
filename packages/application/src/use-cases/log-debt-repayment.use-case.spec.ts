import type {
  Counterparty,
  CounterpartyRepository,
  CurrencyRepository,
  DebtRepository,
  User,
  UserRepository,
} from '@afa/domain';
import { Debt } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserNotFoundError } from '../errors/user-not-found.error';
import { type LogDebtRepaymentInput, LogDebtRepaymentUseCase } from './log-debt-repayment.use-case';

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

function makeDebt(
  overrides: Partial<{
    id: string;
    outstandingBalance: string;
    direction: 'given' | 'received';
    currency: string;
    status: 'open' | 'repaid';
  }> = {},
): Debt {
  return new Debt({
    id: overrides.id ?? 'debt-1',
    userId: 'user-1',
    direction: overrides.direction ?? 'received',
    counterpartyName: 'Aziz',
    counterpartyRefId: 'counterparty-1',
    originalAmount: '100000',
    outstandingBalance: overrides.outstandingBalance ?? '100000',
    currency: overrides.currency ?? 'UZS',
    transactionDate: new Date('2026-08-01'),
    dueDate: new Date('2026-09-01'),
    status: overrides.status ?? 'open',
    notes: null,
    originalText: 'borrowed 100000 from Aziz',
    deletedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

function makeInput(overrides: Partial<LogDebtRepaymentInput> = {}): LogDebtRepaymentInput {
  return {
    userId: 'user-1',
    counterpartyName: 'Aziz',
    repaymentDirection: 'made',
    amount: '30000',
    currency: 'UZS',
    repaymentDate: new Date('2026-08-15'),
    originalText: 'paid Aziz back 30000',
    language: 'en',
    ...overrides,
  };
}

describe('LogDebtRepaymentUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let currencyRepository: { isSupported: ReturnType<typeof vi.fn> };
  let counterpartyRepository: { findAllByUserId: ReturnType<typeof vi.fn> };
  let debtRepository: {
    findOpenByCounterparty: ReturnType<typeof vi.fn>;
    logRepayment: ReturnType<typeof vi.fn>;
  };
  let useCase: LogDebtRepaymentUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    currencyRepository = { isSupported: vi.fn().mockResolvedValue(true) };
    counterpartyRepository = {
      findAllByUserId: vi.fn().mockResolvedValue([makeCounterparty()]),
    };
    debtRepository = {
      findOpenByCounterparty: vi.fn().mockResolvedValue([makeDebt()]),
      logRepayment: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          debt: makeDebt({ outstandingBalance: '70000' }),
          repayment: { id: 'repayment-1', debtId: data.debtId, amount: data.amount },
        }),
      ),
    };

    useCase = new LogDebtRepaymentUseCase(
      userRepository as unknown as UserRepository,
      currencyRepository as unknown as CurrencyRepository,
      counterpartyRepository as unknown as CounterpartyRepository,
      debtRepository as unknown as DebtRepository,
    );
  });

  it('applies a repayment when exactly one open debt matches (FR-DBT-003)', async () => {
    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('repaid');
    // 'made' (the user paid back) matches an open debt with direction 'received'.
    expect(debtRepository.findOpenByCounterparty).toHaveBeenCalledWith(
      'user-1',
      'counterparty-1',
      'received',
    );
    expect(debtRepository.logRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ debtId: 'debt-1', amount: '30000' }),
    );
  });

  it('matches the opposite debt direction for a "received" repayment', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([makeDebt({ direction: 'given' })]);

    await useCase.execute(makeInput({ repaymentDirection: 'received' }));

    expect(debtRepository.findOpenByCounterparty).toHaveBeenCalledWith(
      'user-1',
      'counterparty-1',
      'given',
    );
  });

  it('returns "no_matching_debt" when there is no open debt with this counterparty', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([]);

    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('no_matching_debt');
    expect(debtRepository.logRepayment).not.toHaveBeenCalled();
  });

  it('returns "no_matching_debt" when the counterparty has never been seen before (a brand-new name cannot have any open debt)', async () => {
    counterpartyRepository.findAllByUserId.mockResolvedValue([]);

    const result = await useCase.execute(makeInput({ counterpartyName: 'Someone New' }));

    expect(result.kind).toBe('no_matching_debt');
    expect(debtRepository.findOpenByCounterparty).not.toHaveBeenCalled();
  });

  it('returns "debt_ambiguous" when multiple open debts match the same counterparty+direction+currency', async () => {
    const debt1 = makeDebt({ id: 'debt-1', outstandingBalance: '50000' });
    const debt2 = makeDebt({ id: 'debt-2', outstandingBalance: '80000' });
    debtRepository.findOpenByCounterparty.mockResolvedValue([debt1, debt2]);

    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('debt_ambiguous');
    if (result.kind === 'debt_ambiguous') {
      expect(result.candidates).toHaveLength(2);
    }
    expect(debtRepository.logRepayment).not.toHaveBeenCalled();
  });

  it('returns "counterparty_ambiguous" when multiple plausible counterparties exist, before ever querying debts', async () => {
    const c1 = makeCounterparty({ id: 'c-1', name: 'Aziz Karimov' });
    const c2 = makeCounterparty({ id: 'c-2', name: 'Aziz Yusupov' });
    counterpartyRepository.findAllByUserId.mockResolvedValue([c1, c2]);

    const result = await useCase.execute(makeInput({ counterpartyName: 'Aziz' }));

    expect(result.kind).toBe('counterparty_ambiguous');
    expect(debtRepository.findOpenByCounterparty).not.toHaveBeenCalled();
  });

  it('never matches a debt in a different currency (TASK-FIN-007 FX conversion is out of scope)', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([makeDebt({ currency: 'USD' })]);

    const result = await useCase.execute(makeInput({ currency: 'UZS' }));

    expect(result.kind).toBe('no_matching_debt');
  });

  it('applies a partial repayment (outstanding balance decreases, debt stays open)', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([
      makeDebt({ outstandingBalance: '100000' }),
    ]);

    const result = await useCase.execute(makeInput({ amount: '30000' }));

    expect(result.kind).toBe('repaid');
    if (result.kind === 'repaid') {
      expect(result.cappedFromOverpayment).toBe(false);
    }
  });

  it('applies a full repayment', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([
      makeDebt({ outstandingBalance: '30000' }),
    ]);
    debtRepository.logRepayment.mockResolvedValue({
      debt: makeDebt({ outstandingBalance: '0', status: 'repaid' }),
      repayment: { id: 'repayment-1', debtId: 'debt-1', amount: '30000' },
    });

    const result = await useCase.execute(makeInput({ amount: '30000' }));

    expect(result.kind).toBe('repaid');
    if (result.kind === 'repaid') {
      expect(result.debt.outstandingBalance).toBe('0');
    }
  });

  it('returns "overpayment_confirmation_required" (never silently applying) when the amount exceeds the outstanding balance, and confirmOverpayment is not set (BR-DBT-001)', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([
      makeDebt({ outstandingBalance: '20000' }),
    ]);

    const result = await useCase.execute(makeInput({ amount: '50000' }));

    expect(result.kind).toBe('overpayment_confirmation_required');
    if (result.kind === 'overpayment_confirmation_required') {
      expect(result.attemptedAmount).toBe('50000');
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(debtRepository.logRepayment).not.toHaveBeenCalled();
  });

  it('applies a confirmed overpayment CAPPED at the outstanding balance, flagging cappedFromOverpayment', async () => {
    debtRepository.findOpenByCounterparty.mockResolvedValue([
      makeDebt({ outstandingBalance: '20000' }),
    ]);

    const result = await useCase.execute(makeInput({ amount: '50000', confirmOverpayment: true }));

    expect(debtRepository.logRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '20000' }), // capped, not the stated 50000
    );
    expect(result.kind).toBe('repaid');
    if (result.kind === 'repaid') {
      expect(result.cappedFromOverpayment).toBe(true);
    }
  });

  it('returns "debt_no_longer_open" when the atomic write loses a genuine concurrency race', async () => {
    debtRepository.logRepayment.mockResolvedValue(null);

    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('debt_no_longer_open');
  });

  it('throws UserNotFoundError when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
  });
});
