import type { NewTransactionData } from '../repositories/transaction.repository';
import type { NewTransactionValidationProps } from './transaction.entity';

/**
 * `NewTransactionData` (the `TransactionRepository.create` input) uses
 * optional (`field?: T`) properties for anything nullable; `Transaction`'s
 * own `NewTransactionValidationProps` (consumed by `Transaction.validateNew`)
 * requires the same fields as explicit `T | null`. This is the one place
 * that translation happens — originally TASK-FIN-001's own application-layer
 * helper (shared by `CreateExpenseUseCase`/`CreateIncomeUseCase` so the
 * mapping couldn't drift between the two), moved here so
 * `PrismaTransactionRepository.create()` (infrastructure — TASK-REP-007-FIX)
 * can call the exact same validation those use cases already call, instead
 * of duplicating this mapping a third time. `packages/infrastructure` must
 * never depend on `@afa/application`, so this had to live somewhere both
 * layers can reach — `@afa/domain`, which neither depends on the other, is
 * the only place that works.
 */
export function normalizeTransactionInput(
  input: NewTransactionData,
): NewTransactionValidationProps {
  return {
    userId: input.userId,
    transactionType: input.transactionType,
    amount: input.amount,
    currency: input.currency,
    exchangeRateToDefault: input.exchangeRateToDefault ?? null,
    accountId: input.accountId ?? null,
    sourceAccountId: input.sourceAccountId ?? null,
    destinationAccountId: input.destinationAccountId ?? null,
    destinationAmount: input.destinationAmount ?? null,
    goalId: input.goalId ?? null,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
    merchant: input.merchant ?? null,
    paymentMethod: input.paymentMethod ?? null,
    transactionDate: input.transactionDate,
    transactionTime: input.transactionTime ?? null,
    location: input.location ?? null,
    tags: input.tags ?? [],
    description: input.description,
    originalText: input.originalText,
    sourceType: input.sourceType,
    sourceReference: input.sourceReference ?? null,
    confidenceScores: input.confidenceScores ?? null,
    isRecurringDetected: input.isRecurringDetected ?? false,
    linkedTransactionId: input.linkedTransactionId ?? null,
    createdBy: input.createdBy,
  };
}
