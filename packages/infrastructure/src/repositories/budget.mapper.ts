import type { BudgetPeriodType, BudgetScopeType, BudgetStatus } from '@afa/domain';
import { Budget } from '@afa/domain';
import type { Budget as PrismaBudgetRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/** Prisma row -> domain entity, re-validating through the domain constructor — the same defense-in-depth convention `debt.mapper.ts` established. */
export function toDomainBudget(row: PrismaBudgetRow): Budget {
  return new Budget({
    id: row.id,
    userId: row.userId,
    scopeType: row.scopeType as BudgetScopeType,
    categoryId: row.categoryId,
    limitAmount: formatDecimalAmount(row.limitAmount),
    currency: row.currency,
    periodType: row.periodType as BudgetPeriodType,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    status: row.status as BudgetStatus,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
