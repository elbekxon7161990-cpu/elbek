import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  FxRateRepository,
  NewTransactionData,
  SavingsGoalRepository,
  Transaction,
  TransactionCreatedBy,
  TransactionRepository,
  TransactionSourceType,
  UserRepository,
} from '@afa/domain';
import {
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  FX_RATE_REPOSITORY,
  normalizeTransactionInput,
  SAVINGS_GOAL_REPOSITORY,
  TRANSACTION_REPOSITORY,
  Transaction as TransactionEntity,
  USER_REPOSITORY,
  ACCOUNT_REPOSITORY,
} from '@afa/domain';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { SavingsGoalNotFoundError } from '../errors/savings-goal-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedGoalAccessError } from '../errors/unauthorized-goal-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { resolveTransactionExchangeRate } from './resolve-transaction-exchange-rate';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';
import { validateTransactionReferences } from './validate-transaction-references';

/**
 * TASK-FIN-004 (Stage C, Chapter 8 §8.9, FR-FIN-012) — the STANDALONE
 * `GOAL_CONTRIBUTION` mode (mode A of the two approved contribution
 * mechanisms; mode B is `CreateTransferUseCase`'s own optional `goalId`).
 * Per TASK-FIN-004 Stage A's approved architecture decision, a standalone
 * contribution NEVER reduces any account's balance (BR-FIN-003 — "has not
 * left the user's net worth, only been earmarked") — `accountId` here is
 * optional, attribution-only (FR-FIN-023's generalization), never resolved
 * to an implicit default the way Expense/Income's `accountId` is (there is
 * no balance-affecting reason to require one).
 *
 * `categoryId` is resolved internally via `CategoryRepository.findByCode('SAVINGS')`
 * — same disclosed Stage C decision as `CreateTransferUseCase`'s own
 * `'TRANSFER'` resolution; see that class's doc comment for the full
 * evidentiary basis (the seeded canonical taxonomy already has a
 * `code: 'SAVINGS'` entry, `defaultType: 'neutral'`).
 */
export interface ContributeToSavingsGoalInput {
  userId: string;
  goalId: string;
  amount: string;
  currency: string;
  accountId?: string;
  transactionDate: Date;
  description: string;
  originalText: string;
  sourceType: TransactionSourceType;
  createdBy: TransactionCreatedBy;
}

@Injectable()
export class ContributeToSavingsGoalUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(SAVINGS_GOAL_REPOSITORY) private readonly savingsGoalRepository: SavingsGoalRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
    @Inject(FX_RATE_REPOSITORY) private readonly fxRateRepository: FxRateRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
  ) {}

  async execute(input: ContributeToSavingsGoalInput): Promise<Transaction> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const goal = await this.savingsGoalRepository.findById(input.goalId);
    if (!goal || goal.isDeleted) {
      throw new SavingsGoalNotFoundError(input.goalId);
    }
    if (goal.userId !== input.userId) {
      throw new UnauthorizedGoalAccessError(input.goalId, input.userId);
    }
    // FR-FIN-014 — "further contributions remain possible" even after
    // completion; a completed goal's status is deliberately NOT checked
    // here as a rejection condition.

    if (input.accountId !== undefined) {
      const account = await this.accountRepository.findById(input.accountId);
      if (!account || account.isDeleted) {
        throw new AccountNotFoundError(input.accountId);
      }
      if (account.userId !== input.userId) {
        throw new UnauthorizedAccountAccessError(input.accountId, input.userId);
      }
    }

    const savingsCategory = await this.categoryRepository.findByCode('SAVINGS');
    if (!savingsCategory) {
      throw new CategoryNotFoundError('SAVINGS');
    }

    const [exchangeRateToDefault] = await Promise.all([
      resolveTransactionExchangeRate(
        this.fxRateRepository,
        input.currency,
        user.defaultCurrency,
        input.transactionDate,
      ),
      validateTransactionReferences(
        this.currencyRepository,
        this.categoryRepository,
        input.currency,
        savingsCategory.id,
      ),
    ]);

    const data: NewTransactionData = {
      userId: input.userId,
      transactionType: 'GOAL_CONTRIBUTION',
      amount: input.amount,
      currency: input.currency,
      exchangeRateToDefault,
      accountId: input.accountId,
      goalId: input.goalId,
      categoryId: savingsCategory.id,
      transactionDate: input.transactionDate,
      description: input.description,
      originalText: input.originalText,
      sourceType: input.sourceType,
      createdBy: input.createdBy,
    };

    const now = new Date();
    const referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);

    TransactionEntity.validateNew(normalizeTransactionInput(data), now, referenceLocalDate);

    return this.transactionRepository.create(data);
  }
}
