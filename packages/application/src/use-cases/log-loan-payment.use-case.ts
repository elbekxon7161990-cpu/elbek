import { Inject, Injectable } from '@nestjs/common';
import type { Loan, LoanPayment, LoanRepository, UserRepository } from '@afa/domain';
import { LOAN_REPOSITORY, USER_REPOSITORY } from '@afa/domain';

import { LoanNotFoundError } from '../errors/loan-not-found.error';
import { UnauthorizedLoanAccessError } from '../errors/unauthorized-loan-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * TASK-FIN-004 (Stage F, Chapter 8 §8.8, FR-FIN-008). Structured input
 * only — `loanId` is expected to already be resolved (e.g. from a prior
 * `/loans` list step, out of this task's own Telegram-UX scope, Stage I).
 * No `currency` field — `loan_payments` has none (schema-forced, per this
 * stage's own preflight report); a payment is always implicitly in the
 * loan's own currency.
 */
export interface LogLoanPaymentInput {
  userId: string;
  loanId: string;
  amount: string;
  paymentDate: Date;
}

export interface LoanPaymentAppliedOutcome {
  kind: 'applied';
  loan: Loan;
  payment: LoanPayment;
}

/** The pre-checked loan was no longer `'open'`, or its `outstandingBalance` had already changed by the time `logPayment`'s own atomic write ran (concurrently paid off/another payment landed first) — the same real-concurrency backstop `DeleteTransactionUseCase`/`LogDebtRepaymentUseCase` document for their own repository's `null` return. */
export interface LoanPaymentConflictOutcome {
  kind: 'conflict';
}

export type LogLoanPaymentOutcome = LoanPaymentAppliedOutcome | LoanPaymentConflictOutcome;

/**
 * FR-FIN-008/§8.14.6 — logs a `LOAN_PAYMENT` against an open loan. Applies
 * the three approved Stage F product decisions via `Loan.applyPayment`'s
 * own pre-check (OVERPAYMENT = REJECT throws `LoanOverpaymentError`,
 * NEGATIVE AMORTIZATION = REJECT throws `NegativeAmortizationError`,
 * PARTIAL/IRREGULAR PAYMENTS = ALLOWED — no amount-matching check exists
 * at all) — both errors propagate directly, uncaught: per the approved
 * decisions there is no confirmation/clamping flow to branch into, unlike
 * `LogDebtRepaymentUseCase`'s own overpayment-confirmation branching for
 * the sibling concept.
 */
@Injectable()
export class LogLoanPaymentUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(LOAN_REPOSITORY) private readonly loanRepository: LoanRepository,
  ) {}

  async execute(input: LogLoanPaymentInput): Promise<LogLoanPaymentOutcome> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const loan = await this.loanRepository.findById(input.loanId);
    if (!loan || loan.isDeleted) {
      throw new LoanNotFoundError(input.loanId);
    }
    if (loan.userId !== input.userId) {
      throw new UnauthorizedLoanAccessError(input.loanId, input.userId);
    }

    // Pure pre-check (the three approved Stage F decisions) — never
    // silently applied. `logPayment`'s own atomic conditional UPDATE is
    // the real, race-safe enforcement point; this is the primary UX path.
    loan.applyPayment(input.amount);

    const result = await this.loanRepository.logPayment({
      loanId: loan.id,
      amount: input.amount,
      paymentDate: input.paymentDate,
    });

    if (result === null) {
      return { kind: 'conflict' };
    }

    return { kind: 'applied', loan: result.loan, payment: result.payment };
  }
}
