import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  FxRateRepository,
  NewTransactionData,
  TransactionRepository,
  UserRepository,
} from '@afa/domain';
import {
  ACCOUNT_REPOSITORY,
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  FX_RATE_REPOSITORY,
  normalizeTransactionInput,
  TRANSACTION_REPOSITORY,
  Transaction,
  USER_REPOSITORY,
} from '@afa/domain';

import { UserNotFoundError } from '../errors/user-not-found.error';
import { resolveTransactionAccountId } from './resolve-transaction-account-id';
import { resolveTransactionExchangeRate } from './resolve-transaction-exchange-rate';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';
import { validateTransactionReferences } from './validate-transaction-references';

/**
 * TASK-FIN-001 (Chapter 8 §8.2) — structured input only, covers `INCOME`,
 * `SALARY`, and `REFUND` (FR-INC-001). AI classification is TASK-AI-*'s job.
 *
 * TASK-FIN-007 (Stage E) — `exchangeRateToDefault` is excluded: system-
 * computed (FR-FIN-027), same treatment `CreateExpenseInput` already gives
 * it. `accountId` remains an optional caller input (FR-FIN-023).
 */
export type CreateIncomeInput = Omit<
  NewTransactionData,
  'transactionType' | 'exchangeRateToDefault'
> & {
  transactionType: 'INCOME' | 'SALARY' | 'REFUND';
};

/**
 * FR-INC-001–004 — mirrors Create Expense's validation rigor (same
 * user/currency/category/date checks) for the three income-side types.
 * `SALARY`'s recurrence hint (`isRecurringDetected`, FR-INC-002) and
 * `REFUND`'s optional `linkedTransactionId` (FR-INC-003) pass through
 * untouched — `normalizeTransactionInput` only ever fills a default when the
 * caller omits the field, so an explicitly-supplied value is never dropped.
 */
@Injectable()
export class CreateIncomeUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
    @Inject(FX_RATE_REPOSITORY) private readonly fxRateRepository: FxRateRepository,
  ) {}

  async execute(input: CreateIncomeInput): Promise<Transaction> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    await validateTransactionReferences(
      this.currencyRepository,
      this.categoryRepository,
      input.currency,
      input.categoryId,
    );

    // TASK-FIN-007 (Stage E, FR-FIN-023/027) — resolved before persistence,
    // mirroring CreateExpenseUseCase exactly.
    const [accountId, exchangeRateToDefault] = await Promise.all([
      resolveTransactionAccountId(
        this.accountRepository,
        input.userId,
        input.currency,
        input.accountId,
      ),
      resolveTransactionExchangeRate(
        this.fxRateRepository,
        input.currency,
        user.defaultCurrency,
        input.transactionDate,
      ),
    ]);

    const data: NewTransactionData = { ...input, accountId, exchangeRateToDefault };

    const now = new Date();
    // BR-EXP-002 — "not in the future" is evaluated against the user's own
    // local calendar date, not server UTC.
    const referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);
    Transaction.validateNew(normalizeTransactionInput(data), now, referenceLocalDate);

    return this.transactionRepository.create(data);
  }
}
