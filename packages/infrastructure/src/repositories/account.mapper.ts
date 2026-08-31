import type { AccountStatus, AccountType } from '@afa/domain';
import { Account } from '@afa/domain';
import type { Account as PrismaAccountRow } from '@prisma/client';

import { formatDecimalAmount } from './format-decimal-amount';

/** Prisma row -> domain entity, re-validating through the domain constructor — the same defense-in-depth convention `debt.mapper.ts`/`budget.mapper.ts` established. */
export function toDomainAccount(row: PrismaAccountRow): Account {
  return new Account({
    id: row.id,
    userId: row.userId,
    name: row.name,
    accountType: row.accountType as AccountType,
    currency: row.currency,
    startingBalance: formatDecimalAmount(row.startingBalance),
    isDefault: row.isDefault,
    status: row.status as AccountStatus,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
