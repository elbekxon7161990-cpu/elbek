import { Inject, Injectable } from '@nestjs/common';
import type {
  CurrencyRepository,
  SavingsGoal,
  SavingsGoalRepository,
  UserRepository,
} from '@afa/domain';
import {
  CURRENCY_REPOSITORY,
  SAVINGS_GOAL_REPOSITORY,
  SavingsGoal as SavingsGoalEntity,
  USER_REPOSITORY,
} from '@afa/domain';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * TASK-FIN-004 (Stage C, Chapter 8 §8.9, FR-FIN-011) — structured input
 * only, mirroring `CreateAccountUseCase`'s own precedent.
 */
export interface CreateSavingsGoalInput {
  userId: string;
  name: string;
  targetAmount: string;
  currency: string;
  targetDate?: Date;
}

@Injectable()
export class CreateSavingsGoalUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(SAVINGS_GOAL_REPOSITORY) private readonly savingsGoalRepository: SavingsGoalRepository,
  ) {}

  async execute(input: CreateSavingsGoalInput): Promise<SavingsGoal> {
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
      name: input.name,
      targetAmount: input.targetAmount,
      currency: input.currency,
      targetDate: input.targetDate ?? null,
    };

    // §8.9.4's creation-time-only "targetDate cannot be in the past" rule
    // (and every standing invariant) enforced here, mirroring
    // `CreateAccountUseCase`'s own explicit pre-check before delegating to
    // the repository (which independently re-validates too — the same
    // defense-in-depth `Debt`/`Loan`/`Account` creation already establish).
    SavingsGoalEntity.validateNew(data);

    return this.savingsGoalRepository.create(data);
  }
}
