import { Inject, Injectable } from '@nestjs/common';
import type {
  Account,
  AccountRepository,
  AccountType,
  CurrencyRepository,
  UserRepository,
} from '@afa/domain';
import {
  ACCOUNT_REPOSITORY,
  Account as AccountEntity,
  CURRENCY_REPOSITORY,
  USER_REPOSITORY,
} from '@afa/domain';

import { InvalidCurrencyError } from '../errors/invalid-currency.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

/**
 * TASK-FIN-007 (Stage D, FR-FIN-022) — structured input only, mirroring
 * `CreateBudgetUseCase`'s own precedent. `isDefault` is never accepted from
 * the caller: per §8.12.4, `isDefault: true` is set exclusively by the
 * implicit-default-account mechanism (`AccountRepository.findOrCreateDefaultForCurrency`,
 * Stage B), never by an explicit user-initiated account creation — no FR
 * states an explicitly-created account should ever auto-become the default.
 */
export interface CreateAccountInput {
  userId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  startingBalance: string;
}

@Injectable()
export class CreateAccountUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
  ) {}

  async execute(input: CreateAccountInput): Promise<Account> {
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
      accountType: input.accountType,
      currency: input.currency,
      startingBalance: input.startingBalance,
      isDefault: false,
    };

    AccountEntity.validateNew(data);

    return this.accountRepository.create(data);
  }
}
