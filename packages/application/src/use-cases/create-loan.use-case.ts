import { Inject, Injectable } from '@nestjs/common';
import type {
  CurrencyRepository,
  Loan,
  LoanInstallmentFrequency,
  LoanRepository,
  UserRepository,
} from '@afa/domain';
import {
  CURRENCY_REPOSITORY,
  Loan as LoanEntity,
  LOAN_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * TASK-FIN-004 (Stage C, Chapter 8 §8.8, FR-FIN-007) — structured input
 * only, mirroring `CreateAccountUseCase`'s own precedent. Creation-only —
 * no payment-logging use-case exists in Stage C; see this task's Stage C
 * report for the exact ambiguities (auto `paid_off` transition, overpayment,
 * partial/irregular payments, payment currency mismatch, due-date
 * calculation) that block one, per ADR-FIN-002/TASK-FIN-004 Stage A's
 * "Loan is standalone from Account/Transaction" decision.
 */
export interface CreateLoanInput {
  userId: string;
  lender: string;
  principalAmount: string;
  currency: string;
  interestRate?: string;
  installmentAmount: string;
  installmentFrequency: LoanInstallmentFrequency;
  startDate: Date;
}

@Injectable()
export class CreateLoanUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(LOAN_REPOSITORY) private readonly loanRepository: LoanRepository,
  ) {}

  async execute(input: CreateLoanInput): Promise<Loan> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const currencySupported = await this.currencyRepository.isSupported(input.currency);
    if (!currencySupported) {
      throw new InvalidCurrencyError(input.currency);
    }

    const data = {
      userId: input.userId,
      lender: input.lender,
      principalAmount: input.principalAmount,
      currency: input.currency,
      interestRate: input.interestRate ?? null,
      installmentAmount: input.installmentAmount,
      installmentFrequency: input.installmentFrequency,
      startDate: input.startDate,
    };

    LoanEntity.validateNew(data);

    return this.loanRepository.create(data);
  }
}
