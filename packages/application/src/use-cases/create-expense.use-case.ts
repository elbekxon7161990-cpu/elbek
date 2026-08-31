import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountRepository,
  CategoryRepository,
  CurrencyRepository,
  ExpenseHistoryRepository,
  FxRateRepository,
  NewTransactionData,
  TransactionRepository,
  UserRepository,
} from '@afa/domain';
import {
  ACCOUNT_REPOSITORY,
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  EXPENSE_HISTORY_REPOSITORY,
  FX_RATE_REPOSITORY,
  normalizeTransactionInput,
  TRANSACTION_REPOSITORY,
  Transaction,
  USER_REPOSITORY,
} from '@afa/domain';

import { UserNotFoundError } from '../errors/user-not-found.error';
import { evaluateLargeAmountSanityCheck } from './evaluate-large-amount-sanity-check';
import { resolveTransactionAccountId } from './resolve-transaction-account-id';
import { resolveTransactionExchangeRate } from './resolve-transaction-exchange-rate';
import { resolveUserLocalReferenceDate } from './resolve-user-local-reference-date';
import { validateTransactionReferences } from './validate-transaction-references';

/**
 * TASK-FIN-001 (Chapter 8 §8.1) — structured input only. AI extraction from
 * natural language belongs to TASK-AI-*, upstream of this use case.
 *
 * TASK-FIN-007 (Stage E) — `exchangeRateToDefault` is excluded: it is a
 * system-computed snapshot (FR-FIN-027, "captured at transaction time"),
 * never a caller-trusted input, the same "provenance/pipeline field"
 * treatment `TransactionEditableFields` already gives it. `accountId`
 * remains an optional caller input (FR-FIN-023).
 */
export type CreateExpenseInput = Omit<
  NewTransactionData,
  'transactionType' | 'linkedTransactionId' | 'exchangeRateToDefault'
>;

/**
 * FR-EXP-004 — "committed but flagged", never blocked. No database column
 * currently exists to durably represent this (see the final-gap-fix
 * report's schema-gap note); until one is added, the signal is surfaced
 * here, in the use case's own result, for whichever caller creates the
 * transaction (a future Telegram bot or API handler) to act on immediately
 * (e.g. the PRD's "This is unusually large — correct?" inline prompt).
 */
export interface CreateExpenseResult {
  transaction: Transaction;
  largeAmountFlagged: boolean;
}

/**
 * FR-EXP-001–004 — creates an `EXPENSE` transaction from already-structured
 * input: verifies the user exists, verifies currency/category, enforces
 * domain invariants (including BR-EXP-002's user-timezone-aware future-date
 * rule, which has no database-level CHECK), evaluates the FR-EXP-004
 * large-amount sanity check (never blocking), then persists.
 */
@Injectable()
export class CreateExpenseUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly transactionRepository: TransactionRepository,
    @Inject(EXPENSE_HISTORY_REPOSITORY)
    private readonly expenseHistoryRepository: ExpenseHistoryRepository,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepository: AccountRepository,
    @Inject(FX_RATE_REPOSITORY) private readonly fxRateRepository: FxRateRepository,
  ) {}

  async execute(input: CreateExpenseInput): Promise<CreateExpenseResult> {
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
    // same as every other domain invariant this use case already checks
    // up front.
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

    const data: NewTransactionData = {
      ...input,
      transactionType: 'EXPENSE',
      accountId,
      exchangeRateToDefault,
    };

    const now = new Date();
    // BR-EXP-002 — "not in the future" is evaluated against the user's own
    // local calendar date, not server UTC.
    const referenceLocalDate = resolveUserLocalReferenceDate(now, user.timezone);

    // Every other domain invariant is enforced here too, because there is
    // no database CHECK constraint backing most of them.
    Transaction.validateNew(normalizeTransactionInput(data), now, referenceLocalDate);

    // FR-EXP-004 — computed against history only (the new transaction
    // doesn't exist yet at this point, so it can never skew its own
    // average), same-currency only (cross-currency needs TASK-FIN-007's FX
    // conversion, out of scope here), and never blocks creation.
    const trailingAverage = await this.expenseHistoryRepository.getTrailingAverageExpenseAmount(
      input.userId,
      input.currency,
      now,
    );
    const largeAmountFlagged = evaluateLargeAmountSanityCheck(input.amount, trailingAverage);

    const transaction = await this.transactionRepository.create(data);

    return { transaction, largeAmountFlagged };
  }
}
