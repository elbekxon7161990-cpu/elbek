import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';
import { evaluateBudgetThresholdCrossing, percentOf } from '@afa/domain';

import { computeBudgetUsedAmount } from './compute-budget-used-amount';
import { formatDecimalAmount } from './format-decimal-amount';

export interface ExpenseCommitBudgetContext {
  transactionId: string;
  userId: string;
  categoryId: string;
  subcategoryId: string | null;
  transactionDate: Date;
}

/**
 * TASK-FIN-003 (FR-BUD-005, §8.22.2 `BudgetThresholdCrossed`) — the
 * synchronous half of budget-threshold detection, called from INSIDE
 * `PrismaTransactionRepository.create()`'s own `basePrisma.$transaction`
 * block, AFTER the new `EXPENSE` transaction row itself has been inserted
 * (so `computeBudgetUsedAmount`'s own aggregate query already includes it)
 * but BEFORE that transaction commits — mirroring
 * `PrismaDebtRepository.logRepayment()`'s own established "conditional
 * event emission inside the same transaction as the state change that
 * caused it" pattern (Debt Reminder Producer task), applied here to a
 * cross-cutting hook triggered by a DIFFERENT aggregate's (`Transaction`)
 * own write, per FR-FIN-048's "emitted exactly once per triggering state
 * transition, safe to consume more than once."
 *
 * A no-op for any non-`EXPENSE` transaction type — callers must only invoke
 * this for `EXPENSE` commits (BR-BUD-001's "only EXPENSE-type transactions
 * count against budget utilization by default"); this function itself does
 * not re-check `transactionType`, since its only caller already gates on it.
 *
 * CONCURRENCY HARDENING (found via a dedicated, read-only investigation):
 * `usedBefore`/`usedAfter` were originally computed via a plain, unlocked
 * `SUM` before any serialization point existed. `BudgetNotificationLog`'s
 * own `UNIQUE(budgetId, thresholdFired, periodStart)` constraint fully
 * prevents the SAME threshold from ever firing twice, but does nothing to
 * protect the SUM computation itself — under genuine concurrency, two
 * simultaneous `EXPENSE` commits against the same budget could each compute
 * their own SUM using only their own isolated contribution (never the
 * other's, since it is still uncommitted and invisible under READ
 * COMMITTED), so a threshold that only the COMBINED total crosses could be
 * silently lost — never attempted by either side, so there is nothing for
 * the unique constraint to deduplicate. Structurally the same root cause
 * already found and fixed for `evaluateSavingsGoalProgressOnContributionCommit`
 * (see that file's own doc comment) — the fix here is analogous but NOT a
 * blind copy: unlike SavingsGoal (one goal per invocation), this hook can
 * touch MULTIPLE candidate budgets in one call (a category budget AND the
 * overall budget simultaneously, FR-BUD-008), so lock ACQUISITION ORDER
 * matters — two concurrent expenses touching the same two budgets in
 * different discovery order could otherwise deadlock.
 *
 * Candidate budgets are locked in ONE query — `WHERE id IN (...) ORDER BY id
 * FOR NO KEY UPDATE` — the standard, documented Postgres technique for
 * deterministic multi-row lock ordering (Postgres locks rows as they are
 * returned to the executor, which for a query needing an explicit sort
 * happens in that sort's own output order), rather than one lock query per
 * candidate budget. This was a deliberate correction made after this fix's
 * own required real-Postgres multi-budget-contention test first failed —
 * NOT on a deadlock (none ever occurred), but on Prisma's own interactive-
 * transaction timeout (`P2028`, default 5000ms): the original per-ID
 * sequential-loop version issued up to ~4 extra round trips per candidate
 * budget, and a transaction genuinely blocked waiting for a concurrent
 * sibling's own full multi-round-trip sequence to finish could exceed that
 * ceiling over a real (non-local) Postgres connection. Combining the lock
 * acquisition into a single round trip removes most of that overhead
 * without weakening the lock-ordering guarantee at all (`FOR NO KEY UPDATE`,
 * not `FOR UPDATE` — unlike SavingsGoal, no FK from `transactions` to
 * `budgets` exists, so the specific `FOR KEY SHARE` deadlock `FOR NO KEY
 * UPDATE` was chosen to avoid for SavingsGoal may not literally apply here;
 * `FOR NO KEY UPDATE` is still the correct, minimal lock for this write —
 * it only ever changes `limit_amount`/`category_id`/period columns via
 * `EditBudgetUseCase`/rollover, never the primary key — proven deadlock-free
 * by this fix's own dedicated real-Postgres multi-budget test, run 10
 * times, rather than assumed by analogy). The locked read ALSO re-verifies
 * `status`/`deleted_at`/period-bounds fresh (not the earlier unlocked
 * discovery snapshot), since a concurrent edit/pause/soft-delete/rollover
 * could otherwise have changed them while this transaction was waiting for
 * the lock.
 */
export async function evaluateBudgetThresholdsOnExpenseCommit(
  tx: Prisma.TransactionClient,
  context: ExpenseCommitBudgetContext,
): Promise<void> {
  const candidateBudgets = await tx.budget.findMany({
    where: {
      userId: context.userId,
      status: 'active',
      deletedAt: null,
      currentPeriodStart: { lte: context.transactionDate },
      currentPeriodEnd: { gte: context.transactionDate },
      OR: [
        { scopeType: 'overall' },
        { scopeType: 'category', categoryId: context.categoryId },
        ...(context.subcategoryId
          ? [{ scopeType: 'category' as const, categoryId: context.subcategoryId }]
          : []),
      ],
    },
  });

  if (candidateBudgets.length === 0) {
    return;
  }

  // Deterministic lock order — the ONE fixed ordering every concurrent
  // invocation of this hook agrees on, regardless of which order candidate
  // budgets happened to be discovered in. Without this, two concurrent
  // expenses each touching the same category budget AND the same overall
  // budget could lock them in opposite order and deadlock.
  const sortedBudgetIds = candidateBudgets.map((budget) => budget.id).sort();

  const lockedRows = await tx.$queryRaw<
    Array<{
      id: string;
      scope_type: string;
      category_id: string | null;
      limit_amount: string;
      currency: string;
      current_period_start: Date;
      current_period_end: Date;
    }>
  >`
    SELECT id, scope_type, category_id, limit_amount::text as limit_amount, currency,
           current_period_start, current_period_end
    FROM budgets
    WHERE id::text IN (${PrismaNamespace.join(sortedBudgetIds)})
      AND user_id = ${context.userId}::uuid
      AND status = 'active'
      AND deleted_at IS NULL
      AND current_period_start <= ${context.transactionDate}
      AND current_period_end >= ${context.transactionDate}
    ORDER BY id
    FOR NO KEY UPDATE
  `;

  for (const budget of lockedRows) {
    let categoryParentId: string | null = null;
    let categoryCode: string | null = null;
    if (budget.scope_type === 'category' && budget.category_id) {
      const category = await tx.category.findUnique({
        where: { id: budget.category_id },
        select: { parentCategoryId: true, code: true },
      });
      categoryParentId = category?.parentCategoryId ?? null;
      categoryCode = category?.code ?? null;
    }

    const scope = {
      userId: context.userId,
      scopeType: budget.scope_type as 'category' | 'overall',
      categoryId: budget.category_id,
      categoryParentId,
      currency: budget.currency,
      currentPeriodStart: budget.current_period_start,
      currentPeriodEnd: budget.current_period_end,
    };

    // Both computed AFTER the lock is held — no concurrent transaction can
    // be mid-commit against this same budget while this one holds the lock,
    // so this SUM is guaranteed to see every contribution any
    // already-committed transaction made against it: the TRUE combined
    // total, never understated the way the pre-lock read could be.
    const usedAfter = await computeBudgetUsedAmount(tx, scope, null);
    const usedBefore = await computeBudgetUsedAmount(tx, scope, context.transactionId);

    const limitAmount = formatDecimalAmount(budget.limit_amount);
    const utilizationBeforePercent = percentOf(usedBefore, limitAmount);
    const utilizationAfterPercent = percentOf(usedAfter, limitAmount);

    const crossedThresholds = evaluateBudgetThresholdCrossing(
      utilizationBeforePercent,
      utilizationAfterPercent,
    );

    for (const thresholdPercent of crossedThresholds) {
      try {
        await tx.budgetNotificationLog.create({
          data: {
            budgetId: budget.id,
            thresholdFired: thresholdPercent,
            periodStart: budget.current_period_start,
          },
        });
      } catch (error) {
        // FR-FIN-048 — "safe to process more than once": a concurrent
        // commit against the same budget already logged this exact
        // (budgetId, thresholdFired, periodStart) triple first; this is the
        // dedup mechanism itself working, not an unexpected failure. Kept
        // unchanged by this fix — still the correct, sufficient guard for
        // "never fire the SAME threshold twice" now that the SUM feeding
        // into this decision is itself lock-protected.
        if (
          error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }

      await tx.domainEvent.create({
        data: {
          eventType: 'BudgetThresholdCrossed',
          payload: {
            budgetId: budget.id,
            userId: context.userId,
            scopeType: budget.scope_type,
            categoryName: categoryCode,
            thresholdPercent,
            utilizationPercent: utilizationAfterPercent,
            limitAmount,
            usedAmount: usedAfter,
            currency: budget.currency,
            periodStart: budget.current_period_start.toISOString(),
          },
          status: 'pending',
        },
      });
    }
  }
}
