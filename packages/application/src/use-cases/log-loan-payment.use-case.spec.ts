import type { LoanPayment, LoanProps, LoanRepository, User, UserRepository } from '@afa/domain';
import { Loan, LoanOverpaymentError, NegativeAmortizationError } from '@afa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoanNotFoundError } from '../errors/loan-not-found.error';
import { UnauthorizedLoanAccessError } from '../errors/unauthorized-loan-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { type LogLoanPaymentInput, LogLoanPaymentUseCase } from './log-loan-payment.use-case';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', timezone: 'UTC', ...overrides } as User;
}

/** A REAL `Loan` domain entity (not a plain mock) — `applyPayment`'s own real logic must run for these tests to be meaningful, since that is exactly what the use case under test relies on for its pre-check. */
function makeLoan(overrides: Partial<LoanProps> = {}): Loan {
  return new Loan({
    id: 'loan-1',
    userId: 'user-1',
    lender: 'Ipoteka Bank',
    principalAmount: '1000000.00',
    outstandingBalance: '1000000.00',
    currency: 'UZS',
    interestRate: null,
    installmentAmount: '90000.00',
    installmentFrequency: 'monthly',
    startDate: new Date('2026-08-01'),
    status: 'open',
    deletedAt: null,
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    ...overrides,
  });
}

function makeInput(overrides: Partial<LogLoanPaymentInput> = {}): LogLoanPaymentInput {
  return {
    userId: 'user-1',
    loanId: 'loan-1',
    amount: '90000.00',
    paymentDate: new Date('2026-08-18'),
    ...overrides,
  };
}

describe('LogLoanPaymentUseCase', () => {
  let userRepository: { findById: ReturnType<typeof vi.fn> };
  let loanRepository: { findById: ReturnType<typeof vi.fn>; logPayment: ReturnType<typeof vi.fn> };
  let useCase: LogLoanPaymentUseCase;

  beforeEach(() => {
    userRepository = { findById: vi.fn().mockResolvedValue(makeUser()) };
    loanRepository = {
      findById: vi.fn().mockResolvedValue(makeLoan()),
      logPayment: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          loan: makeLoan({ outstandingBalance: '910000.00' }),
          payment: {
            id: 'payment-1',
            loanId: data.loanId,
            amount: data.amount,
            principalPortion: '90000.00',
            paymentDate: data.paymentDate,
            createdAt: new Date(),
          } as LoanPayment,
        }),
      ),
    };

    useCase = new LogLoanPaymentUseCase(
      userRepository as unknown as UserRepository,
      loanRepository as unknown as LoanRepository,
    );
  });

  it('A — applies a valid payment (happy path)', async () => {
    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('applied');
    expect(loanRepository.logPayment).toHaveBeenCalledWith({
      loanId: 'loan-1',
      amount: '90000.00',
      paymentDate: new Date('2026-08-18'),
    });
  });

  it('B — rejects when the user does not exist', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(UserNotFoundError);
    expect(loanRepository.logPayment).not.toHaveBeenCalled();
  });

  it('C — rejects when the loan does not exist (missing entity)', async () => {
    loanRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute(makeInput())).rejects.toThrow(LoanNotFoundError);
    expect(loanRepository.logPayment).not.toHaveBeenCalled();
  });

  it('D — rejects when the loan belongs to another user (ownership failure)', async () => {
    loanRepository.findById.mockResolvedValue(makeLoan({ userId: 'other-user' }));

    await expect(useCase.execute(makeInput())).rejects.toThrow(UnauthorizedLoanAccessError);
    expect(loanRepository.logPayment).not.toHaveBeenCalled();
  });

  it('E — OVERPAYMENT = REJECT: propagates LoanOverpaymentError directly, never calls the repository', async () => {
    loanRepository.findById.mockResolvedValue(makeLoan({ outstandingBalance: '50000.00' }));

    await expect(useCase.execute(makeInput({ amount: '50000.01' }))).rejects.toThrow(
      LoanOverpaymentError,
    );
    expect(loanRepository.logPayment).not.toHaveBeenCalled();
  });

  it('F — NEGATIVE AMORTIZATION = REJECT: propagates NegativeAmortizationError directly, never calls the repository', async () => {
    loanRepository.findById.mockResolvedValue(
      makeLoan({ interestRate: '0.1200', outstandingBalance: '1000000.00' }),
    );

    // interest due = 1,000,000 * 0.12 / 12 = 10,000.00; 500 doesn't cover it.
    await expect(useCase.execute(makeInput({ amount: '500.00' }))).rejects.toThrow(
      NegativeAmortizationError,
    );
    expect(loanRepository.logPayment).not.toHaveBeenCalled();
  });

  it('G — PARTIAL/IRREGULAR PAYMENTS = ALLOWED: a payment far below installmentAmount is accepted', async () => {
    const result = await useCase.execute(makeInput({ amount: '500.00' }));

    expect(result.kind).toBe('applied');
    expect(loanRepository.logPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '500.00' }),
    );
  });

  it('H — returns a "conflict" outcome when the repository backstop loses a concurrency race (null return)', async () => {
    loanRepository.logPayment.mockResolvedValue(null);

    const result = await useCase.execute(makeInput());

    expect(result.kind).toBe('conflict');
  });
});
