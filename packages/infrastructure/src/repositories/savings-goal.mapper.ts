import type { SavingsGoalStatus } from '@afa/domain';
import { SavingsGoal } from '@afa/domain';
import type { SavingsGoal as PrismaSavingsGoalRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/**
 * Prisma row -> domain `SavingsGoal`, re-validating through the domain
 * constructor (defense-in-depth, same convention as every other mapper in
 * this package). `targetAmount` is a `Decimal(18,2)` money field, so it gets
 * `formatDecimalAmount`. No `updatedAt` mapped — `savings_goals` genuinely
 * has no such column (confirmed against the schema in TASK-FIN-004 Stage A).
 */
export function toDomainSavingsGoal(row: PrismaSavingsGoalRow): SavingsGoal {
  return new SavingsGoal({
    id: row.id,
    userId: row.userId,
    name: row.name,
    targetAmount: formatDecimalAmount(row.targetAmount),
    currency: row.currency,
    targetDate: row.targetDate,
    status: row.status as SavingsGoalStatus,
    lastMilestoneFired: row.lastMilestoneFired,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  });
}
