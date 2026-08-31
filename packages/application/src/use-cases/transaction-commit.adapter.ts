import { Inject, Injectable } from '@nestjs/common';
import type {
  CategoryRepository,
  CommitIdempotencyLockPort,
  TransactionCommitPort,
  TransactionCommitRequest,
  TransactionCommitResult,
} from '@afa/domain';
import { CATEGORY_REPOSITORY, COMMIT_IDEMPOTENCY_LOCK } from '@afa/domain';

import { CategoryNotFoundError } from '../errors/category-not-found.error';
import { IncompleteTransactionCandidateError } from '../errors/incomplete-transaction-candidate.error';
import { TransactionCommitInProgressError } from '../errors/transaction-commit-in-progress.error';
import { UnsupportedTransactionIntentError } from '../errors/unsupported-transaction-intent.error';
import { CreateExpenseUseCase } from './create-expense.use-case';
import type { CreateExpenseInput } from './create-expense.use-case';
import { CreateIncomeUseCase } from './create-income.use-case';

/** BR-CE-006-style — long enough to cover a genuine retry window, short enough that a crashed claimant (no `release` ever called) doesn't block a real future retry indefinitely. */
const CLAIM_TTL_SECONDS = 30;
/** How long a completed commit's result stays discoverable to a late duplicate caller. */
const RESULT_TTL_SECONDS = 24 * 60 * 60;

const INCOME_LIKE_INTENTS = new Set(['INCOME', 'SALARY', 'REFUND']);

function idempotencyKeyFor(userId: string, draftId: string): string {
  return `transaction_commit:${userId}:${draftId}`;
}

/**
 * TASK-FIN-REAL-001 — the real `TransactionCommitPort` implementation
 * (TASK-BOT-002's "hand off to the Domain Service Layer" boundary).
 * Deliberately an `@afa/application` class, not `@afa/infrastructure` —
 * it reuses `CreateExpenseUseCase`/`CreateIncomeUseCase` (TASK-FIN-001)
 * directly for every validation/persistence step, and `@afa/infrastructure`
 * must never depend on `@afa/application` (that package's own boundary
 * rule), so an infrastructure-layer adapter could not call them without
 * duplicating their logic. This class is pure orchestration: resolve the
 * category code, map the candidate's fields onto `NewTransactionData`,
 * dispatch to the correct use case by intent, all behind an idempotency
 * claim.
 *
 * Never persists anything itself — `CreateExpenseUseCase`/
 * `CreateIncomeUseCase` (and, transitively, `PrismaTransactionRepository`)
 * remain the only place a `transactions` row is written, so this task does
 * not create "a second transaction persistence system."
 */
@Injectable()
export class TransactionCommitAdapter implements TransactionCommitPort {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    @Inject(COMMIT_IDEMPOTENCY_LOCK) private readonly idempotencyLock: CommitIdempotencyLockPort,
    private readonly createExpense: CreateExpenseUseCase,
    private readonly createIncome: CreateIncomeUseCase,
  ) {}

  async commit(request: TransactionCommitRequest): Promise<TransactionCommitResult> {
    const key = idempotencyKeyFor(request.userId, request.draftId);

    const claimed = await this.idempotencyLock.tryClaim(key, CLAIM_TTL_SECONDS);
    if (!claimed) {
      const existing = await this.idempotencyLock.getResult(key);
      if (existing) {
        return { transactionId: existing };
      }
      throw new TransactionCommitInProgressError(request.draftId);
    }

    try {
      const transactionId = await this.performCommit(request);
      await this.idempotencyLock.storeResult(key, transactionId, RESULT_TTL_SECONDS);
      return { transactionId };
    } catch (error) {
      // Never leaves a failed attempt's claim in place — a legitimate retry
      // (e.g. after a transient database failure) must not be permanently
      // blocked by its own prior failure.
      await this.idempotencyLock.release(key);
      throw error;
    }
  }

  private async performCommit(request: TransactionCommitRequest): Promise<string> {
    const { candidate } = request;

    const amount = candidate.amount;
    const currency = candidate.currency;
    const transactionDate = candidate.transactionDate;
    const categoryCode = candidate.category;
    if (amount === null) {
      throw new IncompleteTransactionCandidateError('amount');
    }
    if (currency === null) {
      throw new IncompleteTransactionCandidateError('currency');
    }
    if (transactionDate === null) {
      throw new IncompleteTransactionCandidateError('transactionDate');
    }
    if (categoryCode === null) {
      throw new IncompleteTransactionCandidateError('category');
    }

    const categoryRef = await this.categoryRepository.findByCode(categoryCode);
    if (!categoryRef || categoryRef.status === 'deprecated') {
      throw new CategoryNotFoundError(categoryCode);
    }

    const subcategoryId = await this.resolveOptionalCategoryCode(candidate.subcategory);

    const shared: CreateExpenseInput = {
      userId: request.userId,
      amount: amount.toFixed(2),
      currency,
      categoryId: categoryRef.id,
      subcategoryId,
      merchant: candidate.merchant ?? undefined,
      paymentMethod: candidate.paymentMethod ?? undefined,
      transactionDate: new Date(`${transactionDate}T00:00:00.000Z`),
      transactionTime: candidate.transactionTime ?? undefined,
      location: candidate.location ?? undefined,
      tags: candidate.tags,
      description: candidate.description,
      originalText: request.originalText,
      sourceType: request.sourceType,
      sourceReference: request.draftId,
      confidenceScores: candidate.confidenceScores,
      createdBy: 'ai',
    };

    if (candidate.intent === 'EXPENSE') {
      const result = await this.createExpense.execute(shared);
      return result.transaction.id;
    }

    if (INCOME_LIKE_INTENTS.has(candidate.intent)) {
      const transaction = await this.createIncome.execute({
        ...shared,
        transactionType: candidate.intent as 'INCOME' | 'SALARY' | 'REFUND',
      });
      return transaction.id;
    }

    throw new UnsupportedTransactionIntentError(candidate.intent);
  }

  /** Best-effort — an unresolvable/deprecated subcategory code is dropped, never blocks the commit (unlike the primary category, subcategory is not a required DB column). */
  private async resolveOptionalCategoryCode(code: string | null): Promise<string | undefined> {
    if (!code) {
      return undefined;
    }
    const ref = await this.categoryRepository.findByCode(code);
    return ref && ref.status !== 'deprecated' ? ref.id : undefined;
  }
}
