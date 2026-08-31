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
  ACCOUNT_REPOSITORY,
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  FX_RATE_REPOSITORY,
  normalizeTransactionInput,
  SAVINGS_GOAL_REPOSITORY,
  TRANSACTION_REPOSITORY,
  Transaction as TransactionEntity,
  USER_REPOSITORY,
} from '@afa/domain';

import { AccountNotFoundError } from '../errors/account-not-found.error';
import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { MissingDestinationAmountError } from '../errors/missing-destination-amount.error';
import { SavingsGoalNotFoundError } from '../errors/savings-goal-not-found.error';
import { UnauthorizedAccountAccessError } from '../errors/unauthorized-account-access.error';
import { UnauthorizedGoalAccessError } from '../errors/unauthorized-goal-access.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { resolveTransactionExchangeRate } from './resolve-transaction-exchange-rate';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';
import { validateTransactionReferences } from './validate-transaction-references';

/**
 * TASK-FIN-004 (Stage C, Chapter 8 §8.7). Structured input only, mirroring
 * `CreateExpenseUseCase`'s own precedent.
 *
 * `currency`/`categoryId` are deliberately NOT caller inputs — see this
 * class's own doc comment below for both decisions.
 *
 * `destinationAmount` is optional, user-supplied only (FR-FIN-005's own
 * "user-supplied OR system-estimated" wording explicitly permits the
 * user-supplied mechanism alone) — required only when the source and
 * destination accounts' currencies differ; Stage C deliberately does NOT
 * auto-compute a system-estimated conversion (see the class doc comment).
 *
 * `goalId` is optional — the approved "linked transfer" savings-goal
 * contribution mode (FR-FIN-012), mutually exclusive by construction with
 * `ContributeToSavingsGoalUseCase`'s standalone `GOAL_CONTRIBUTION` mode.
 */
export interface CreateTransferInput {
  userId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  destinationAmount?: string;
  goalId?: string;
  transactionDate: Date;
  description: string;
  originalText: string;
  sourceType: TransactionSourceType;
  createdBy: TransactionCreatedBy;
}

/**
 * FR-FIN-004/005/006 (§8.7) — creates a `TRANSFER` transaction between two of
 * the user's own accounts. Verifies the user and both accounts exist and are
 * owned by the caller, enforces domain invariants (including AC-FIN-007's
 * same-account rejection — reused unchanged from `Transaction.validateNew`,
 * TASK-FIN-004 Stage A, never reimplemented here), then persists exactly one
 * `Transaction` row (ADR-DB-002/TASK-FIN-004 Stage A — never two).
 *
 * TWO DELIBERATE, DISCLOSED STAGE-C SCOPE DECISIONS (neither is a PRD
 * ambiguity the way the Loan-payment questions are — both are implementation
 * choices made with direct evidence, flagged for visibility, not silently
 * invented):
 *
 * 1. `currency` is derived from `sourceAccount.currency`, never a separate
 *    caller input — the transfer's own `amount` is always denominated in
 *    the account it leaves. Similarly, `destinationAmount` (when needed) is
 *    implicitly in `destinationAccount.currency`. This avoids an entire
 *    class of "currency doesn't match either account" invalid-input states
 *    Expense/Income's own free-standing `currency` field never has to guard
 *    against (an Expense/Income isn't tied to two specific accounts the way
 *    a Transfer inherently is).
 *
 * 2. `categoryId` is resolved internally via `CategoryRepository.findByCode('TRANSFER')`
 *    — NOT a caller input. TASK-FIN-006 (full category modeling) does not
 *    exist yet, but `packages/infrastructure/prisma/seed.ts` already seeds
 *    the exact canonical 32-category taxonomy from Chapter 4 §4.4.3
 *    verbatim, which includes a `code: 'TRANSFER'` entry
 *    (`defaultType: 'neutral'`) — real, PRD-sourced, already-seeded
 *    repository evidence, not an invented category. No FR states this
 *    mapping explicitly (the taxonomy's existence and a transaction's own
 *    NOT NULL `category_id` FK are what make some resolution necessary at
 *    all), so this is disclosed as a Stage C engineering decision, not
 *    represented as an explicit requirement — reported for your visibility
 *    per the Stage C go-ahead's category-ID instruction, not silently
 *    decided.
 *
 * NOT implemented in Stage C: system-estimated `destinationAmount`
 * auto-computation via `FxRateRepository` when the caller omits it. FR-FIN-005's
 * own wording ("user-supplied OR system-estimated") makes the user-supplied
 * mechanism alone sufficient to satisfy the requirement. Auto-computing an
 * estimate would require multiplying two canonical decimal strings (amount ×
 * rate) and rounding to 2 decimal places — a decimal-arithmetic primitive
 * that does not exist anywhere in `@afa/domain` yet (only `compareDecimalAmounts`/
 * `subtractDecimalAmounts` exist; TASK-FIN-004 Stage A already deferred the
 * same class of new-primitive risk for the Loan amortization formula). Rather
 * than introduce an unreviewed new primitive un-prompted, a cross-currency
 * transfer without a supplied `destinationAmount` is rejected
 * (`MissingDestinationAmountError`) instead of silently guessed.
 */
@Injectable()
export class CreateTransferUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
    @Inject(SAVINGS_GOAL_REPOSITORY) private readonly savingsGoalRepository: SavingsGoalRepository,
    @Inject(FX_RATE_REPOSITORY) private readonly fxRateRepository: FxRateRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
  ) {}

  async execute(input: CreateTransferInput): Promise<Transaction> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError(input.userId);
    }

    const [sourceAccount, destinationAccount] = await Promise.all([
      this.accountRepository.findById(input.sourceAccountId),
      this.accountRepository.findById(input.destinationAccountId),
    ]);

    if (!sourceAccount || sourceAccount.isDeleted) {
      throw new AccountNotFoundError(input.sourceAccountId);
    }
    if (sourceAccount.userId !== input.userId) {
      throw new UnauthorizedAccountAccessError(input.sourceAccountId, input.userId);
    }
    if (!destinationAccount || destinationAccount.isDeleted) {
      throw new AccountNotFoundError(input.destinationAccountId);
    }
    if (destinationAccount.userId !== input.userId) {
      throw new UnauthorizedAccountAccessError(input.destinationAccountId, input.userId);
    }

    if (input.goalId !== undefined) {
      const goal = await this.savingsGoalRepository.findById(input.goalId);
      if (!goal || goal.isDeleted) {
        throw new SavingsGoalNotFoundError(input.goalId);
      }
      if (goal.userId !== input.userId) {
        throw new UnauthorizedGoalAccessError(input.goalId, input.userId);
      }
    }

    const isCrossCurrency = sourceAccount.currency !== destinationAccount.currency;
    if (isCrossCurrency && input.destinationAmount === undefined) {
      throw new MissingDestinationAmountError(sourceAccount.currency, destinationAccount.currency);
    }

    const transferCategory = await this.categoryRepository.findByCode('TRANSFER');
    if (!transferCategory) {
      throw new CategoryNotFoundError('TRANSFER');
    }

    const [exchangeRateToDefault] = await Promise.all([
      resolveTransactionExchangeRate(
        this.fxRateRepository,
        sourceAccount.currency,
        user.defaultCurrency,
        input.transactionDate,
      ),
      validateTransactionReferences(
        this.currencyRepository,
        this.categoryRepository,
        sourceAccount.currency,
        transferCategory.id,
      ),
    ]);

    const data: NewTransactionData = {
      userId: input.userId,
      transactionType: 'TRANSFER',
      amount: input.amount,
      currency: sourceAccount.currency,
      exchangeRateToDefault,
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      destinationAmount: isCrossCurrency ? input.destinationAmount : undefined,
      goalId: input.goalId,
      categoryId: transferCategory.id,
      transactionDate: input.transactionDate,
      description: input.description,
      originalText: input.originalText,
      sourceType: input.sourceType,
      createdBy: input.createdBy,
    };

    const now = new Date();
    const referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);

    // Every domain invariant (including AC-FIN-007's same-account rejection
    // and §8.7's required-fields shape) is enforced here — reused unchanged
    // from TASK-FIN-004 Stage A, never reimplemented.
    TransactionEntity.validateNew(normalizeTransactionInput(data), now, referenceLocalDate);

    return this.transactionRepository.create(data);
  }
}
