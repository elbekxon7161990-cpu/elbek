import { Injectable } from '@nestjs/common';
import type {
  Account,
  AccountEditableFields,
  AccountRepository,
  NewAccountData,
} from '@afa/domain';
import { Account as AccountEntity } from '@afa/domain';

import { toDomainAccount } from './account.mapper';
import { computeAccountBalance } from './compute-account-balance';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TASK-FIN-007 (Stage B) — implements @afa/domain's `AccountRepository` port
 * against the `accounts` table (§13.19.2). RLS-protected (`rls-protected-models.ts`
 * already lists `Account`, added ahead of this task's own arrival — the same
 * "TASK-DB-011 built the policy set ahead of time" precedent `Budget`'s own
 * repository doc comment already noted).
 */
@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    return row ? toDomainAccount(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({
      where: { userId, deletedAt: null, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomainAccount);
  }

  async create(data: NewAccountData): Promise<Account> {
    const now = new Date();
    AccountEntity.validateNew(data, now);

    const row = await this.prisma.account.create({
      data: {
        userId: data.userId,
        name: data.name,
        accountType: data.accountType,
        currency: data.currency,
        startingBalance: data.startingBalance,
        isDefault: data.isDefault,
      },
    });
    return toDomainAccount(row);
  }

  async update(
    id: string,
    userId: string,
    changes: AccountEditableFields,
  ): Promise<Account | null> {
    const result = await this.prisma.account.updateMany({
      where: { id, userId, deletedAt: null },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.accountType !== undefined && { accountType: changes.accountType }),
        updatedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.account.findUniqueOrThrow({ where: { id } });
    return toDomainAccount(row);
  }

  /** FR-FIN-025 — atomic conditional `WHERE status = 'active'`, mirroring `DebtRepository.forgive()`'s own "only from a still-valid prior state" guard; archiving an already-archived account is a no-op `null`, not an error. */
  async archive(id: string, userId: string): Promise<Account | null> {
    const result = await this.prisma.account.updateMany({
      where: { id, userId, deletedAt: null, status: 'active' },
      data: { status: 'archived', updatedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.prisma.account.findUniqueOrThrow({ where: { id } });
    return toDomainAccount(row);
  }

  /**
   * §8.12.4's implicit-default-account edge case. The real uniqueness guard
   * (`uq_accounts_default_per_currency`) is a `WHERE`-qualified partial
   * index — not expressible as a Prisma `@@unique`, so (exactly like
   * `PrismaBudgetRepository.create()`'s own `DuplicateBudgetError` handling)
   * this cannot use Prisma's `upsert()` API, which requires a schema-declared
   * unique key. Same "pre-check, insert, catch-and-reread on a race" shape
   * `PrismaCounterpartyRepository.findOrCreateByName`'s own P2002 fix
   * established for TASK-FIN-002, adapted here for the same reason
   * `PrismaBudgetRepository.create()` already adapted it: the constraint
   * itself isn't Prisma-recognized, so its violation cannot be reliably
   * caught by error code alone — re-querying after ANY unexpected failure
   * is the robust fallback.
   */
  async findOrCreateDefaultForCurrency(userId: string, currency: string): Promise<Account> {
    const existing = await this.findDefaultForCurrency(userId, currency);
    if (existing) {
      return existing;
    }

    try {
      const row = await this.prisma.account.create({
        data: {
          userId,
          name: `Default (${currency})`,
          accountType: 'other',
          currency,
          startingBalance: '0',
          isDefault: true,
        },
      });
      return toDomainAccount(row);
    } catch (error) {
      const raced = await this.findDefaultForCurrency(userId, currency);
      if (raced) {
        return raced;
      }
      throw error;
    }
  }

  private async findDefaultForCurrency(userId: string, currency: string): Promise<Account | null> {
    const row = await this.prisma.account.findFirst({
      where: { userId, currency, isDefault: true, deletedAt: null },
    });
    return row ? toDomainAccount(row) : null;
  }

  /**
   * TASK-FIN-007 (Stage G, §8.14.2). Ownership + existence enforced here,
   * before any calculation runs — the same "atomic conditional, `null` on
   * mismatch" convention `update()`/`archive()` already establish. An
   * archived (but not soft-deleted) account's balance IS still computable
   * (FR-FIN-025).
   */
  async computeBalance(accountId: string, userId: string, asOfDate: Date): Promise<string | null> {
    const row = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!row || row.userId !== userId || row.deletedAt !== null) {
      return null;
    }

    return computeAccountBalance(this.prisma, {
      accountId,
      currency: row.currency,
      startingBalance: row.startingBalance.toString(),
      asOfDate,
    });
  }
}
